mod loopback;
mod prores;

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
fn scan_audio_library(app: tauri::AppHandle, dir: String) -> Result<Vec<LibraryTrack>, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // No opener plugin. It was registered but never called from the frontend,
    // and its ACL expansion (`opener:default` -> `allow-open-url` scoped to
    // http://* and https://*) is a ready-made exfiltration primitive for
    // anything that manages to run script in the webview. The capability file
    // never granted it, so nothing was exposed — but a plugin that is present
    // and unused is one `opener:default` away from being exposed by accident.
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Auto-updater: checks the signed latest.json on GitHub Releases;
        // process provides relaunch() after an update installs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(loopback::LoopbackCtl::default())
        .manage(prores::ProresState::default())
        .invoke_handler(tauri::generate_handler![
            scan_audio_library,
            loopback::start_loopback,
            loopback::stop_loopback,
            loopback::loopback_died,
            prores::prores_audio_begin,
            prores::prores_audio_chunk,
            prores::prores_audio_end,
            prores::prores_begin,
            prores::anim_begin,
            prores::prores_write,
            prores::prores_finish,
            prores::prores_abort
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
}
