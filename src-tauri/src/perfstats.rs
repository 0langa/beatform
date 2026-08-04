//! Process/system stats for the Settings ▸ Performance overlay.
//!
//! Polled at 1 Hz by the frontend WHILE the overlay is visible — nothing here
//! runs otherwise (no background thread, no timer; the `System` in managed
//! state is inert between calls). sysinfo's CPU numbers are diff-based, so the
//! state must persist across calls: the first sample reads 0 % and every
//! later one covers the interval since the previous poll (1 s ≫ sysinfo's
//! MINIMUM_CPU_UPDATE_INTERVAL of 200 ms).
//!
//! Disk I/O is reported as CUMULATIVE bytes; the frontend diffs consecutive
//! samples into KB/s. GPU utilisation is deliberately `None` on this build:
//! sysinfo has no GPU support on Windows, and the D3DKMT/PDH "GPU Engine"
//! routes are undocumented-or-fiddly enough that a solid implementation does
//! not fit in a small dependency-free module — an honest "—" in the overlay
//! beats a flaky number.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Managed state: one `System` reused across polls so CPU deltas make sense.
pub struct PerfState(Mutex<System>);

impl Default for PerfState {
    fn default() -> Self {
        // `System::new()` loads nothing — the refreshes in `collect` pull
        // exactly the specifics the overlay shows.
        Self(Mutex::new(System::new()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
    /// This process's CPU share of the WHOLE machine (sysinfo reports % of a
    /// single core, which can exceed 100 — normalised by core count so it is
    /// directly comparable with `system_cpu_pct`).
    process_cpu_pct: f32,
    /// All-core system CPU usage, 0–100.
    system_cpu_pct: f32,
    /// Resident memory of this process, bytes.
    process_mem_bytes: u64,
    /// System RAM in use, bytes.
    mem_used_bytes: u64,
    /// Total system RAM, bytes.
    mem_total_bytes: u64,
    /// CUMULATIVE bytes this process has read from disk (rate derived
    /// frontend-side from consecutive samples).
    disk_read_bytes_total: u64,
    /// CUMULATIVE bytes this process has written to disk.
    disk_written_bytes_total: u64,
    /// GPU utilisation — always `None` on this build (see module docs).
    gpu_pct: Option<f32>,
}

/// The pure collection step, split from the command so it is unit-testable
/// without an AppHandle (same split as lib.rs's `scan_dir`).
fn collect(sys: &mut System, pid: Pid) -> PerfStats {
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_disk_usage(),
    );
    let cores = sys.cpus().len().max(1) as f32;
    let (process_cpu_pct, process_mem_bytes, read, written) = match sys.process(pid) {
        Some(p) => {
            let du = p.disk_usage();
            (
                p.cpu_usage() / cores,
                p.memory(),
                du.total_read_bytes,
                du.total_written_bytes,
            )
        }
        None => (0.0, 0, 0, 0),
    };
    PerfStats {
        process_cpu_pct,
        system_cpu_pct: sys.global_cpu_usage(),
        process_mem_bytes,
        mem_used_bytes: sys.used_memory(),
        mem_total_bytes: sys.total_memory(),
        disk_read_bytes_total: read,
        disk_written_bytes_total: written,
        gpu_pct: None,
    }
}

/// One stats sample for the performance overlay.
#[tauri::command]
pub fn perf_stats(state: tauri::State<'_, PerfState>) -> Result<PerfStats, String> {
    let mut sys = state.0.lock().map_err(|e| e.to_string())?;
    Ok(collect(&mut sys, Pid::from_u32(std::process::id())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_reports_sane_values_for_own_process() {
        let mut sys = System::new();
        let pid = Pid::from_u32(std::process::id());
        let first = collect(&mut sys, pid);
        assert!(first.mem_total_bytes > 0);
        assert!(first.mem_used_bytes <= first.mem_total_bytes);

        // CPU numbers need two refreshes at least MINIMUM_CPU_UPDATE_INTERVAL
        // apart before they mean anything (1 Hz polling satisfies this).
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let second = collect(&mut sys, pid);
        // The test runner itself is the observed process — it exists and has
        // resident memory.
        assert!(second.process_mem_bytes > 0);
        assert!((0.0..=100.0).contains(&second.system_cpu_pct));
        // Normalised by core count, the process share fits the same scale.
        assert!((0.0..=100.0).contains(&second.process_cpu_pct));
        // Cumulative counters never go backwards between samples.
        assert!(second.disk_read_bytes_total >= first.disk_read_bytes_total);
        assert!(second.disk_written_bytes_total >= first.disk_written_bytes_total);
        // The honest skip: this build never invents a GPU number.
        assert!(second.gpu_pct.is_none());
    }
}
