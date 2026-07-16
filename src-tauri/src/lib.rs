mod loopback;
mod prores;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
use serde::Serialize;

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

/// Recursively scan a folder for audio files and read their tags with lofty.
/// Per-file failures (unreadable tags, odd containers) degrade to a
/// filename-only entry — a library scan must never fail because one file is
/// broken. Entries come back sorted by path for a stable listing.
#[tauri::command]
fn scan_audio_library(dir: String) -> Result<Vec<LibraryTrack>, String> {
    let root = std::path::Path::new(&dir);
    if !root.is_dir() {
        return Err(format!("Not a folder: {dir}"));
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(loopback::LoopbackCtl::default())
        .manage(prores::ProresState::default())
        .invoke_handler(tauri::generate_handler![
            scan_audio_library,
            loopback::start_loopback,
            loopback::stop_loopback,
            prores::prores_set_audio,
            prores::prores_begin,
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

        let tracks = scan_audio_library(dir.to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = tracks.iter().map(|t| t.file_name.as_str()).collect();
        assert_eq!(names, vec!["a.mp3", "b.flac"]); // sorted by path, junk skipped
        assert!(tracks.iter().all(|t| t.title.is_none()));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scan_rejects_non_directories() {
        assert!(scan_audio_library("Z:/definitely/not/a/dir".into()).is_err());
    }
}
