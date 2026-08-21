mod diskspace;
mod loopback;
mod lyrics;
#[cfg(windows)]
mod midi_permission;
mod perform_window;
mod perfstats;
mod prores;
mod shadertoy;
#[cfg(windows)]
mod uninstall_entry;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
use serde::Serialize;
use tauri_plugin_fs::FsExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTrack {
    path: String,
    file_name: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_sec: Option<f64>,
}

const AUDIO_EXTS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus"];
/// Backstop against scanning a whole drive by accident; the UI says so when hit.
const MAX_TRACKS: usize = 5000;

/// FEAT-009 hardening: app commands are not capability-gated, so with the
/// performance window in the app EVERY registered command became callable
/// from a second webview that exists only to draw pixels. The capability
/// file already denies it all plugin/core surface (fs, dialog, updater);
/// this guard closes the app-command half for the categories that matter —
/// anything that spawns a process (ffmpeg, the lyrics sidecar, loopback
/// capture) or reads/writes through the app-global fs scope. R2-29 extended
/// it over the read-only telemetry too: `disk_space` probes ANY path's
/// volume (which drives exist, how full), `scratch_dir` embeds the
/// user-profile path, and `perf_stats` walks the process table — none of it
/// the pixels-only window's to read. Still intentionally open:
/// `transpile_shadertoy` (pure text transform), the perform_* family (the
/// perform window's own lifecycle), and `loopback_died` (one atomic bool,
/// and it takes no window handle to gate on).
///
/// Guarded commands take `window: tauri::WebviewWindow` as their first
/// parameter (injected by the IPC layer, invisible to the JS callers) and
/// call this first. The label-string core is split out so the policy is
/// unit-testable without a window handle.
pub(crate) fn assert_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    main_only_label(window.label())
}

fn main_only_label(label: &str) -> Result<(), String> {
    if label == perform_window::MAIN_LABEL {
        Ok(())
    } else {
        Err(format!(
            "this command is only available to the main window (called from '{label}')"
        ))
    }
}

/// DEBUG BUILDS ONLY: widen the fs scope to one explicit file path, standing
/// in for the save dialog's `allow_file` so the E2E harness can drive the
/// sidecar export lanes headlessly. Compiled to a hard error in release —
/// the dialog stays the only scope-widening path users ever run.
#[tauri::command]
fn debug_allow_path(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    assert_main_window(&window)?;
    #[cfg(debug_assertions)]
    {
        app.fs_scope()
            .allow_file(std::path::Path::new(&path))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, path);
        Err("debug builds only".into())
    }
}

/// R2-02: the streaming export writer stages every byte in a `<target>.partial`
/// sibling and renames over the target only on a fully successful finish, so a
/// cancelled or failed export can never destroy the file a previous export
/// left at the picked path. The save dialog's runtime grant covers EXACTLY the
/// picked file, so the sibling needs its own grant — derived STRICTLY from a
/// path the scope already allows: the webview can extend a grant the user's
/// own dialog pick created, never mint a fresh one. (The batch lane's
/// recursive folder grant covers the sibling on its own; the single-export
/// file grant does not, which is why this exists.)
#[tauri::command]
fn export_allow_partial(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    assert_main_window(&window)?;
    if !app.fs_scope().is_allowed(std::path::Path::new(&path)) {
        return Err(format!("Path not permitted: {path}"));
    }
    app.fs_scope()
        .allow_file(std::path::Path::new(&partial_sibling(&path)))
        .map_err(|e| e.to_string())
}

/// The one place the temp-sibling name is derived on this side; the TS writer
/// (videoExporter.ts, createTauriWriter) appends the identical suffix. A plain
/// string append keeps the sibling in the SAME directory — same volume — which
/// is what makes the final rename atomic.
fn partial_sibling(path: &str) -> String {
    format!("{path}.partial")
}

