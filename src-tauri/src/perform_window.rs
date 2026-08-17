//! FEAT-009 — the second-display performance window: creation, monitor
//! targeting, fullscreen and the escape ladder. The window itself is a pure
//! render mirror (see src/perform/ on the frontend); everything here is
//! lifecycle.
//!
//! Ownership model: the RUST side owns the window. The frontend never gets
//! window-management ACL grants — the perform webview has NO capability
//! entry at all, and both windows drive lifecycle exclusively through these
//! app commands (app commands are not capability-gated; the perform window
//! can therefore ask to close itself, but cannot touch fs/dialog/updater).
//!
//! Positioning is done in PHYSICAL coordinates end to end. Mixed-DPI setups
//! are exactly where logical math goes wrong: a logical position is relative
//! to a monitor whose scale factor the builder cannot know yet, so the
//! window is created hidden, placed by physical position, fullscreened,
//! then shown.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The performance window's label. The frontend entry branches on it
/// (src/perform/context.ts) and the capability file deliberately does NOT
/// list it.
pub const PERFORM_LABEL: &str = "perform";
/// The config-defined operator window (no explicit label in tauri.conf.json
/// means "main").
pub const MAIN_LABEL: &str = "main";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PerformMonitor {
    pub index: usize,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale: f64,
    pub primary: bool,
}

/// Pick the target monitor: an explicit in-range index wins; anything else
/// (auto, or an index stale after hotplug) falls back to the largest
/// non-primary monitor — the projector/TV in every ordinary dual setup —
/// and a single-monitor machine lands on the primary. Pure, so the hotplug
/// clamp is unit-tested without a window system.
pub fn resolve_monitor(monitors: &[PerformMonitor], want: Option<usize>) -> usize {
    if monitors.is_empty() {
        return 0;
    }
    if let Some(i) = want {
        if i < monitors.len() {
            return i;
        }
    }
    let mut best: Option<usize> = None;
    for (i, m) in monitors.iter().enumerate() {
        if m.primary {
            continue;
        }
        let area = u64::from(m.width) * u64::from(m.height);
        let better = match best {
            Some(b) => area > u64::from(monitors[b].width) * u64::from(monitors[b].height),
            None => true,
        };
        if better {
            best = Some(i);
        }
    }
    best.unwrap_or_else(|| monitors.iter().position(|m| m.primary).unwrap_or(0))
}

/// Windowed (non-fullscreen) size on a monitor: 60% of the panel, clamped to
/// a sane floor so a tiny control-room monitor still yields a usable window.
pub fn windowed_rect(m: &PerformMonitor) -> (i32, i32, u32, u32) {
    let w = ((f64::from(m.width) * 0.6) as u32).max(480);
    let h = ((f64::from(m.height) * 0.6) as u32).max(270);
    let x = m.x + ((m.width.saturating_sub(w)) / 2) as i32;
    let y = m.y + ((m.height.saturating_sub(h)) / 2) as i32;
    (x, y, w, h)
}

fn monitor_list<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<PerformMonitor>, String> {
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, m)| PerformMonitor {
            index,
            name: m.name().cloned().unwrap_or_default(),
            width: m.size().width,
            height: m.size().height,
            x: m.position().x,
            y: m.position().y,
            scale: m.scale_factor(),
            // Monitor carries no is_primary flag; the primary is identified
            // by position+size equality with primary_monitor()'s answer.
            primary: primary
                .as_ref()
                .is_some_and(|p| p.position() == m.position() && p.size() == m.size()),
        })
        .collect())
}

fn place<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    target: Option<&PerformMonitor>,
    fullscreen: bool,
) -> Result<(), String> {
    let err = |e: tauri::Error| e.to_string();
    if fullscreen {
        // Land on the monitor FIRST (physical coords), then fullscreen —
        // borderless fullscreen takes whichever monitor the window is on.
        if let Some(m) = target {
            window
                .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: m.x,
                    y: m.y,
                }))
                .map_err(err)?;
        }
        window.set_fullscreen(true).map_err(err)?;
    } else {
        // Leaving fullscreen: drop it first, then size/center on the target.
        window.set_fullscreen(false).map_err(err)?;
        if let Some(m) = target {
            let (x, y, w, h) = windowed_rect(m);
            window
                .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
                .map_err(err)?;
            window
                .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: w,
                    height: h,
                }))
                .map_err(err)?;
        }
    }
    Ok(())
}

/// Enumerate displays for the drawer's picker. Re-queried every time the
/// drawer opens — that re-enumeration, plus `resolve_monitor`'s clamp at
/// open time, is the whole monitor-hotplug story: no event polling.
#[tauri::command]
pub fn perform_monitors(app: AppHandle) -> Result<Vec<PerformMonitor>, String> {
    monitor_list(&app)
}

