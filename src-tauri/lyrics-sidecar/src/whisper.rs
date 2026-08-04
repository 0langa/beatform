//! whisper-cli supervision and `-ojf` full-JSON parsing.
//!
//! Transcription runs on the FULL MIX (spike adjustment 3): on the eval
//! corpus the mix segmented into musical lines while raw-stem input produced
//! run-ons — the stem's job is VAD + (phase 3) alignment, not transcription.

use serde::Deserialize;

/// The subset of whisper.cpp's `-ojf` output this pipeline consumes.
/// Field shapes documented from the spike's format samples
/// (`transcripts/format-sample-ssb-stem-word.json`).
#[derive(Deserialize, Debug)]
pub struct WhisperJson {
    #[serde(default)]
    pub result: WhisperResult,
    #[serde(default)]
    pub transcription: Vec<WhisperSegment>,
}

#[derive(Deserialize, Debug, Default)]
pub struct WhisperResult {
    #[serde(default)]
    pub language: String,
}

#[derive(Deserialize, Debug)]
pub struct WhisperSegment {
    pub offsets: MsSpan,
    pub text: String,
    #[serde(default)]
    pub tokens: Vec<WhisperToken>,
}

#[derive(Deserialize, Debug)]
pub struct WhisperToken {
    pub text: String,
    pub offsets: MsSpan,
    /// Token probability 0..1 — phase 3's confidence-highlight input; here it
    /// only breaks ties when choosing split points.
    #[serde(default)]
    pub p: f64,
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub struct MsSpan {
    pub from: i64,
    pub to: i64,
}

pub fn parse(json: &str) -> Result<WhisperJson, String> {
    serde_json::from_str(json).map_err(|e| format!("whisper JSON parse failed: {e}"))
}

/// Special/meta tokens ("[_BEG_]", "[_TT_500]") carry no text.
pub fn is_meta_token(text: &str) -> bool {
    text.starts_with("[_") && text.ends_with(']')
}

/// True when a segment's text is non-speech filler whisper likes to emit on
/// music: "[Music]", "(instrumental)", "♪ ♪", "*applause*" — nothing a lyric
/// line should carry. A line qualifies when stripping bracketed/parenthesized
/// runs and non-alphanumeric symbols leaves nothing.
pub fn is_non_speech_text(text: &str) -> bool {
    let mut depth = 0i32;
    let mut in_star = false; // *stage direction* — '*' toggles like a bracket
    let mut has_content = false;
    for c in text.chars() {
        match c {
            '[' | '(' | '{' => depth += 1,
            ']' | ')' | '}' => depth = (depth - 1).max(0),
            '*' => in_star = !in_star,
            '♪' | '♫' => {}
            c if depth == 0 && !in_star && c.is_alphanumeric() => {
                has_content = true;
                break;
            }
            _ => {}
        }
    }
    !has_content
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed straight from the spike's real `-ojf` output.
    const SAMPLE: &str = r#"{
      "systeminfo": "WHISPER : COREML = 0",
      "model": { "type": "small" },
      "params": { "language": "en" },
      "result": { "language": "en" },
      "transcription": [
        {
          "timestamps": { "from": "00:00:00,000", "to": "00:00:00,000" },
          "offsets": { "from": 0, "to": 0 },
          "text": "",
          "tokens": [
            { "text": "[_BEG_]", "timestamps": { "from": "00:00:00,000", "to": "00:00:00,000" },
              "offsets": { "from": 0, "to": 0 }, "id": 50364, "p": 0.796148, "t_dtw": -1 }
          ]
        },
        {
          "timestamps": { "from": "00:00:01,480", "to": "00:00:01,840" },
          "offsets": { "from": 1480, "to": 1840 },
          "text": " say can",
          "tokens": [
            { "text": " say", "timestamps": { "from": "00:00:01,480", "to": "00:00:01,840" },
              "offsets": { "from": 1480, "to": 1840 }, "id": 584, "p": 0.963371, "t_dtw": -1 },
            { "text": " can", "timestamps": { "from": "00:00:01,840", "to": "00:00:03,220" },
              "offsets": { "from": 1840, "to": 3220 }, "id": 393, "p": 0.808402, "t_dtw": -1 }
          ]
        }
      ]
    }"#;

    #[test]
    fn parses_the_spike_format_sample_shape() {
        let parsed = parse(SAMPLE).unwrap();
        assert_eq!(parsed.result.language, "en");
        assert_eq!(parsed.transcription.len(), 2);
        let seg = &parsed.transcription[1];
        assert_eq!(seg.offsets.from, 1480);
        assert_eq!(seg.offsets.to, 1840);
        assert_eq!(seg.text, " say can");
        assert_eq!(seg.tokens.len(), 2);
        assert!(is_meta_token(&parsed.transcription[0].tokens[0].text));
        assert!((seg.tokens[0].p - 0.963371).abs() < 1e-9);
    }

    #[test]
    fn a_missing_result_or_tokens_degrades_instead_of_failing() {
        let parsed =
            parse(r#"{ "transcription": [ { "offsets": {"from": 5, "to": 9}, "text": "x" } ] }"#)
                .unwrap();
        assert_eq!(parsed.result.language, "");
        assert_eq!(parsed.transcription[0].tokens.len(), 0);
    }

    #[test]
    fn non_speech_filler_is_recognized() {
        for t in [
            "[Music]",
            " (instrumental) ",
            "♪ ♪ ♪",
            "*applause*",
            "[MUSIC PLAYING]",
            "",
        ] {
            assert!(is_non_speech_text(t), "{t:?} should be non-speech");
        }
        for t in [" say can you see", "Ba-da (ooh) da", "99 problems"] {
            assert!(!is_non_speech_text(t), "{t:?} is real text");
        }
    }
}