/// Recursively scan a user-picked folder for audio files and read their tags.
///
/// Gated on the fs plugin scope: tauri-plugin-dialog's folder picker calls
/// `allow_directory` on the chosen path (recursively — pickFolder passes
/// `recursive: true`), so a folder the user actually picked passes while an
/// arbitrary path a compromised renderer invents does not. Without the gate
/// this walked ANY path and returned up to MAX_TRACKS file paths + tags — a
/// filesystem-inventory primitive available to any script running in the
/// webview.
#[tauri::command]
fn scan_audio_library(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    dir: String,
) -> Result<Vec<LibraryTrack>, String> {
    assert_main_window(&window)?;
    let root = std::path::Path::new(&dir);
    if !app.fs_scope().is_allowed(root) {
        return Err(format!("Folder not permitted: {dir}"));
    }
    scan_dir(root)
}

/// The pure scan, split from the command so it is unit-testable without an
/// AppHandle. Per-file failures (unreadable tags, odd containers) degrade to a
/// filename-only entry — a scan must never fail because one file is broken.
/// Entries come back sorted by path for a stable listing.
fn scan_dir(root: &std::path::Path) -> Result<Vec<LibraryTrack>, String> {
    if !root.is_dir() {
        return Err(format!("Not a folder: {}", root.display()));
    }
    let mut tracks: Vec<LibraryTrack> = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if tracks.len() >= MAX_TRACKS {
            break;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_ascii_lowercase(),
            None => continue,
        };
        if !AUDIO_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let mut track = LibraryTrack {
            path: path.to_string_lossy().into_owned(),
            file_name,
            title: None,
            artist: None,
            album: None,
            duration_sec: None,
        };
        if let Ok(tagged) = lofty::read_from_path(path) {
            track.duration_sec = Some(tagged.properties().duration().as_secs_f64());
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                track.title = tag.title().map(|s| s.into_owned());
                track.artist = tag.artist().map(|s| s.into_owned());
                track.album = tag.album().map(|s| s.into_owned());
            }
        }
        tracks.push(track);
    }
    tracks.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(tracks)
}

