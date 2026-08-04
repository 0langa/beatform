//! 44.1 kHz -> 16 kHz mono resampling for the wav2vec2 alignment stage
//! (phase 3). Polyphase windowed-sinc: 44100/16000 = 441/160, so the
//! fractional tap offsets repeat every 160 output samples — 160 precomputed
//! filter phases, then the whole conversion is pure multiply-accumulate.
//! Deterministic (fixed coefficients, no feedback state).

/// Input rate the MDX stage produces.
pub const IN_RATE: usize = 44_100;
/// wav2vec2-base-960h's native rate.
pub const OUT_RATE: usize = 16_000;

const UP: usize = 160; // OUT_RATE / gcd(44100, 16000)
const DOWN: usize = 441; // IN_RATE  / gcd(44100, 16000)
/// Taps to each side of the interpolation point, in INPUT samples. 24 per
/// side with a Blackman window ≈ -58 dB stopband — far below anything the
/// CTC emissions care about.
const HALF_TAPS: usize = 24;
/// Anti-alias cutoff as a fraction of the OUTPUT Nyquist (8 kHz); the 0.92
/// margin keeps the transition band's tail under Nyquist.
const ROLLOFF: f64 = 0.92;

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x)
    }
}

/// Blackman window over [-HALF_TAPS, HALF_TAPS], zero at the edges.
fn blackman(t: f64) -> f64 {
    let x = std::f64::consts::PI * t / HALF_TAPS as f64;
    0.42 + 0.5 * x.cos() + 0.08 * (2.0 * x).cos()
}

/// The 160 phase filters, each `2*HALF_TAPS + 1` taps, DC-normalized so a
/// constant signal passes through at exactly unit gain.
fn phase_filters() -> Vec<Vec<f32>> {
    // Cutoff in cycles per INPUT sample: output Nyquist scaled by ROLLOFF.
    let fc = ROLLOFF * (OUT_RATE as f64 / 2.0) / IN_RATE as f64;
    (0..UP)
        .map(|phase| {
            let frac = phase as f64 / UP as f64;
            let taps: Vec<f64> = (-(HALF_TAPS as i64)..=HALF_TAPS as i64)
                .map(|k| {
                    let t = k as f64 - frac;
                    2.0 * fc * sinc(2.0 * fc * t) * blackman(t)
                })
                .collect();
            let sum: f64 = taps.iter().sum();
            taps.iter().map(|t| (t / sum) as f32).collect()
        })
        .collect()
}

/// Stereo 44.1 kHz -> mono 16 kHz. The mono mix is the same 0.5*(L+R) the
/// VAD uses. Out-of-range taps read as silence (zero padding).
pub fn stem_to_16k_mono(left: &[f32], right: &[f32]) -> Vec<f32> {
    let n = left.len().min(right.len());
    let mono: Vec<f32> = (0..n).map(|i| 0.5 * (left[i] + right[i])).collect();
    resample_mono(&mono)
}

pub fn resample_mono(mono: &[f32]) -> Vec<f32> {
    let filters = phase_filters();
    let n_in = mono.len();
    let n_out = n_in * UP / DOWN;
    let mut out = Vec::with_capacity(n_out);
    for n in 0..n_out {
        let pos = n * DOWN; // position in units of 1/UP input samples
        let idx = (pos / UP) as i64;
        let taps = &filters[pos % UP];
        let mut acc = 0.0f64;
        for (j, tap) in taps.iter().enumerate() {
            let s = idx + j as i64 - HALF_TAPS as i64;
            if s >= 0 && (s as usize) < n_in {
                acc += mono[s as usize] as f64 * *tap as f64;
            }
        }
        out.push(acc as f32);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(v: &[f32]) -> f64 {
        (v.iter().map(|s| (*s as f64) * (*s as f64)).sum::<f64>() / v.len().max(1) as f64).sqrt()
    }

    fn sine(freq: f64, sec: f64, rate: usize) -> Vec<f32> {
        (0..(sec * rate as f64) as usize)
            .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / rate as f64).sin() as f32)
            .collect()
    }

    #[test]
    fn output_length_and_audible_band_level_are_preserved() {
        let input = sine(440.0, 1.0, IN_RATE);
        let out = resample_mono(&input);
        // 44100 in -> exactly 16000 out; interior RMS (edges see zero
        // padding) within 2% of the source.
        assert_eq!(out.len(), IN_RATE * UP / DOWN);
        let inner = &out[1000..out.len() - 1000];
        let ratio = rms(inner) / rms(&input);
        assert!((ratio - 1.0).abs() < 0.02, "RMS ratio {ratio}");
    }

    #[test]
    fn content_above_the_output_nyquist_is_rejected() {
        // 12 kHz cannot exist at 16 kHz sampling; it must die in the filter,
        // not alias into the band the model reads.
        let input = sine(12_000.0, 1.0, IN_RATE);
        let out = resample_mono(&input);
        let inner = &out[1000..out.len() - 1000];
        let ratio = rms(inner) / rms(&input);
        assert!(ratio < 0.02, "aliasing leak: {ratio}");
    }

    #[test]
    fn dc_passes_at_exactly_unit_gain() {
        let input = vec![0.25f32; IN_RATE];
        let out = resample_mono(&input);
        for s in &out[200..out.len() - 200] {
            assert!((s - 0.25).abs() < 1e-4, "{s}");
        }
    }

    #[test]
    fn stereo_mix_matches_the_vad_mono_convention() {
        let left = vec![0.5f32; 4410];
        let right = vec![-0.1f32; 4410];
        let out = stem_to_16k_mono(&left, &right);
        assert_eq!(out.len(), 1600);
        // 0.5*(0.5-0.1) = 0.2 through the unit-DC filter.
        assert!((out[800] - 0.2).abs() < 1e-4);
    }
}