/// Open (or re-place) the performance window on the chosen monitor.
/// Idempotent: an existing window is moved/fullscreened, never duplicated.
///
/// `async fn` on every command below that touches the window, deliberately:
/// a synchronous command runs ON the main thread, and
/// WebviewWindowBuilder::build() (plus tao's window setters) round-trips
/// through the main-thread event loop — from the main thread that wait
/// deadlocks the whole app (the documented Windows create-window-in-command
/// rule; caught live by this lane's device harness, where perform_open hung
/// the shell). Async commands run on the runtime's pool, where the
/// round-trip is safe.
#[tauri::command]
pub async fn perform_open(
    app: AppHandle,
    monitor: Option<usize>,
    fullscreen: bool,
) -> Result<(), String> {
    let monitors = monitor_list(&app)?;
    let target = monitors.get(resolve_monitor(&monitors, monitor)).cloned();

    if let Some(existing) = app.get_webview_window(PERFORM_LABEL) {
        place(&existing, target.as_ref(), fullscreen)?;
        return Ok(());
    }

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        PERFORM_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Beatform — Performance Output")
    // Hidden until placed: creating visible then jumping monitors flashes
    // the window on the operator display first.
    .visible(false)
    // The operator keeps keyboard focus (mode keys, blackout) — the output
    // window never steals it on open.
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;
    place(&window, target.as_ref(), fullscreen)?;
    window.show().map_err(|e| e.to_string())?;
    let _ = app.emit_to(MAIN_LABEL, "perform:opened", ());
    Ok(())
}

#[tauri::command]
pub async fn perform_set_fullscreen(app: AppHandle, fullscreen: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(PERFORM_LABEL)
        .ok_or("performance window is not open")?;
    place(&window, None, fullscreen)
}

/// Double-click on the output surface.
#[tauri::command]
pub async fn perform_toggle_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(PERFORM_LABEL)
        .ok_or("performance window is not open")?;
    let fs = window.is_fullscreen().map_err(|e| e.to_string())?;
    place(&window, None, !fs)
}

/// The escape ladder, from the output window's own keyboard: fullscreen
/// steps down to a movable window first; a second Escape closes it. Closing
/// fires WindowEvent::Destroyed, which lib.rs turns into `perform:closed`
/// for the operator UI.
#[tauri::command]
pub async fn perform_escape(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(PERFORM_LABEL)
        .ok_or("performance window is not open")?;
    if window.is_fullscreen().map_err(|e| e.to_string())? {
        place(&window, None, false)
    } else {
        window.close().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn perform_close(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PERFORM_LABEL) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn perform_is_open(app: AppHandle) -> bool {
    app.get_webview_window(PERFORM_LABEL).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(index: usize, w: u32, h: u32, primary: bool) -> PerformMonitor {
        PerformMonitor {
            index,
            name: format!("m{index}"),
            width: w,
            height: h,
            x: index as i32 * 2560,
            y: 0,
            scale: 1.0,
            primary,
        }
    }

    #[test]
    fn explicit_in_range_index_wins() {
        let ms = vec![mon(0, 2560, 1440, true), mon(1, 1920, 1080, false)];
        assert_eq!(resolve_monitor(&ms, Some(0)), 0);
        assert_eq!(resolve_monitor(&ms, Some(1)), 1);
    }

    #[test]
    fn stale_index_after_hotplug_falls_back_to_auto() {
        // Three monitors yesterday, two today: the persisted index 2 must
        // clamp to the auto pick, not panic or land on the wrong panel.
        let ms = vec![mon(0, 2560, 1440, true), mon(1, 1920, 1080, false)];
        assert_eq!(resolve_monitor(&ms, Some(2)), 1);
    }

    #[test]
    fn auto_prefers_the_largest_non_primary() {
        let ms = vec![
            mon(0, 2560, 1440, true),
            mon(1, 1280, 720, false),
            mon(2, 3840, 2160, false),
        ];
        assert_eq!(resolve_monitor(&ms, None), 2);
    }

    #[test]
    fn single_monitor_lands_on_primary() {
        let ms = vec![mon(0, 2560, 1440, true)];
        assert_eq!(resolve_monitor(&ms, None), 0);
        // ...even when the stored index is stale.
        assert_eq!(resolve_monitor(&ms, Some(1)), 0);
    }

    #[test]
    fn empty_monitor_list_degrades_to_zero() {
        assert_eq!(resolve_monitor(&[], None), 0);
        assert_eq!(resolve_monitor(&[], Some(3)), 0);
    }

    #[test]
    fn primary_without_flag_match_still_resolves() {
        // A monitor list where the primary probe failed (all flags false):
        // auto still picks the largest and never panics.
        let ms = vec![mon(0, 1920, 1080, false), mon(1, 2560, 1440, false)];
        assert_eq!(resolve_monitor(&ms, None), 1);
    }

    #[test]
    fn windowed_rect_is_60_percent_centered() {
        let m = mon(1, 1920, 1080, false);
        let (x, y, w, h) = windowed_rect(&m);
        assert_eq!((w, h), (1152, 648));
        assert_eq!(x, 2560 + (1920 - 1152) / 2);
        assert_eq!(y, (1080 - 648) / 2);
    }

    #[test]
    fn windowed_rect_clamps_tiny_monitors() {
        let m = mon(0, 640, 400, false);
        let (_, _, w, h) = windowed_rect(&m);
        assert_eq!((w, h), (480, 270));
    }
}
