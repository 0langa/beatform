//! WASAPI loopback capture: tap whatever the default output device is
//! playing (Spotify, a browser, a DAW) and stream it to the webview for
//! live visualization. cpal builds an INPUT stream on a RENDER device,
//! which on Windows sets AUDCLNT_STREAMFLAGS_LOOPBACK — the OS mixes it
//! for us, we just forward samples.
//!
//! Live-only by design: nothing here touches the export pipeline, and the
//! webview feeds these samples into analysers only (never the speakers —
//! that would feed the system output back into itself).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::{mpsc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub device: String,
}

/// Handle to the capture thread. The cpal Stream itself is !Send, so a
/// dedicated thread owns it; dropping the sender (or sending ()) unparks the
/// thread, which drops the stream and exits.
///
/// `dead` is set by cpal's error callback when the device goes away (unplugged
/// headphones, a driver reset, a default-device switch). Without it, device
/// loss was silent AND unrecoverable: the callback only logged, the sender
/// stayed `Some`, and every later `start_loopback` answered "already running"
/// forever while the UI kept showing a live capture that produced silence. The
/// only fix was restarting the app.
///
/// It is an atomic rather than more state behind the mutex because it is set
/// from the realtime audio thread, which must not block on a lock.
pub struct LoopbackCtl {
    pub inner: Mutex<Option<mpsc::Sender<()>>>,
    pub dead: Arc<AtomicBool>,
}

