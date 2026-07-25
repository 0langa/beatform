//! WASAPI loopback capture: tap whatever the default output device is
//! playing (Spotify, a browser, a DAW) and stream it to the webview for
//! live visualization. cpal builds an INPUT stream on a RENDER device,
//! which on Windows sets AUDCLNT_STREAMFLAGS_LOOPBACK — the OS mixes it
//! for us, we just forward samples.
//!
//! Live-only by design: nothing here touches the export pipeline, and the
//! webview feeds these samples into analysers only (never the speakers —
//! that would feed the system output back into itself).
//!
//! The cpal data callback is a REALTIME context: it must not allocate, free,
//! lock or block, or the user gets a dropout in whatever they are listening to.
//! So the callback only fills preallocated buffers from a fixed pool
//! (`BlockPipe`) and a separate thread does the forwarding to the webview.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::{mpsc, Mutex};
use std::time::Duration;
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

/// Buffers in the block pool, and the capacity each one starts with.
///
/// 8 x 32 KiB (4096 stereo frames) is ~256 KiB total. A WASAPI shared-mode
/// period is ~10 ms — 480 frames at 48 kHz, 1920 at 192 kHz — so a callback
/// buffer fits many times over and the fill below never has to grow a Vec.
const POOL_BLOCKS: usize = 8;
const BLOCK_CAP_BYTES: usize = 4096 * 2 * 4;

/// How long the forwarding thread waits on the pool before re-checking the stop
/// channel. Stop latency only: the stream keeps capturing throughout.
const FORWARD_POLL: Duration = Duration::from_millis(100);

/// Overwrite `out` with one interleaved device-channel callback buffer
/// converted to interleaved STEREO f32 little-endian bytes (mono duplicates,
/// >2ch takes the front pair — the visualizer's analysis graph is stereo).
///
/// Takes `&mut Vec<u8>` rather than returning a fresh one because it runs ON
/// THE AUDIO THREAD: with capacity already in hand, `clear` + `extend_from_slice`
/// touch no allocator at all.
fn fill_stereo_le_bytes(out: &mut Vec<u8>, data: &[f32], channels: usize) {
    let ch = channels.max(1);
    let frames = data.len() / ch;
    out.clear();
    // No-op when the capacity is already there, which is the steady state. If a
    // device does hand us an unusually large period this grows ONCE per pooled
    // buffer — BlockSink::take preserves the grown capacity when it refills the
    // pool — instead of reallocating on every callback forever.
    out.reserve(frames * 2 * 4);
    for f in 0..frames {
        let base = f * ch;
        let l = data[base];
        let r = if ch > 1 { data[base + 1] } else { l };
        out.extend_from_slice(&l.to_le_bytes());
        out.extend_from_slice(&r.to_le_bytes());
    }
}

/// The audio thread's end of a fixed pool of byte buffers.
///
/// The defect this replaces (audit E4): the cpal data callback built a fresh
/// `Vec` for every block and pushed it straight into the Tauri channel — an
/// allocation AND an unbounded send, both on the realtime audio thread, where
/// either can overrun the callback deadline and cost the user an xrun in
/// whatever they are actually listening to.
///
/// Now the callback only moves preallocated buffers around: take one from
/// `free`, overwrite it, hand it off. `sync_channel` is array-backed, so
/// `try_recv`/`try_send` touch no allocator and never block. When the pool is
/// empty (the forwarder fell behind) the block is DROPPED — this feeds live
/// visualization only, so the cost is one stale frame of animation, which is
/// strictly better than a glitch in the audio.
struct BlockPipe {
    /// Empty buffers waiting to be filled.
    free: mpsc::Receiver<Vec<u8>>,
    /// Filled buffers on their way to the forwarding thread.
    filled: mpsc::SyncSender<Vec<u8>>,
    /// Put a buffer back WITHOUT dropping it: running `Vec`'s destructor on the
    /// audio thread is the same defect as allocating there.
    recycle: mpsc::SyncSender<Vec<u8>>,
}

