//! Line-level LRC writer. The output must round-trip through the app's OWN
//! parser (`src/state/lyrics.ts` parseLrc): `[mm:ss.xx]text` lines, sorted,
//! strictly monotonic; `[by:]`/`[re:]` metadata lines are ignored by it.

use crate::lines::Line;

/// `[mm:ss.xx]` — centisecond precision, minutes clamped to the parser's
/// two-digit reach (a >100-minute single track is not a karaoke case; the
/// clamp keeps even that malformed input parseable rather than corrupt).
fn format_timestamp(t: f64) -> String {
    let t = t.max(0.0);
    // Saturate at [99:59.99] rather than wrapping — 599_999 cs total.
    let total_cs = ((t * 100.0).round() as u64).min(599_999);
    let cs = total_cs % 100;
    let secs = (total_cs / 100) % 60;
    let mins = total_cs / 6000;
    format!("[{mins:02}:{secs:02}.{cs:02}]")
}

pub fn write_lrc(lines: &[Line], generator: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!("[re:{generator}]\n"));
    for line in lines {
        out.push_str(&format_timestamp(line.t));
        out.push_str(&line.text);
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_format_as_the_parser_expects() {
        assert_eq!(format_timestamp(0.0), "[00:00.00]");
        assert_eq!(format_timestamp(1.234), "[00:01.23]");
        assert_eq!(format_timestamp(61.0), "[01:01.00]");
        assert_eq!(format_timestamp(3599.99), "[59:59.99]");
        assert_eq!(format_timestamp(-3.0), "[00:00.00]");
        assert_eq!(format_timestamp(99.0 * 60.0 + 59.999), "[99:59.99]"); // >99 min clamps into range
    }

    #[test]
    fn rounding_carries_into_seconds_and_minutes() {
        // 59.996 s rounds to 60.00 s — must become [01:00.00], not [00:60.00].
        assert_eq!(format_timestamp(59.996), "[01:00.00]");
    }

    #[test]
    fn the_document_shape_is_metadata_then_stamped_lines() {
        let lines = vec![
            Line {
                t: 1.48,
                text: "O say can you see".into(),
            },
            Line {
                t: 21.0,
                text: "Whose broad stripes".into(),
            },
        ];
        let lrc = write_lrc(&lines, "Beatform local lyrics v1");
        assert_eq!(
            lrc,
            "[re:Beatform local lyrics v1]\n[00:01.48]O say can you see\n[00:21.00]Whose broad stripes\n"
        );
    }
}
