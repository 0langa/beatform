//! STFT / iSTFT exactly as UVR's MDX demix loop performs it (and as the
//! phase-1 spike's verified numpy reimplementation performs it): n_fft 7680,
//! hop 1024, periodic Hann, reflect center-pad, window-sum-normalized
//! overlap-add. The constants are the model's architecture, not knobs.

use realfft::num_complex::Complex;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};
use std::sync::Arc;

pub const N_FFT: usize = 7680;
pub const HOP: usize = 1024;
pub const DIM_F: usize = 3072;
pub const DIM_T: usize = 256;
/// Samples of audio one model window covers.
pub const CHUNK: usize = HOP * (DIM_T - 1); // 261120
/// Center-pad amount; also the per-side stitch trim.
pub const TRIM: usize = N_FFT / 2; // 3840
/// Net new samples each chunk contributes after stitching.
pub const GEN: usize = CHUNK - 2 * TRIM; // 253440
pub const BINS: usize = N_FFT / 2 + 1; // 3841

/// Periodic Hann window (denominator N, matching numpy's spike formula).
fn hann_periodic() -> Vec<f32> {
    (0..N_FFT)
        .map(|i| {
            let x = (2.0 * std::f64::consts::PI * i as f64) / N_FFT as f64;
            (0.5 * (1.0 - x.cos())) as f32
        })
        .collect()
}

pub struct MdxStft {
    win: Vec<f32>,
    /// win[i]^2 summed across overlapping frames at each output sample —
    /// precomputed once; identical for every chunk.
    wsum: Vec<f32>,
    fwd: Arc<dyn RealToComplex<f32>>,
    inv: Arc<dyn ComplexToReal<f32>>,
}

impl MdxStft {
    pub fn new() -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        let win = hann_periodic();
        let padded = CHUNK + 2 * TRIM;
        let mut wsum = vec![0.0f64; padded];
        for t in 0..DIM_T {
            let s = t * HOP;
            for (i, w) in win.iter().enumerate() {
                wsum[s + i] += (*w as f64) * (*w as f64);
            }
        }
        Self {
            win,
            wsum: wsum.iter().map(|v| v.max(1e-10) as f32).collect(),
            fwd: planner.plan_fft_forward(N_FFT),
            inv: planner.plan_fft_inverse(N_FFT),
        }
    }

    /// One stereo chunk ([2][CHUNK]) -> model input layout [4][DIM_F][DIM_T]
    /// flattened (ch0.re, ch0.im, ch1.re, ch1.im).
    pub fn forward(&self, chunk: &[Vec<f32>; 2], out: &mut [f32]) {
        debug_assert_eq!(chunk[0].len(), CHUNK);
        debug_assert_eq!(out.len(), 4 * DIM_F * DIM_T);
        let mut frame = vec![0.0f32; N_FFT];
        let mut spec = vec![Complex::default(); BINS];
        let mut scratch = vec![Complex::default(); self.fwd.get_scratch_len()];
        for (ch, samples) in chunk.iter().enumerate() {
            let padded = reflect_pad(samples);
            for t in 0..DIM_T {
                let s = t * HOP;
                for i in 0..N_FFT {
                    frame[i] = padded[s + i] * self.win[i];
                }
                self.fwd
                    .process_with_scratch(&mut frame, &mut spec, &mut scratch)
                    .expect("fft length is fixed and correct");
                // Layout: out[(2*ch + 0)][f][t] = re, out[(2*ch + 1)][f][t] = im
                for f in 0..DIM_F {
                    out[(2 * ch) * DIM_F * DIM_T + f * DIM_T + t] = spec[f].re;
                    out[(2 * ch + 1) * DIM_F * DIM_T + f * DIM_T + t] = spec[f].im;
                }
            }
        }
    }

    /// Model output [4][DIM_F][DIM_T] -> stereo time chunk [2][CHUNK]
    /// (center pad undone; caller trims a further TRIM per side to stitch).
    pub fn inverse(&self, spec_in: &[f32]) -> [Vec<f32>; 2] {
        debug_assert_eq!(spec_in.len(), 4 * DIM_F * DIM_T);
        let padded_len = CHUNK + 2 * TRIM;
        let mut result = [vec![0.0f32; CHUNK], vec![0.0f32; CHUNK]];
        let mut spec = vec![Complex::default(); BINS];
        let mut frame = vec![0.0f32; N_FFT];
        let mut scratch = vec![Complex::default(); self.inv.get_scratch_len()];
        for ch in 0..2 {
            let mut acc = vec![0.0f32; padded_len];
            for t in 0..DIM_T {
                for f in 0..DIM_F {
                    spec[f] = Complex::new(
                        spec_in[(2 * ch) * DIM_F * DIM_T + f * DIM_T + t],
                        spec_in[(2 * ch + 1) * DIM_F * DIM_T + f * DIM_T + t],
                    );
                }
                for slot in spec.iter_mut().take(BINS).skip(DIM_F) {
                    *slot = Complex::default();
                }
                // realfft's c2r rejects a non-zero imaginary part at DC/Nyquist
                // (they are mathematically real); the model output can carry
                // tiny values there, so zero them the way numpy's irfft
                // implicitly discards them.
                spec[0].im = 0.0;
                spec[BINS - 1].im = 0.0;
                self.inv
                    .process_with_scratch(&mut spec, &mut frame, &mut scratch)
                    .expect("ifft length is fixed and correct");
                let s = t * HOP;
                // realfft's inverse is unnormalized (like numpy irfft * N).
                let scale = 1.0 / N_FFT as f32;
                for i in 0..N_FFT {
                    acc[s + i] += frame[i] * scale * self.win[i];
                }
            }
            for i in 0..CHUNK {
                result[ch][i] = acc[TRIM + i] / self.wsum[TRIM + i];
            }
        }
        result
    }
}