impl BlockPipe {
    /// Called on the realtime audio thread. Allocation-free, lock-free, and
    /// non-blocking by construction.
    fn push(&self, data: &[f32], channels: usize) {
        let Ok(mut block) = self.free.try_recv() else {
            return; // pool empty: drop this block rather than wait here
        };
        fill_stereo_le_bytes(&mut block, data, channels);
        if let Err(mpsc::TrySendError::Full(block) | mpsc::TrySendError::Disconnected(block)) =
            self.filled.try_send(block)
        {
            let _ = self.recycle.try_send(block);
        }
    }
}

/// The forwarding thread's end of the pool.
struct BlockSink {
    filled: mpsc::Receiver<Vec<u8>>,
    free: mpsc::SyncSender<Vec<u8>>,
}

impl BlockSink {
    /// Take the next filled block, immediately topping the pool back up.
    ///
    /// The Tauri channel takes ownership of the bytes, so a replacement has to
    /// be allocated somewhere — and this thread, not the audio callback, is
    /// where that belongs. The pool never grows past `POOL_BLOCKS` buffers, so
    /// `free` always has room for the replacement.
    fn take(&self, timeout: Duration) -> Result<Vec<u8>, mpsc::RecvTimeoutError> {
        let block = self.filled.recv_timeout(timeout)?;
        let _ = self
            .free
            .try_send(Vec::with_capacity(block.capacity().max(BLOCK_CAP_BYTES)));
        Ok(block)
    }
}

