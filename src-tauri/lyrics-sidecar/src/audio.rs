//! Audio in/out around the pipeline: ffmpeg-piped decode to the 44.1 kHz
//! stereo f32 the MDX stage needs, and a minimal 16-bit WAV writer for the
//! optional `--dump-stem` debug artifact. ffmpeg is the app's already-bundled
//! pinned sidecar — args are built HERE, never passed through.

use std::io::{BufRead, Read};
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
///
/// stderr is drained on its own thread WHILE stdout is read to EOF. Reading
/// the pipes sequentially deadlocked on damaged/warning-spewing inputs:
/// once the unread stderr pipe buffer fills, ffmpeg's stderr write blocks,
/// it stops producing stdout, and `read_to_end` waits forever. The child is
/// registered with the canceller for the whole read so a "cancel" line can
/// kill it — the kill breaks the stdout pipe, which is exactly what
/// unblocks the read (prores.rs uses the same escape hatch).
pub fn decode(ffmpeg: &Path, input: &Path, cancel: &crate::Canceller) -> Result<Stereo, String> {
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
    let mut stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let tail_reader = std::thread::spawn(move || stderr_tail(std::io::BufReader::new(stderr), 4));

    let kill_registered = || {
        if let Some(mut c) = cancel.child.lock().expect("cancel mutex").take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    };
    *cancel.child.lock().expect("cancel mutex") = Some(child);
    if cancel.cancelled() {
        // A cancel between spawn and registration found the slot empty and
        // killed nothing — close that gap ourselves. (The message never
        // surfaces: callers check the flag before reporting the error.)
        kill_registered();
        let _ = tail_reader.join();
        return Err("cancelled".into());
    }

    let mut raw = Vec::new();
    if let Err(e) = stdout.read_to_end(&mut raw) {
        kill_registered();
        let _ = tail_reader.join();
        return Err(format!("ffmpeg read failed: {e}"));
    }
    // EOF: ffmpeg finished, or the cancel kill broke the pipe. Reap through
    // the canceller slot so a cancel arriving during the wait still finds a
    // killable child.
    let status = loop {
        {
            let mut guard = cancel.child.lock().expect("cancel mutex");
            let Some(running) = guard.as_mut() else {
                let _ = tail_reader.join();
                return Err("ffmpeg decode interrupted".into());
            };
            match running.try_wait() {
                Ok(Some(status)) => {
                    guard.take();
                    break status;
                }
                Ok(None) => {}
                Err(e) => {
                    guard.take();
                    let _ = tail_reader.join();
                    return Err(format!("ffmpeg wait failed: {e}"));
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    let tail = tail_reader.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("ffmpeg decode failed: {tail}"));
    }
    Ok(deinterleave_f32le(&raw))
}

/// Last `keep` non-empty lines of a stream, oldest first — the tail
/// surfaced in decode failures. Bounded so draining a pathological stderr
/// costs a fixed amount of memory no matter how much ffmpeg writes.
fn stderr_tail<R: BufRead>(reader: R, keep: usize) -> String {
    let mut tail: Vec<String> = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        tail.push(line.to_string());
        if tail.len() > keep {
            tail.remove(0);
        }
    }
    tail.join(" | ")
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
    fn stderr_tail_is_bounded_and_keeps_the_last_lines() {
        // The drain exists to defeat a warning-spewing input; the tail it
        // keeps must stay bounded and end-weighted (the error is at the end).
        let noisy = (1..=100).map(|i| format!("warn {i}\n")).collect::<String>();
        assert_eq!(
            stderr_tail(std::io::Cursor::new(noisy), 4),
            "warn 97 | warn 98 | warn 99 | warn 100"
        );
        assert_eq!(stderr_tail(std::io::Cursor::new("one\n\n\n"), 4), "one");
        assert_eq!(stderr_tail(std::io::Cursor::new(""), 4), "");
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
