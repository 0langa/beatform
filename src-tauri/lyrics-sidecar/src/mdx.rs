//! MDX-Net vocal isolation on ONNX Runtime via `ort` (load-dynamic against
//! the pinned official onnxruntime.dll). DirectML is tried first by default —
//! the spike measured RTF 0.52 on the reference Iris Xe vs 1.86–2.45
//! sustained CPU (adjustment 2) — with silent-but-reported CPU fallback.

use crate::stft::{self, MdxStft};
use ort::session::Session;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GpuMode {
    Auto,
    Dml,
    Cpu,
}

impl GpuMode {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "auto" => Ok(Self::Auto),
            "dml" => Ok(Self::Dml),
            "cpu" => Ok(Self::Cpu),
            other => Err(format!("unknown --gpu mode: {other} (auto|dml|cpu)")),
        }
    }
}

/// Load the pinned onnxruntime.dll. Must run before any session is built.
pub fn init_runtime(dylib: &Path) -> Result<(), String> {
    let builder = ort::init_from(dylib)
        .map_err(|e| format!("could not load onnxruntime at {}: {e}", dylib.display()))?;
    // commit() returns false only when an environment was already committed,
    // which cannot happen in this single-init binary.
    builder.commit();
    Ok(())
}

/// Planar stereo stem, (left, right).
pub type StemChannels = (Vec<f32>, Vec<f32>);

pub struct Mdx {
    session: Session,
    input_name: String,
    /// "dml" or "cpu" — what actually registered, for the result event.
    pub ep: &'static str,
}

impl Mdx {
    /// Build the isolation session. `Auto`/`Dml` try DirectML with
    /// error-on-failure so the fallback is DETECTED, not silent — the UI's
    /// time estimate differs 4–5x between the two and must not guess.
    pub fn create(model: &Path, gpu: GpuMode, threads: usize) -> Result<Self, String> {
        if gpu != GpuMode::Cpu {
            match Self::build(model, true, threads) {
                Ok(s) => return Ok(s),
                Err(e) => {
                    if gpu == GpuMode::Dml {
                        return Err(format!("DirectML unavailable: {e}"));
                    }
                    eprintln!("[lyrics-sidecar] DirectML unavailable, using CPU: {e}");
                }
            }
        }
        Self::build(model, false, threads)
    }

    fn build(model: &Path, dml: bool, threads: usize) -> Result<Self, String> {
        let mut builder = Session::builder().map_err(|e| e.to_string())?;
        if dml {
            builder = builder
                .with_execution_providers([ort::ep::DirectML::default().build().error_on_failure()])
                .map_err(|e| e.to_string())?;
        } else if threads > 0 {
            builder = builder
                .with_intra_threads(threads)
                .map_err(|e| e.to_string())?;
        }
        let session = builder
            .commit_from_file(model)
            .map_err(|e| format!("could not load MDX model {}: {e}", model.display()))?;
        let input_name = session
            .inputs()
            .first()
            .map(|i| i.name().to_string())
            .ok_or("MDX model reports no inputs")?;
        Ok(Self {
            session,
            input_name,
            ep: if dml { "dml" } else { "cpu" },
        })
    }

    /// Whole-track isolation: chunked STFT -> model -> iSTFT overlap-add
    /// stitch, exactly the spike's verified loop. `on_chunk(done, total)`
    /// fires after every chunk; returns None when cancelled.
    pub fn separate(
        &mut self,
        left: &[f32],
        right: &[f32],
        cancel: &AtomicBool,
        mut on_chunk: impl FnMut(usize, usize),
    ) -> Result<Option<StemChannels>, String> {
        let stft = MdxStft::new();
        let plan = stft::plan_chunks(left, right);
        let n = plan.original_len;
        let mut out_l: Vec<f32> = Vec::with_capacity(n);
        let mut out_r: Vec<f32> = Vec::with_capacity(n);
        let mut spec = vec![0.0f32; 4 * stft::DIM_F * stft::DIM_T];
        for idx in 0..plan.n_chunks {
            if cancel.load(Ordering::SeqCst) {
                return Ok(None);
            }
            let chunk = plan.chunk(idx);
            stft.forward(&chunk, &mut spec);
            let tensor = ort::value::Tensor::from_array((
                [1usize, 4, stft::DIM_F, stft::DIM_T],
                std::mem::take(&mut spec),
            ))
            .map_err(|e| e.to_string())?;
            let outputs = self
                .session
                .run(ort::inputs![self.input_name.as_str() => tensor])
                .map_err(|e| format!("MDX inference failed: {e}"))?;
            let (shape, data) = outputs[0]
                .try_extract_tensor::<f32>()
                .map_err(|e| e.to_string())?;
            let expected = 4 * stft::DIM_F * stft::DIM_T;
            let flat: &[f32] = data;
            if flat.len() != expected {
                return Err(format!(
                    "MDX output shape unexpected: {shape:?} ({} values, want {expected})",
                    flat.len()
                ));
            }
            let wav = stft.inverse(flat);
            drop(outputs);
            spec = vec![0.0f32; 4 * stft::DIM_F * stft::DIM_T];
            // Stitch: keep the GEN-sample core of each chunk.
            out_l.extend_from_slice(&wav[0][stft::TRIM..stft::CHUNK - stft::TRIM]);
            out_r.extend_from_slice(&wav[1][stft::TRIM..stft::CHUNK - stft::TRIM]);
            on_chunk(idx + 1, plan.n_chunks);
        }
        out_l.truncate(n);
        out_r.truncate(n);
        Ok(Some((out_l, out_r)))
    }
}

/// `--probe-gpu`: can a DirectML session be created at all? Answered without
/// a model by asking the EP for availability; used by the app to pick honest
/// time estimates before any download.
pub fn probe_dml() -> bool {
    use ort::ep::ExecutionProvider;
    ort::ep::DirectML::default().is_available().unwrap_or(false)
}
