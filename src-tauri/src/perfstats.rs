//! Process/system stats for the Settings ▸ Performance overlay.
//!
//! Polled at 1 Hz by the frontend WHILE the overlay is visible — nothing here
//! runs otherwise (no background thread, no timer; the `System` in managed
//! state is inert between calls). sysinfo's CPU numbers are diff-based, so the
//! state must persist across calls: the first sample reads 0 % and every
//! later one covers the interval since the previous poll (1 s ≫ sysinfo's
//! MINIMUM_CPU_UPDATE_INTERVAL of 200 ms).
//!
//! FAMILY aggregation: the exe alone is a fraction of what Beatform really
//! costs — the WebView2 runtime hosts the renderer/GPU/network/audio in its
//! own `msedgewebview2.exe` processes (mandatory Chromium architecture; they
//! can never be merged into the host exe). Those children identify themselves
//! on their command line with `--webview-exe-name=beatform.exe`, so the
//! family = this process + every msedgewebview2 whose cmdline carries that
//! marker. Family membership is re-scanned every SCAN_EVERY polls (a full
//! process-table walk) and only the known pids are refreshed in between.
//!
//! Disk I/O is reported as CUMULATIVE bytes summed over the family; the
//! frontend diffs consecutive samples into KB/s (clamped at 0, so the one
//! odd sample when a child process dies degrades to a 0-rate tick, never a
//! negative). GPU utilisation is deliberately `None` on this build: sysinfo
//! has no GPU support on Windows, and the D3DKMT/PDH "GPU Engine" routes are
//! undocumented-or-fiddly enough that a solid implementation does not fit in
//! a small dependency-free module — an honest "—" in the overlay beats a
//! flaky number.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

/// Full process-table rescans are ~ms-scale; membership changes are rare
/// (GPU/service processes spawn once, near startup). Rescan every 5th poll.
const SCAN_EVERY: u32 = 5;

struct Inner {
    sys: System,
    family: Vec<Pid>,
    polls_since_scan: u32,
}

/// Managed state: one `System` reused across polls so CPU deltas make sense.
pub struct PerfState(Mutex<Inner>);