/// Build the pool, pre-filled so the very first callback already has a buffer.
fn block_pipe() -> (BlockPipe, BlockSink) {
    let (filled_tx, filled_rx) = mpsc::sync_channel::<Vec<u8>>(POOL_BLOCKS);
    let (free_tx, free_rx) = mpsc::sync_channel::<Vec<u8>>(POOL_BLOCKS);
    for _ in 0..POOL_BLOCKS {
        let _ = free_tx.try_send(Vec::with_capacity(BLOCK_CAP_BYTES));
    }
    (
        BlockPipe {
            free: free_rx,
            filled: filled_tx,
            recycle: free_tx.clone(),
        },
        BlockSink {
            filled: filled_rx,
            free: free_tx,
        },
    )
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
    // the capture thread is all it does. The atomic is lock-free; the unpark
    // send is the one non-realtime-safe act left on this thread, and it happens
    // exactly once, on a stream that has ALREADY failed.
    let err_dead = Arc::clone(&state.dead);
    let err_stop = stop_tx.clone();
    // Preallocated block pool: the audio callback fills buffers, this thread
    // forwards them. See BlockPipe — nothing allocates on the audio thread.
    let (pipe, sink) = block_pipe();
    std::thread::spawn(move || {
        let ch = channels as usize;
        let stream = device.build_input_stream(
            config.into(),
            move |data: &[f32], _| pipe.push(data, ch),
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
                // Forward captured blocks to the webview until stop. Everything
                // that must NOT happen on the audio thread happens here: the
                // channel send (unbounded, it talks to the webview) and the
                // allocation that tops the pool back up.
                loop {
                    match stop_rx.try_recv() {
                        Ok(()) | Err(mpsc::TryRecvError::Disconnected) => break,
                        Err(mpsc::TryRecvError::Empty) => {}
                    }
                    match sink.take(FORWARD_POLL) {
                        Ok(block) => {
                            // A send failure means the webview side is gone; the
                            // stop command will tear us down shortly — nothing
                            // to do here.
                            let _ = on_samples.send(InvokeResponseBody::Raw(block));
                        }
                        // Idle tick: no block this period, just re-check stop.
                        // Bounds how long a stop waits, nothing else — capture
                        // continues into the pool throughout.
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
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

    fn converted(data: &[f32], channels: usize) -> Vec<u8> {
        let mut out = Vec::new();
        fill_stereo_le_bytes(&mut out, data, channels);
        out
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
        let out = converted(&[0.1, -0.2, 0.3, -0.4], 2);
        assert_eq!(floats(&out), vec![0.1, -0.2, 0.3, -0.4]);
    }

    #[test]
    fn mono_duplicates() {
        let out = converted(&[0.5, -0.5], 1);
        assert_eq!(floats(&out), vec![0.5, 0.5, -0.5, -0.5]);
    }

    #[test]
    fn surround_takes_front_pair() {
        // 5.1 frame: FL FR C LFE RL RR
        let out = converted(&[0.1, 0.2, 9.0, 9.0, 9.0, 9.0], 6);
        assert_eq!(floats(&out), vec![0.1, 0.2]);
    }

    #[test]
    fn refilling_a_pooled_buffer_never_reallocates() {
        // Audit E4: the conversion used to allocate a fresh Vec per callback,
        // on the realtime audio thread. A pooled buffer must be pure overwrite.
        let mut block = Vec::with_capacity(BLOCK_CAP_BYTES);
        let capacity = block.capacity();
        let addr = block.as_ptr();
        let period = vec![0.25f32; 960]; // 480 stereo frames, a 10 ms WASAPI period
        for _ in 0..1000 {
            fill_stereo_le_bytes(&mut block, &period, 2);
        }
        assert_eq!(block.len(), 480 * 2 * 4);
        assert_eq!(
            block.capacity(),
            capacity,
            "the pooled buffer must be reused"
        );
        assert_eq!(block.as_ptr(), addr, "reuse means the SAME allocation");
    }

    #[test]
    fn a_backed_up_pipe_drops_blocks_instead_of_blocking() {
        // The audio thread must never wait on the forwarder. With nothing
        // draining, the pool empties and further blocks are simply dropped.
        let (pipe, sink) = block_pipe();
        let period = vec![0.5f32; 64];
        for _ in 0..POOL_BLOCKS * 4 {
            pipe.push(&period, 2); // must not block or panic
        }
        let mut delivered = 0;
        while sink.take(Duration::from_millis(1)).is_ok() {
            delivered += 1;
        }
        assert_eq!(
            delivered, POOL_BLOCKS,
            "the pool bounds what is in flight; the rest are dropped"
        );
    }

    #[test]
    fn a_refused_block_is_recycled_rather_than_freed() {
        // Dropping the Vec here would run the allocator on the audio thread —
        // the same defect as allocating. A rendezvous channel with no receiver
        // waiting refuses every send, so this forces the recycle path.
        let (filled_tx, _filled_rx) = mpsc::sync_channel::<Vec<u8>>(0);
        let (free_tx, free_rx) = mpsc::sync_channel::<Vec<u8>>(POOL_BLOCKS);
        let only_block = Vec::with_capacity(BLOCK_CAP_BYTES);
        let addr = only_block.as_ptr();
        free_tx.try_send(only_block).unwrap();

        let pipe = BlockPipe {
            free: free_rx,
            filled: filled_tx,
            recycle: free_tx,
        };
        pipe.push(&[0.1f32; 64], 2);

        let returned = pipe
            .free
            .try_recv()
            .expect("the refused block must come back to the pool, not be dropped");
        assert_eq!(returned.as_ptr(), addr, "it must be the SAME allocation");
        assert_eq!(
            returned.capacity(),
            BLOCK_CAP_BYTES,
            "capacity survives the round trip"
        );
    }

    #[test]
    fn the_forwarder_keeps_the_pool_topped_up() {
        // Every block handed to the Tauri channel is consumed by it, so the
        // sink has to replace it — otherwise the pool drains to nothing and the
        // capture goes permanently silent after POOL_BLOCKS callbacks.
        let (pipe, sink) = block_pipe();
        let period = vec![0.5f32; 128];
        for _ in 0..POOL_BLOCKS * 10 {
            pipe.push(&period, 2);
            let block = sink
                .take(Duration::from_millis(500))
                .expect("a pushed block must arrive");
            assert_eq!(block.len(), 64 * 2 * 4);
            drop(block); // the channel send would consume it the same way
        }
    }
}
