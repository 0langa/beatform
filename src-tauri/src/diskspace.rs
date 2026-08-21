//! Free-space queries for the export pre-flight.
//!
//! An owner-run ProRes 4444 export at 2560x1440@60 rendered for ELEVEN MINUTES
//! and wrote 7506 MB before dying, because the SYSTEM drive (which held
//! Chromium's blob storage and the staged mezzanine WAV) had 3.2 GB free of
//! 236 GB. The output drive had 518 GB free and was never the problem. Nothing
//! in the app looked at either number, so eleven minutes of GPU time were spent
//! on a job that was arithmetically impossible from the first frame.
//!
//! Two drives matter and they are usually different ones: where the file is
//! being written, and `%TEMP%` (scratch). This module answers "how much is free
//! at this path" for both; the estimate and the warning live in TypeScript
//! (`src/export/diskPreflight.ts`) where they are cheap to unit-test.

use std::path::{Path, PathBuf};

#[derive(serde::Serialize)]
pub struct DiskSpace {
    /// Bytes available to THIS user on the volume (quota-aware, which is what
    /// a write will actually get), not the volume-wide free total.
    pub free_bytes: u64,
    pub total_bytes: u64,
    /// The volume root as the user knows it ("C:\"), for naming the drive in
    /// the warning. Blaming the wrong drive is the whole bug this fixes.
    pub root: String,
}

/// The directory to ask the OS about, for a path that may not exist yet.
///
/// The export destination is a file the save dialog named but nothing has
/// created — querying it directly fails. Walk up to the first component that
/// exists; the volume is the same either way. Kept pure and separate so the
/// walk is testable without touching a real disk layout.
fn space_query_dir(path: &Path) -> PathBuf {
    let mut cur = path;
    loop {
        if cur.is_dir() {
            return cur.to_path_buf();
        }
        match cur.parent() {
            Some(p) if !p.as_os_str().is_empty() => cur = p,
            // No existing ancestor (bad path / unmounted drive): hand the
            // original back and let the OS call produce the real error.
            _ => return path.to_path_buf(),
        }
    }
}

/// The volume root of a path, for display ("C:\"). Falls back to the whole
/// path when there is no recognizable prefix, which is only reachable off
/// Windows or for a relative path (both already rejected upstream).
fn volume_root(path: &Path) -> String {
    let mut comps = path.components();
    match (comps.next(), comps.next()) {
        (Some(prefix @ std::path::Component::Prefix(_)), Some(std::path::Component::RootDir)) => {
            format!("{}\\", prefix.as_os_str().to_string_lossy())
        }
        _ => path.to_string_lossy().into_owned(),
    }
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        lp_directory_name: *const u16,
        lp_free_bytes_available_to_caller: *mut u64,
        lp_total_number_of_bytes: *mut u64,
        lp_total_number_of_free_bytes: *mut u64,
    ) -> i32;
}

#[cfg(windows)]
fn query(dir: &Path) -> Result<(u64, u64), String> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free: u64 = 0;
    let mut total: u64 = 0;
    let mut total_free: u64 = 0;
    // SAFETY: `wide` is a NUL-terminated UTF-16 buffer that outlives the call,
    // and the three out-pointers are to live u64s on this stack frame.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, &mut total_free) };
    if ok == 0 {
        return Err(format!(
            "could not read free space for {}: {}",
            dir.display(),
            std::io::Error::last_os_error()
        ));
    }
    Ok((free, total))
}

#[cfg(not(windows))]
fn query(dir: &Path) -> Result<(u64, u64), String> {
    Err(format!(
        "free-space queries are implemented for Windows only ({})",
        dir.display()
    ))
}

/// Free/total bytes on the volume holding `path`. `path` need not exist.
///
/// Main-window-only (R2-29): it answers for ANY path, so from a second
/// webview it is a volume-probe primitive (which drives exist, how full they
/// are) that a window whose job is drawing pixels has no business holding.
#[tauri::command]
pub fn disk_space(window: tauri::WebviewWindow, path: String) -> Result<DiskSpace, String> {
    crate::assert_main_window(&window)?;
    disk_space_impl(path)
}

/// The query itself, split from the command so it is unit-testable without a
/// window handle (the scan_dir/collect split, applied here by R2-29).
fn disk_space_impl(path: String) -> Result<DiskSpace, String> {
    let p = PathBuf::from(&path);
    let dir = space_query_dir(&p);
    let (free_bytes, total_bytes) = query(&dir)?;
    Ok(DiskSpace {
        free_bytes,
        total_bytes,
        root: volume_root(&dir),
    })
}

/// Where Chromium's blob spill and our staged mezzanine WAV land — `%TEMP%`,
/// i.e. the system drive on a default Windows install. The pre-flight has to
/// name THIS drive, not the output one.
///
/// Main-window-only (R2-29): the answer embeds the user-profile path (the
/// username with it) — not the perform window's to read.
#[tauri::command]
pub fn scratch_dir(window: tauri::WebviewWindow) -> Result<String, String> {
    crate::assert_main_window(&window)?;
    Ok(scratch_dir_impl())
}

/// Split for the same testability reason as disk_space_impl above.
fn scratch_dir_impl() -> String {
    std::env::temp_dir().to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_nonexistent_output_file_resolves_to_its_existing_folder() {
        // The save dialog names a file that does not exist yet; querying it
        // directly fails, which used to be the reason there was no pre-flight.
        let dir = std::env::temp_dir();
        let target = dir.join("no-such-subdir").join("nope.mov");
        assert_eq!(space_query_dir(&target), dir);
    }

    #[test]
    fn an_existing_directory_is_its_own_query_dir() {
        let dir = std::env::temp_dir();
        assert_eq!(space_query_dir(&dir), dir);
    }

    #[test]
    fn the_volume_root_is_the_drive_the_user_would_recognize() {
        #[cfg(windows)]
        {
            assert_eq!(volume_root(Path::new("C:\\Users\\x\\out.mov")), "C:\\");
            assert_eq!(volume_root(Path::new("D:\\out.mov")), "D:\\");
        }
        #[cfg(not(windows))]
        {
            assert_eq!(volume_root(Path::new("/tmp/x")), "/tmp/x");
        }
    }

    #[test]
    #[cfg(windows)]
    fn the_scratch_volume_reports_plausible_numbers() {
        let s = disk_space_impl(scratch_dir_impl()).expect("temp dir must be queryable");
        assert!(s.total_bytes > 0, "a mounted volume has a size");
        assert!(
            s.free_bytes <= s.total_bytes,
            "free {} must not exceed total {}",
            s.free_bytes,
            s.total_bytes
        );
        assert!(s.root.ends_with('\\'), "root should look like C:\\");
    }

    #[test]
    #[cfg(windows)]
    fn a_path_on_a_drive_that_does_not_exist_fails_instead_of_lying() {
        // Must NOT silently report the current drive's numbers — a pre-flight
        // that answers about the wrong volume is the bug it exists to prevent.
        let r = disk_space_impl("Q:\\definitely\\not\\mounted\\out.mov".into());
        assert!(r.is_err(), "unmounted drive must error");
    }
}