impl Default for PerfState {
    fn default() -> Self {
        // `System::new()` loads nothing — the refreshes in `collect` pull
        // exactly the specifics the overlay shows.
        Self(Mutex::new(Inner {
            sys: System::new(),
            family: Vec::new(),
            polls_since_scan: 0,
        }))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStats {
    /// This process's CPU share of the WHOLE machine (sysinfo reports % of a
    /// single core, which can exceed 100 — normalised by core count so it is
    /// directly comparable with `system_cpu_pct`).
    process_cpu_pct: f32,
    /// CPU share of the whole Beatform family (exe + its WebView2 processes).
    family_cpu_pct: f32,
    /// All-core system CPU usage, 0–100.
    system_cpu_pct: f32,
    /// Resident memory of this process, bytes.
    process_mem_bytes: u64,
    /// Resident memory of the whole family, bytes — the number Task Manager's
    /// per-process views split across "Beatform" and "WebView2 Manager".
    family_mem_bytes: u64,
    /// Processes in the family this sample (exe + WebView2 children).
    family_count: u32,
    /// System RAM in use, bytes.
    mem_used_bytes: u64,
    /// Total system RAM, bytes.
    mem_total_bytes: u64,
    /// CUMULATIVE bytes the family has read from disk (rate derived
    /// frontend-side from consecutive samples).
    disk_read_bytes_total: u64,
    /// CUMULATIVE bytes the family has written to disk.
    disk_written_bytes_total: u64,
    /// GPU utilisation — always `None` on this build (see module docs).
    gpu_pct: Option<f32>,
}

/// Marker WebView2 stamps on every child it spawns for a given host exe.
fn family_marker(exe_name: &str) -> String {
    format!("--webview-exe-name={exe_name}")
}

/// Walk the full process table and (re)build the family pid list.
fn scan_family(sys: &mut System, self_pid: Pid, marker: &str) -> Vec<Pid> {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(sysinfo::UpdateKind::Always),
    );
    let mut family = vec![self_pid];
    for (pid, proc) in sys.processes() {
        if *pid == self_pid {
            continue;
        }
        let name = proc.name().to_string_lossy().to_ascii_lowercase();
        if !name.starts_with("msedgewebview2") {
            continue;
        }
        if proc
            .cmd()
            .iter()
            .any(|a| a.to_string_lossy().contains(marker))
        {
            family.push(*pid);
        }
    }
    family
}

/// The pure collection step, split from the command so it is unit-testable
/// without an AppHandle (same split as lib.rs's `scan_dir`).
fn collect(inner: &mut Inner, self_pid: Pid, marker: &str) -> PerfStats {
    if inner.family.is_empty() || inner.polls_since_scan >= SCAN_EVERY {
        inner.family = scan_family(&mut inner.sys, self_pid, marker);
        inner.polls_since_scan = 0;
    } else {
        inner.polls_since_scan += 1;
    }
    let sys = &mut inner.sys;
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&inner.family),
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_disk_usage(),
    );
    let cores = sys.cpus().len().max(1) as f32;
    let mut family_cpu = 0.0f32;
    let mut family_mem = 0u64;
    let mut family_count = 0u32;
    let mut read = 0u64;
    let mut written = 0u64;
    let mut process_cpu = 0.0f32;
    let mut process_mem = 0u64;
    for pid in &inner.family {
        let Some(p) = sys.process(*pid) else { continue };
        let cpu = p.cpu_usage() / cores;
        let du = p.disk_usage();
        family_cpu += cpu;
        family_mem += p.memory();
        family_count += 1;
        read += du.total_read_bytes;
        written += du.total_written_bytes;
        if *pid == self_pid {
            process_cpu = cpu;
            process_mem = p.memory();
        }
    }
    PerfStats {
        process_cpu_pct: process_cpu,
        family_cpu_pct: family_cpu,
        system_cpu_pct: sys.global_cpu_usage(),
        process_mem_bytes: process_mem,
        family_mem_bytes: family_mem,
        family_count,
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
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()))
        .unwrap_or_else(|| "beatform.exe".into());
    Ok(collect(
        &mut inner,
        Pid::from_u32(std::process::id()),
        &family_marker(&exe),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_reports_sane_values_for_own_process() {
        let mut inner = Inner {
            sys: System::new(),
            family: Vec::new(),
            polls_since_scan: 0,
        };
        let pid = Pid::from_u32(std::process::id());
        // The test runner has no WebView2 children — the family is just us,
        // which also exercises the scan path finding nothing extra.
        let marker = family_marker("definitely-not-a-real-exe.exe");
        let first = collect(&mut inner, pid, &marker);
        assert!(first.mem_total_bytes > 0);
        assert!(first.mem_used_bytes <= first.mem_total_bytes);
        assert_eq!(first.family_count, 1);

        // CPU numbers need two refreshes at least MINIMUM_CPU_UPDATE_INTERVAL
        // apart before they mean anything (1 Hz polling satisfies this).
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        let second = collect(&mut inner, pid, &marker);
        // The test runner itself is the observed process — it exists and has
        // resident memory; with no children the family equals the process.
        assert!(second.process_mem_bytes > 0);
        assert_eq!(second.family_mem_bytes, second.process_mem_bytes);
        assert!((0.0..=100.0).contains(&second.system_cpu_pct));
        // Normalised by core count, the process share fits the same scale.
        assert!((0.0..=100.0).contains(&second.process_cpu_pct));
        assert!(second.family_cpu_pct >= second.process_cpu_pct);
        // Cumulative counters never go backwards between samples while the
        // family membership is stable.
        assert!(second.disk_read_bytes_total >= first.disk_read_bytes_total);
        assert!(second.disk_written_bytes_total >= first.disk_written_bytes_total);
        // The honest skip: this build never invents a GPU number.
        assert!(second.gpu_pct.is_none());
    }
}