/// Reveal an exported file or folder in Explorer with it pre-selected — the
/// narrowly scoped alternative to the opener/shell plugin that `run()`,
/// below, documents removing.
///
/// Gated on the fs plugin scope exactly like `scan_audio_library`: the save
/// dialog's flow calls `allow_file` on whatever path the user chose, so a
/// path that came from a real save passes while an arbitrary path a
/// compromised renderer invents on its own does not — the error names the
/// path.
#[tauri::command]
fn show_in_folder(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<(), String> {
    assert_main_window(&window)?;
    if !app.fs_scope().is_allowed(std::path::Path::new(&path)) {
        return Err(format!("Path not permitted: {path}"));
    }
    #[cfg(windows)]
    {
        let arg = explorer_select_arg(&path)?;
        std::process::Command::new("explorer.exe")
            .arg(arg)
            .spawn()
            .map_err(|e| format!("Failed to launch Explorer: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    Err("desktop only".into())
}

/// The pure part, split from the command so it is unit-testable without an
/// AppHandle or a spawned process: rejects a path that does not exist —
/// `explorer /select,` on a path that is missing silently opens a default
/// window instead of erroring, which would look identical to success — and
/// builds the ONE argument explorer requires. A FOLDER is a legitimate
/// target, not a special case to refuse: a PNG-sequence export's path is
/// one, and `explorer /select,<folder>` opens the folder's PARENT with the
/// folder itself selected, exactly as it does for a file. The comma must
/// stay attached to the path with no space in between: a second, separate
/// argument (or a space before the path) makes explorer open a default
/// window instead of selecting anything.
fn explorer_select_arg(path: &str) -> Result<String, String> {
    if !std::path::Path::new(path).exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    Ok(format!("/select,{path}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // No opener plugin. It was registered but never called from the frontend,
    // and its ACL expansion (`opener:default` -> `allow-open-url` scoped to
    // http://* and https://*) is a ready-made exfiltration primitive for
    // anything that manages to run script in the webview. The capability file
    // never granted it, so nothing was exposed — but a plugin that is present
    // and unused is one `opener:default` away from being exposed by accident.
    tauri::Builder::default()
        .setup(|_app| {
            // Repair the Windows uninstall entry's DisplayVersion (ALIGN-002:
            // it survived five updates stuck at 2.39.0). Best-effort, sync,
            // sub-millisecond; must never affect startup.
            #[cfg(windows)]
            uninstall_entry::heal();
            Ok(())
        })
        .on_page_load(|_webview, _payload| {
            // Web MIDI: without this, Chromium's permission gate silently
            // denies requestMIDIAccess inside WebView2 (VERIFY-003 finding).
            // on_page_load, NOT setup: the window doesn't exist yet in setup.
            // Fires on every navigation; install exactly once.
            //
            // FEAT-009 decision: the performance window deliberately gets NO
            // MIDI permission handler. The main window always loads first
            // (the perform window is created by a user action from it), so
            // the once-guard pins the handler to the operator webview; the
            // perform page runs no MIDI code — operator controls stay on the
            // primary display by design.
            #[cfg(windows)]
            {
                use std::sync::atomic::{AtomicBool, Ordering};
                static INSTALLED: AtomicBool = AtomicBool::new(false);
                if !INSTALLED.swap(true, Ordering::SeqCst) {
                    midi_permission::allow_midi(_webview);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Auto-updater: checks the signed latest.json on GitHub Releases;
        // process provides relaunch() after an update installs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(loopback::LoopbackCtl::default())
        .manage(prores::ProresState::default())
        .manage(perfstats::PerfState::default())
        .manage(lyrics::LyricsState::default())
        // The sidecars are long-running children (minutes of model inference;
        // minutes of GIF paletteuse): closing the app must not orphan them.
        // The export ffmpeg is worse than a leak — orphaned, it reads stdin
        // EOF as end-of-stream and finalizes a truncated file at the user's
        // chosen path, so it must die AND its partial output must go. Window
        // destruction is the reliable shutdown signal here (RunEvent::Exit
        // never fires for the plain `.run(ctx)` shape this app uses).
        //
        // Label-gated since FEAT-009: with a second (performance) window in
        // the app, "any window destroyed" would have killed a running export
        // ffmpeg the moment the OUTPUT window closed mid-show. The MAIN
        // window's destruction is the app-shutdown signal; it also takes the
        // performance window down with it so no orphan output survives the
        // operator (the close-flush hold in store.ts delays main's destroy,
        // not this). The performance window's own destruction only notifies
        // the operator UI, which flips its state and stops the mirror.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                use tauri::Manager;
                match window.label() {
                    perform_window::MAIN_LABEL => {
                        lyrics::kill_running_job(&window.state::<lyrics::LyricsState>());
                        prores::kill_running_job(&window.state::<prores::ProresState>());
                        if let Some(perform) = window
                            .app_handle()
                            .get_webview_window(perform_window::PERFORM_LABEL)
                        {
                            let _ = perform.destroy();
                        }
                    }
                    perform_window::PERFORM_LABEL => {
                        use tauri::Emitter;
                        let _ = window.app_handle().emit_to(
                            perform_window::MAIN_LABEL,
                            "perform:closed",
                            (),
                        );
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            debug_allow_path,
            export_allow_partial,
            scan_audio_library,
            show_in_folder,
            loopback::start_loopback,
            loopback::stop_loopback,
            loopback::loopback_died,
            prores::prores_audio_begin,
            prores::prores_audio_chunk,
            prores::prores_audio_end,
            prores::prores_begin,
            prores::av1_begin,
            prores::anim_begin,
            prores::prores_write,
            prores::prores_finish,
            prores::prores_abort,
            diskspace::disk_space,
            diskspace::scratch_dir,
            perfstats::perf_stats,
            shadertoy::transpile_shadertoy,
            lyrics::lyrics_models_state,
            lyrics::lyrics_model_download,
            lyrics::lyrics_download_cancel,
            lyrics::lyrics_model_verify,
            lyrics::lyrics_model_remove,
            lyrics::lyrics_audio_begin,
            lyrics::lyrics_audio_chunk,
            lyrics::lyrics_audio_end,
            lyrics::lyrics_gpu_probe,
            lyrics::lyrics_generate,
            lyrics::lyrics_generate_cancel,
            lyrics::lyrics_align_line,
            lyrics::debug_set_lyrics_models_dir,
            perform_window::perform_monitors,
            perform_window::perform_open,
            perform_window::perform_set_fullscreen,
            perform_window::perform_toggle_fullscreen,
            perform_window::perform_escape,
            perform_window::perform_close,
            perform_window::perform_is_open
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_filters_extensions_and_survives_junk() {
        let dir = std::env::temp_dir().join(format!("av-libscan-test-{}", std::process::id()));
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        // Not real audio — tag reading fails, entries must still appear.
        std::fs::write(dir.join("a.mp3"), b"junk").unwrap();
        std::fs::write(sub.join("b.flac"), b"junk").unwrap();
        std::fs::write(dir.join("notes.txt"), b"junk").unwrap();
        std::fs::write(dir.join("noext"), b"junk").unwrap();

        let tracks = scan_dir(&dir).unwrap();
        let names: Vec<&str> = tracks.iter().map(|t| t.file_name.as_str()).collect();
        assert_eq!(names, vec!["a.mp3", "b.flac"]); // sorted by path, junk skipped
        assert!(tracks.iter().all(|t| t.title.is_none()));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scan_rejects_non_directories() {
        assert!(scan_dir(std::path::Path::new("Z:/definitely/not/a/dir")).is_err());
    }

    #[test]
    fn main_window_guard_rejects_every_other_label() {
        // FEAT-009 hardening: process-spawning / fs-scope commands are
        // main-window-only — and since R2-29 the telemetry family
        // (disk_space, scratch_dir, perf_stats) plus export_allow_partial
        // (R2-02) route through this exact gate too. The performance window
        // is the label that exists today; the guard must also hold for any
        // window a future feature (or a bug) might mint.
        assert!(main_only_label(perform_window::MAIN_LABEL).is_ok());
        let err = main_only_label(perform_window::PERFORM_LABEL).unwrap_err();
        assert!(err.contains("perform"), "error names the caller: {err}");
        assert!(main_only_label("").is_err());
        assert!(main_only_label("main2").is_err());
        assert!(main_only_label("Main").is_err()); // labels are case-sensitive
        assert!(main_only_label("MAIN").is_err());
        assert!(main_only_label(" main").is_err()); // no whitespace laundering
        assert!(main_only_label("main\u{200b}").is_err()); // zero-width padding
    }

    #[test]
    fn the_partial_sibling_stays_next_to_its_target() {
        // R2-02: the TS writer appends the identical suffix — same directory,
        // same volume, which is what keeps the final rename atomic. A derived
        // name that moved directories would silently turn "atomic replace"
        // into a cross-volume copy that can fail half-way.
        assert_eq!(
            partial_sibling(r"C:\out\video.mp4"),
            r"C:\out\video.mp4.partial"
        );
        assert_eq!(partial_sibling("D:/x/loop.webm"), "D:/x/loop.webm.partial");
    }

    #[test]
    fn explorer_arg_rejects_a_missing_path() {
        let missing =
            std::env::temp_dir().join(format!("av-showfolder-missing-{}.mp4", std::process::id()));
        assert!(explorer_select_arg(&missing.to_string_lossy()).is_err());
    }

    #[test]
    fn explorer_arg_accepts_a_directory() {
        // A PNG-sequence export's path IS a folder — explorer /select,<dir>
        // opens the folder's parent with the folder itself selected, so this
        // is a legitimate target, not a special case to refuse.
        let dir = std::env::temp_dir().join(format!("av-showfolder-dir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let arg = explorer_select_arg(&dir.to_string_lossy()).unwrap();
        assert_eq!(arg, format!("/select,{}", dir.display()));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn explorer_arg_is_one_argument_with_no_space_before_the_path() {
        let dir = std::env::temp_dir().join(format!("av-showfolder-ok-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("out.mp4");
        std::fs::write(&file, b"junk").unwrap();

        let arg = explorer_select_arg(&file.to_string_lossy()).unwrap();
        assert_eq!(arg, format!("/select,{}", file.display()));
        // The whole point of the one-argument form: no space after the comma.
        assert!(!arg.contains(", "));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