/// numpy `np.pad(mode='reflect')` by TRIM on both sides.
fn reflect_pad(x: &[f32]) -> Vec<f32> {
    let n = x.len();
    let mut out = Vec::with_capacity(n + 2 * TRIM);
    for i in (1..=TRIM).rev() {
        out.push(x[i]);
    }
    out.extend_from_slice(x);
    for i in 2..=TRIM + 1 {
        out.push(x[n - i]);
    }
    out
}

/// Split a full track into the MDX chunk/stitch plan: prepend TRIM zeros,
/// pad the tail to a whole number of GEN strides plus TRIM zeros; each chunk
/// is CHUNK long starting at multiples of GEN. Mirrors the spike loop.
pub struct ChunkPlan {
    pub padded: [Vec<f32>; 2],
    pub n_chunks: usize,
    pub original_len: usize,
}

pub fn plan_chunks(left: &[f32], right: &[f32]) -> ChunkPlan {
    let n = left.len();
    let pad_amt = if n.is_multiple_of(GEN) {
        0
    } else {
        GEN - (n % GEN)
    };
    let total = TRIM + n + pad_amt + TRIM;
    let mut padded = [vec![0.0f32; total], vec![0.0f32; total]];
    padded[0][TRIM..TRIM + n].copy_from_slice(left);
    padded[1][TRIM..TRIM + n].copy_from_slice(right);
    ChunkPlan {
        padded,
        n_chunks: (n + pad_amt) / GEN,
        original_len: n,
    }
}

impl ChunkPlan {
    /// The `idx`-th [2][CHUNK] window.
    pub fn chunk(&self, idx: usize) -> [Vec<f32>; 2] {
        let s = idx * GEN;
        [
            self.padded[0][s..s + CHUNK].to_vec(),
            self.padded[1][s..s + CHUNK].to_vec(),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_match_the_uvr_mdx_architecture() {
        assert_eq!(CHUNK, 261_120);
        assert_eq!(TRIM, 3_840);
        assert_eq!(GEN, 253_440);
        assert_eq!(BINS, 3_841);
    }

    #[test]
    fn reflect_pad_mirrors_without_repeating_the_edge() {
        // np.pad([0,1,2,...], TRIM, mode='reflect') starts x[TRIM], ends x[n-1-TRIM].
        let x: Vec<f32> = (0..CHUNK).map(|i| i as f32).collect();
        let p = reflect_pad(&x);
        assert_eq!(p.len(), CHUNK + 2 * TRIM);
        assert_eq!(p[0], x[TRIM]);
        assert_eq!(p[TRIM - 1], x[1]); // ...3,2,1 then x[0]
        assert_eq!(p[TRIM], x[0]);
        assert_eq!(p[TRIM + CHUNK - 1], x[CHUNK - 1]);
        assert_eq!(p[TRIM + CHUNK], x[CHUNK - 2]);
        assert_eq!(p.last().copied().unwrap(), x[CHUNK - 1 - TRIM]);
    }

    #[test]
    fn stft_roundtrip_reconstructs_the_signal() {
        // forward -> inverse with an identity "model" must reproduce the
        // chunk (away from the very edges, which the stitch trims anyway).
        // A multi-tone signal, deterministic.
        let stft = MdxStft::new();
        let tone = |hz: f32, amp: f32| -> Vec<f32> {
            (0..CHUNK)
                .map(|i| (2.0 * std::f32::consts::PI * hz * (i as f32 / 44_100.0)).sin() * amp)
                .collect()
        };
        let chunk = [tone(220.0, 0.5), tone(331.0, 0.3)];
        let mut spec = vec![0.0f32; 4 * DIM_F * DIM_T];
        stft.forward(&chunk, &mut spec);
        let back = stft.inverse(&spec);
        // DIM_F keeps bins to ~17.6 kHz; 220/331 Hz live far below, so the
        // truncation loss is negligible for this signal.
        let mut max_err = 0.0f32;
        for ch in 0..2 {
            for i in TRIM..CHUNK - TRIM {
                max_err = max_err.max((back[ch][i] - chunk[ch][i]).abs());
            }
        }
        assert!(max_err < 1e-3, "roundtrip error too large: {max_err}");
    }

    #[test]
    fn chunk_plan_covers_the_signal_exactly() {
        let n = GEN * 2 + 12_345; // forces tail padding
        let left = vec![0.25f32; n];
        let right = vec![-0.25f32; n];
        let plan = plan_chunks(&left, &right);
        assert_eq!(plan.n_chunks, 3);
        assert_eq!(plan.original_len, n);
        assert_eq!(plan.padded[0].len(), TRIM + GEN * 3 + TRIM);
        // Last chunk's window must fit exactly inside the padded buffer.
        let last_start = (plan.n_chunks - 1) * GEN;
        assert_eq!(last_start + CHUNK, plan.padded[0].len());
        let c = plan.chunk(plan.n_chunks - 1);
        assert_eq!(c[0].len(), CHUNK);
    }
}
