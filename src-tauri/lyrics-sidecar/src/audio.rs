//! Audio in/out around the pipeline: ffmpeg-piped decode to the 44.1 kHz
//! stereo f32 the MDX stage needs, and a minimal 16-bit WAV writer for the
//! optional `--dump-stem` debug artifact. ffmpeg is the app's already-bundled
//! pinned sidecar — args are built HERE, never passed through.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};

pub const SAMPLE_RATE: u32 = 44_100;

/// Deinterleaved stereo samples.
pub struct Stereo {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}

impl Stereo {
    pub fn duration_sec(&self) -> f64 {
        self.left.len() as f64 / SAMPLE_RATE as f64
    }
}

/// The exact decode invocation. Pure for testing, like prores_args.
pub fn decode_args(input: &str) -> Vec<String> {
    [
        "-hide_banner",
        "-nostdin",
        "-i",
        input,
        "-f",
        "f32le",
        "-acodec",
        "pcm_f32le",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Decode any audio file ffmpeg reads into 44.1 kHz stereo f32.
pub fn decode(ffmpeg: &Path, input: &Path) -> Result<Stereo, String> {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(decode_args(&input.to_string_lossy()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    let mut raw = Vec::new();
    child
        .stdout
        .take()
        .expect("stdout piped")
        .read_to_end(&mut raw)
        .map_err(|e| format!("ffmpeg read failed: {e}"))?;
    let mut err = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = stderr.read_to_string(&mut err);
    }
    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg wait failed: {e}"))?;
    if !status.success() {
        let tail: String = err.lines().rev().take(4).collect::<Vec<_>>().join(" | ");
        return Err(format!("ffmpeg decode failed: {tail}"));
    }
    Ok(deinterleave_f32le(&raw))
}

/// Little-endian f32 interleaved LR bytes -> planar stereo. A trailing
/// partial sample (torn pipe) is dropped rather than misread.
pub fn deinterleave_f32le(raw: &[u8]) -> Stereo {
    let frames = raw.len() / 8; // 2 channels * 4 bytes
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for i in 0..frames {
        let o = i * 8;
        left.push(f32::from_le_bytes([
            raw[o],
            raw[o + 1],
            raw[o + 2],
            raw[o + 3],
        ]));
        right.push(f32::from_le_bytes([
            raw[o + 4],
            raw[o + 5],
            raw[o + 6],
            raw[o + 7],
        ]));
    }
    Stereo { left, right }
}

/// Minimal 44.1 kHz stereo 16-bit PCM WAV encoder (for `--dump-stem`).
pub fn wav_s16(stereo: &Stereo) -> Vec<u8> {
    let n = stereo.left.len().min(stereo.right.len());
    let data_len = (n * 4) as u32;
    let mut out = Vec::with_capacity(44 + n * 4);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM header size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&2u16.to_le_bytes()); // stereo
    out.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    out.extend_from_slice(&(SAMPLE_RATE * 4).to_le_bytes()); // byte rate
    out.extend_from_slice(&4u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for i in 0..n {
        for ch in [&stereo.left, &stereo.right] {
            let v = (ch[i].clamp(-1.0, 1.0) * 32767.0) as i16;
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_args_are_exactly_the_proven_contract() {
        assert_eq!(
            decode_args("C:/t/in.flac"),
            vec![
                "-hide_banner",
                "-nostdin",
                "-i",
                "C:/t/in.flac",
                "-f",
                "f32le",
                "-acodec",
                "pcm_f32le",
                "-ac",
                "2",
                "-ar",
                "44100",
                "-",
            ]
        );
    }

    #[test]
    fn deinterleave_reads_le_pairs_and_drops_torn_tails() {
        let mut raw = Vec::new();
        raw.extend_from_slice(&0.5f32.to_le_bytes());
        raw.extend_from_slice(&(-0.25f32).to_le_bytes());
        raw.extend_from_slice(&1.0f32.to_le_bytes());
        raw.extend_from_slice(&0.0f32.to_le_bytes());
        raw.extend_from_slice(&[1, 2, 3]); // torn frame
        let s = deinterleave_f32le(&raw);
        assert_eq!(s.left, vec![0.5, 1.0]);
        assert_eq!(s.right, vec![-0.25, 0.0]);
    }

    #[test]
    fn wav_header_is_valid_riff_pcm() {
        let stereo = Stereo {
            left: vec![0.0, 0.5, -0.5],
            right: vec![0.0, -1.5, 1.5], // clamps
        };
        let wav = wav_s16(&stereo);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        assert_eq!(wav.len(), 44 + 12);
        let data_len = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]);
        assert_eq!(data_len, 12);
        // Clamped extremes land on i16 min/max territory.
        let l1 = i16::from_le_bytes([wav[44 + 4], wav[44 + 5]]);
        let r1 = i16::from_le_bytes([wav[44 + 6], wav[44 + 7]]);
        assert_eq!(l1, 16383);
        assert_eq!(r1, -32767);
    }
}