impl Default for LoopbackCtl {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
            dead: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Convert one interleaved device-channel callback buffer to interleaved
/// STEREO f32 little-endian bytes (mono duplicates, >2ch takes the front
/// pair — the visualizer's analysis graph is stereo).
fn to_stereo_le_bytes(data: &[f32], channels: usize) -> Vec<u8> {
    let ch = channels.max(1);
    let frames = data.len() / ch;
    let mut out = Vec::with_capacity(frames * 2 * 4);
    for f in 0..frames {
        let base = f * ch;
        let l = data[base];
        let r = if ch > 1 { data[base + 1] } else { l };
        out.extend_from_slice(&l.to_le_bytes());
        out.extend_from_slice(&r.to_le_bytes());
    }
    out
}

/// Decide whether a fresh capture may start, reclaiming a dead session.
///
/// Split out of `start_loopback` so the actual defect is testable: a session
/// whose device died is NOT a running session, but the old code only checked
/// "is the sender Some?" and so refused forever after any device loss.
/// Reclaiming unparks the old capture thread on the way out.
fn admit_start(guard: &mut Option<mpsc::Sender<()>>, dead: &AtomicBool) -> Result<(), String> {
    if guard.is_some() {
        if !dead.swap(false, Ordering::SeqCst) {
            return Err("System-audio capture is already running".into());
        }
        if let Some(tx) = guard.take() {
            let _ = tx.send(()); // let the old thread drop its stream
        }
    }
    dead.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn start_loopback(
    state: tauri::State<'_, LoopbackCtl>,
    on_samples: Channel<InvokeResponseBody>,
) -> Result<LoopbackInfo, String> {
    let mut guard = state.inner.lock().map_err(|_| "loopback state poisoned")?;
    admit_start(&mut guard, &state.dead)?;

    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("No default output device")?;
    let device_name = device
        .description()
        .map(|d| d.to_string())
        .unwrap_or_else(|_| "output device".into());
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    if config.sample_format() != cpal::SampleFormat::F32 {
        // WASAPI shared-mode mix format is f32 in practice; refuse anything
        // exotic rather than mis-interpreting bytes.
        return Err(format!(
            "Unsupported device sample format {:?}",
            config.sample_format()
        ));
    }
    let sample_rate = config.sample_rate();
    let channels = config.channels();

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    // The error callback needs to tear the stream down itself: it runs on the
    // audio thread and cannot touch tauri state. Setting `dead` and unparking
    // the capture thread is all it does, and both are lock-free.
    let err_dead = Arc::clone(&state.dead);
    let err_stop = stop_tx.clone();
    std::thread::spawn(move || {
        let ch = channels as usize;
        let stream = device.build_input_stream(
            config.into(),
            move |data: &[f32], _| {
                // A send failure means the webview side is gone; the stop
                // command will tear us down shortly — nothing to do here.
                let _ = on_samples.send(InvokeResponseBody::Raw(to_stereo_le_bytes(data, ch)));
            },
            move |e| {
                // Device lost / driver reset. Mark the session dead and unpark
                // the owner thread so the stream is dropped; the next
                // start_loopback then reclaims instead of refusing.
                eprintln!("[loopback] stream error, ending capture: {e}");
                err_dead.store(true, Ordering::SeqCst);
                let _ = err_stop.send(());
            },
            None,
        );
        match stream {
            Ok(s) => {
                if let Err(e) = s.play() {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
                let _ = ready_tx.send(Ok(()));
                // Park until stop (send OR sender drop both wake us).
                let _ = stop_rx.recv();
                drop(s);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e.to_string()));
            }
        }
    });
    ready_rx
        .recv()
        .map_err(|_| "Loopback thread died before reporting".to_string())??;

    *guard = Some(stop_tx);
    Ok(LoopbackInfo {
        sample_rate,
        channels,
        device: device_name,
    })
}

#[tauri::command]
pub fn stop_loopback(state: tauri::State<'_, LoopbackCtl>) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|_| "loopback state poisoned")?;
    state.dead.store(false, Ordering::SeqCst);
    if let Some(tx) = guard.take() {
        let _ = tx.send(()); // thread drops the stream and exits
    }
    Ok(())
}

/// True once the capture device has gone away. The frontend polls this so it
/// can drop the "listening" indicator instead of showing a live capture that
/// is silently producing nothing.
#[tauri::command]
pub fn loopback_died(state: tauri::State<'_, LoopbackCtl>) -> bool {
    state.dead.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn floats(bytes: &[u8]) -> Vec<f32> {
        bytes
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect()
    }

    #[test]
    fn a_live_session_blocks_a_second_start() {
        let (tx, _rx) = mpsc::channel::<()>();
        let mut guard = Some(tx);
        let dead = AtomicBool::new(false);
        assert!(admit_start(&mut guard, &dead).is_err());
        assert!(guard.is_some(), "the live session must be left alone");
    }

    #[test]
    fn a_dead_session_is_reclaimed_instead_of_refused_forever() {
        // The M22 defect: cpal's error callback only logged, so the sender
        // stayed Some and every later start answered "already running" for the
        // rest of the process's life. Unplugging a device bricked the feature.
        let (tx, rx) = mpsc::channel::<()>();
        let mut guard = Some(tx);
        let dead = AtomicBool::new(true);
        assert!(admit_start(&mut guard, &dead).is_ok());
        assert!(guard.is_none(), "the dead session must be cleared");
        assert!(rx.recv().is_ok(), "the old capture thread must be unparked");
        assert!(!dead.load(Ordering::SeqCst), "the flag must reset");
    }

    #[test]
    fn an_idle_state_starts_cleanly() {
        let mut guard: Option<mpsc::Sender<()>> = None;
        let dead = AtomicBool::new(false);
        assert!(admit_start(&mut guard, &dead).is_ok());
    }

    #[test]
    fn stereo_passes_through() {
        let out = to_stereo_le_bytes(&[0.1, -0.2, 0.3, -0.4], 2);
        assert_eq!(floats(&out), vec![0.1, -0.2, 0.3, -0.4]);
    }

    #[test]
    fn mono_duplicates() {
        let out = to_stereo_le_bytes(&[0.5, -0.5], 1);
        assert_eq!(floats(&out), vec![0.5, 0.5, -0.5, -0.5]);
    }

    #[test]
    fn surround_takes_front_pair() {
        // 5.1 frame: FL FR C LFE RL RR
        let out = to_stereo_le_bytes(&[0.1, 0.2, 9.0, 9.0, 9.0, 9.0], 6);
        assert_eq!(floats(&out), vec![0.1, 0.2]);
    }
}
