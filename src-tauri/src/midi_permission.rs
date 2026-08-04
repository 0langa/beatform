//! Web MIDI permission for the WebView2 webview (VERIFY-003).
//!
//! Chromium gates ALL Web MIDI access (sysex or not) behind a permission
//! since the `BlockMidiByDefault` rollout, and WebView2 surfaces that as a
//! `PermissionRequested` event of kind MIDI_SYSTEM_EXCLUSIVE_MESSAGES — the
//! only MIDI kind the WebView2 API has. Unhandled, the request is denied
//! silently, so `navigator.requestMIDIAccess()` rejects and the whole MIDI
//! mapping feature was dead on the shipped transport (the pure mapping core
//! was fine; the E2E harness caught the gap the moment it drove the real
//! path). The fix: allow exactly that kind, for the app's own origins only.
//!
//! wry registers its own `PermissionRequested` handler for clipboard-read;
//! COM events are multicast, both handlers run, and each sets state only for
//! its own kind — no interference.

#![cfg(windows)]

use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES,
    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
};
use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
use windows_core::PWSTR;

/// Origins the app itself is served from — dev (Vite) and production
/// (Tauri's localhost protocol). Anything else keeps the deny default.
fn own_origin(uri: &str) -> bool {
    uri.starts_with("http://localhost:1420")
        || uri.starts_with("http://127.0.0.1:1420")
        || uri.starts_with("tauri://localhost")
        || uri.starts_with("http://tauri.localhost")
        || uri.starts_with("https://tauri.localhost")
}

/// Install the handler on a webview. Called from `on_page_load` (the
/// config-defined window does not exist yet when `setup` runs, so a
/// setup-time `get_webview_window("main")` finds nothing — the reason the
/// first wiring of this module silently installed on no window at all);
/// the caller guards against installing more than once. Best-effort: on any
/// failure the app keeps WebView2's default (deny), i.e. exactly the
/// behaviour before this module existed.
pub fn allow_midi<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    let res = webview.with_webview(|webview| {
        let controller = webview.controller();
        unsafe {
            let core = match controller.CoreWebView2() {
                Ok(c) => c,
                Err(e) => {
                    #[cfg(debug_assertions)]
                    eprintln!("[midi-permission] CoreWebView2 failed: {e}");
                    let _ = e;
                    return;
                }
            };
            let mut token = 0i64;
            let rc = core.add_PermissionRequested(
                &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                    args.PermissionKind(&mut kind)?;
                    #[cfg(debug_assertions)]
                    eprintln!("[midi-permission] request kind={}", kind.0);
                    if kind != COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES {
                        return Ok(());
                    }
                    let mut uri = PWSTR::null();
                    args.Uri(&mut uri)?;
                    let uri = take_pwstr(uri);
                    let allow = own_origin(&uri);
                    #[cfg(debug_assertions)]
                    eprintln!("[midi-permission] midi request from {uri} -> allow={allow}");
                    if allow {
                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                    }
                    Ok(())
                })),
                &mut token,
            );
            #[cfg(debug_assertions)]
            eprintln!("[midi-permission] handler installed: {rc:?}");
            let _ = rc;
        }
    });
    #[cfg(debug_assertions)]
    eprintln!("[midi-permission] with_webview dispatched: {res:?}");
    let _ = res;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn own_origin_accepts_app_and_rejects_web() {
        assert!(own_origin("http://localhost:1420/"));
        assert!(own_origin("http://127.0.0.1:1420/index.html"));
        assert!(own_origin("tauri://localhost/"));
        assert!(own_origin("http://tauri.localhost/"));
        assert!(own_origin("https://tauri.localhost/"));
        assert!(!own_origin("https://example.com/"));
        assert!(!own_origin("http://localhost:9999/"));
        assert!(!own_origin("https://localhost:1420.evil.com/"));
    }
}
