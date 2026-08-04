//! Separation-as-VAD (spike adjustment 3, after arXiv:2506.15514): the vocal
//! stem is not fed to whisper — its guaranteed value is telling us WHERE the
//! vocals are. Frame RMS on the stem -> hysteresis-free threshold -> gap
//! closing -> island dropping -> edge padding. Purely deterministic.

/// One vocal-active span, seconds.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Region {
    pub start: f64,
    pub end: f64,
}

pub const SAMPLE_RATE: usize = 44_100;
/// 20 ms analysis frames (the wav2vec2 leg's native resolution, a convenient
/// common grid for phase 3).
const FRAME: usize = SAMPLE_RATE / 50; // 882
/// Frames quieter than this relative to the stem's loudest frame are silence.
/// -38 dB below peak keeps breathy tails while rejecting isolation bleed
/// (the spike's synthetic-instrumental control collapsed to -35 dB below the
/// SOURCE mean, far below any real vocal).
const REL_THRESHOLD_DB: f64 = -38.0;
/// ...but never treat genuinely near-silent output as speech, whatever the
/// peak was (an instrumental's "loudest bleed frame" must not become 0 dB).
const ABS_FLOOR_DBFS: f64 = -55.0;
/// Gaps shorter than this merge into one region (intra-line breaths).
const CLOSE_GAP_SEC: f64 = 0.6;
/// Active islands shorter than this are dropped (isolated consonant bleed).
const MIN_REGION_SEC: f64 = 0.3;
/// Regions grow by this much per side (word onsets/offsets ride the edge).
const PAD_SEC: f64 = 0.2;

/// Frame RMS values in dBFS for a mono signal.
fn frame_rms_db(mono: &[f32]) -> Vec<f64> {
    mono.chunks(FRAME)
        .map(|c| {
            let sum: f64 = c.iter().map(|s| (*s as f64) * (*s as f64)).sum();
            let rms = (sum / c.len().max(1) as f64).sqrt();
            20.0 * rms.max(1e-10).log10()
        })
        .collect()
}

/// VAD verdict: the regions plus the stem's loudest-frame level, which is
/// what separates "no vocals — confidently" (near-silent stem, the spike's
/// instrumental control collapsed to about -68 dB) from "VAD may be broken"
/// (energetic stem but nothing crossed the threshold).
pub struct Verdict {
    pub regions: Vec<Region>,
    pub stem_peak_db: f64,
}

/// Vocal-active regions of a stereo stem. Pure; all knobs are consts above so
/// the whole detector is one deterministic function of the samples.
pub fn detect(left: &[f32], right: &[f32]) -> Verdict {
    let n = left.len().min(right.len());
    let mono: Vec<f32> = (0..n).map(|i| 0.5 * (left[i] + right[i])).collect();
    let db = frame_rms_db(&mono);
    let peak = db.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let threshold = (peak + REL_THRESHOLD_DB).max(ABS_FLOOR_DBFS);
    let active: Vec<bool> = db.iter().map(|v| *v > threshold).collect();
    Verdict {
        regions: regions_from_flags(&active, FRAME as f64 / SAMPLE_RATE as f64),
        stem_peak_db: peak,
    }
}

/// Below this loudest-frame level the stem is confidently vocal-free — the
/// VAD's empty answer is TRUSTED and whisper hallucinations get dropped.
pub const SILENT_STEM_PEAK_DB: f64 = -55.0;

/// Flags -> merged/pruned/padded regions. Split out (frame duration as a
/// parameter) so the shaping rules are testable without synthesizing audio.
pub fn regions_from_flags(active: &[bool], frame_sec: f64) -> Vec<Region> {
    let mut raw: Vec<Region> = Vec::new();
    let mut start: Option<usize> = None;
    for (i, a) in active.iter().enumerate() {
        match (*a, start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                raw.push(Region {
                    start: s as f64 * frame_sec,
                    end: i as f64 * frame_sec,
                });
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        raw.push(Region {
            start: s as f64 * frame_sec,
            end: active.len() as f64 * frame_sec,
        });
    }

    // Close small gaps first (so a region interrupted by breaths counts as one
    // long region BEFORE the min-length prune — order matters).
    let mut merged: Vec<Region> = Vec::new();
    for r in raw {
        match merged.last_mut() {
            Some(prev) if r.start - prev.end < CLOSE_GAP_SEC => prev.end = r.end,
            _ => merged.push(r),
        }
    }
    let total = active.len() as f64 * frame_sec;
    merged
        .into_iter()
        .filter(|r| r.end - r.start >= MIN_REGION_SEC)
        .map(|r| Region {
            start: (r.start - PAD_SEC).max(0.0),
            end: (r.end + PAD_SEC).min(total),
        })
        .collect()
}

/// Total active seconds — the "did this track have vocals at all" number.
pub fn total_active(regions: &[Region]) -> f64 {
    regions.iter().map(|r| r.end - r.start).sum()
}

/// Seconds of [start, end) that fall inside any region.
pub fn overlap(regions: &[Region], start: f64, end: f64) -> f64 {
    regions
        .iter()
        .map(|r| (r.end.min(end) - r.start.max(start)).max(0.0))
        .sum()
}

/// The largest fully-inactive gap strictly inside [start, end), as
/// (gap_start, gap_end). None when regions cover the span (or nearly so).
pub fn largest_gap_within(regions: &[Region], start: f64, end: f64) -> Option<(f64, f64)> {
    let mut inside: Vec<Region> = regions
        .iter()
        .filter(|r| r.end > start && r.start < end)
        .cloned()
        .collect();
    inside.sort_by(|a, b| a.start.partial_cmp(&b.start).expect("finite"));
    let mut best: Option<(f64, f64)> = None;
    let mut cursor = start;
    for r in &inside {
        if r.start > cursor {
            let cand = (cursor, r.start.min(end));
            if best.is_none_or(|b| cand.1 - cand.0 > b.1 - b.0) {
                best = Some(cand);
            }
        }
        cursor = cursor.max(r.end);
    }
    if cursor < end {
        let cand = (cursor, end);
        if best.is_none_or(|b| cand.1 - cand.0 > b.1 - b.0) {
            best = Some(cand);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(spec: &[(usize, bool)]) -> Vec<bool> {
        let mut v = Vec::new();
        for (count, val) in spec {
            v.extend(std::iter::repeat_n(*val, *count));
        }
        v
    }

    #[test]
    fn breath_gaps_merge_but_verse_gaps_do_not() {
        // 2 s active, 0.4 s gap (a breath), 2 s active, 3 s gap, 1 s active.
        // Frame = 0.1 s here for readable counts.
        let f = flags(&[(20, true), (4, false), (20, true), (30, false), (10, true)]);
        let r = regions_from_flags(&f, 0.1);
        assert_eq!(r.len(), 2, "breath merged, verse gap kept: {r:?}");
        assert!((r[0].start - 0.0).abs() < 1e-9);
        assert!((r[0].end - (4.4 + PAD_SEC)).abs() < 1e-9);
        assert!((r[1].start - (7.4 - PAD_SEC)).abs() < 1e-9);
    }

    #[test]
    fn tiny_islands_are_dropped() {
        let f = flags(&[(50, false), (2, true), (50, false)]); // 0.2 s blip
        assert!(regions_from_flags(&f, 0.1).is_empty());
    }

    #[test]
    fn an_all_quiet_stem_yields_no_regions_and_reads_as_silent() {
        let left = vec![0.00001f32; SAMPLE_RATE * 4];
        let right = vec![0.00001f32; SAMPLE_RATE * 4];
        let v = detect(&left, &right);
        assert!(v.regions.is_empty());
        assert!(
            v.stem_peak_db < SILENT_STEM_PEAK_DB,
            "a -100 dB stem must classify as confidently silent: {}",
            v.stem_peak_db
        );
    }

    #[test]
    fn a_sung_burst_in_silence_is_found_with_padding() {
        let n = SAMPLE_RATE * 6;
        let mut left = vec![0.0f32; n];
        // 2.0 s..4.0 s of loud tone.
        for (i, sample) in left
            .iter_mut()
            .enumerate()
            .take(SAMPLE_RATE * 4)
            .skip(SAMPLE_RATE * 2)
        {
            *sample = (2.0 * std::f32::consts::PI * 300.0 * (i as f32 / 44_100.0)).sin() * 0.4;
        }
        let right = left.clone();
        let v = detect(&left, &right);
        let r = v.regions;
        assert_eq!(r.len(), 1, "{r:?}");
        assert!(r[0].start > 1.5 && r[0].start < 2.05, "{r:?}");
        assert!(r[0].end > 3.95 && r[0].end < 4.5, "{r:?}");
        assert!(v.stem_peak_db > SILENT_STEM_PEAK_DB);
    }

    #[test]
    fn overlap_and_gap_helpers_measure_what_they_claim() {
        let regions = vec![
            Region {
                start: 1.0,
                end: 3.0,
            },
            Region {
                start: 10.0,
                end: 12.0,
            },
        ];
        assert!((overlap(&regions, 0.0, 2.0) - 1.0).abs() < 1e-9);
        assert!((overlap(&regions, 4.0, 9.0) - 0.0).abs() < 1e-9);
        assert!((total_active(&regions) - 4.0).abs() < 1e-9);
        let gap = largest_gap_within(&regions, 0.0, 13.0).unwrap();
        assert!((gap.0 - 3.0).abs() < 1e-9 && (gap.1 - 10.0).abs() < 1e-9);
        assert!(largest_gap_within(&regions, 1.0, 3.0).is_none());
    }
}
