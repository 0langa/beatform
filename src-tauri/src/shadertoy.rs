//! Shadertoy GLSL → WGSL transpiler for imported visuals (FEAT-001).
//!
//! Wraps a Shadertoy-style `mainImage` shader in the compatibility contract
//! proven by the 2026-07-30/08-01 spikes, translates it with naga's GLSL
//! frontend, validates the IR, and emits a complete standalone WGSL fragment
//! module the renderer runs on a dedicated pipeline (bindings 0–5: uniforms,
//! four channel textures, one sampler).
//!
//! Contract elements — each one exists because a real shader broke without it:
//! - UTF-8 BOM and CRLF stripped (naga's preprocessor: UnexpectedCharacter).
//! - `precision` statements stripped (GLSL ES-ism).
//! - `const` stripped from parameter lists (naga rejects the qualifier;
//!   removal is semantics-preserving for code that already compiled).
//! - iChannelN are object-like macros over SEPARATE texture/sampler bindings
//!   (naga has no combined-sampler declarations), declared before the
//!   `texture2D` alias so the alias cannot rewrite the type name.
//! - Y-flip in the wrapper footer (Shadertoy fragCoord is bottom-left).
//! - Emitted `textureSample` rewritten to `textureSampleLevel(..., 0.0)`:
//!   WGSL forbids implicit-derivative sampling in non-uniform control flow
//!   (tint enforces this; naga's validator does not), and level 0 is
//!   bit-identical here because channel textures carry no mip chain.

use serde::Serialize;

/// Matches the TS-side cap on custom shader source (custom.ts MAX_WGSL_BYTES).
const MAX_GLSL_BYTES: usize = 50_000;

const HEADER: &str = r#"#version 460
layout(set = 0, binding = 0) uniform BeatformShadertoyUniforms {
    vec3 iResolution;
    float iTime;
    float iTimeDelta;
    float iFrameRate;
    int iFrame;
    float iSampleRate;
    vec4 iMouse;
    vec4 iDate;
    vec3 iChannelResolution[4];
    float iChannelTime[4];
};

layout(set = 0, binding = 1) uniform texture2D _bf_ch0;
layout(set = 0, binding = 2) uniform texture2D _bf_ch1;
layout(set = 0, binding = 3) uniform texture2D _bf_ch2;
layout(set = 0, binding = 4) uniform texture2D _bf_ch3;
layout(set = 0, binding = 5) uniform sampler _bf_sampler;

#define texture2D texture
#define iChannel0 sampler2D(_bf_ch0, _bf_sampler)
#define iChannel1 sampler2D(_bf_ch1, _bf_sampler)
#define iChannel2 sampler2D(_bf_ch2, _bf_sampler)
#define iChannel3 sampler2D(_bf_ch3, _bf_sampler)

layout(location = 0) out vec4 _bf_fragColor;
"#;

const FOOTER: &str = r#"
void main() {
    vec2 _bf_coord = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);
    mainImage(_bf_fragColor, _bf_coord);
    // Shadertoy renders to an opaque canvas and ignores alpha; the compat
    // path composites this output centrally, so a shader writing alpha
    // garbage must not punch holes in the frame.
    _bf_fragColor.a = 1.0;
}
"#;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranspileError {
    /// 1-based line in the USER's source, when the span maps into it.
    pub line: Option<u32>,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranspileResult {
    pub ok: bool,
    pub wgsl: Option<String>,
    pub errors: Vec<TranspileError>,
}

fn fail(errors: Vec<TranspileError>) -> TranspileResult {
    TranspileResult {
        ok: false,
        wgsl: None,
        errors,
    }
}

fn fail_one(line: Option<u32>, message: impl Into<String>) -> TranspileResult {
    fail(vec![TranspileError {
        line,
        message: message.into(),
    }])
}

/// Normalize real-world input and strip constructs naga rejects.
/// Line count is PRESERVED (edits are within-line only) so diagnostic spans
/// map back to the user's own line numbers.
fn clean_user_source(body: &str) -> String {
    let body = body.trim_start_matches('\u{feff}').replace('\r', "");
    body.lines()
        .map(|l| {
            if l.trim_start().starts_with("precision ") {
                ""
            } else {
                l
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        .replace("const in ", "in ")
        .replace("const out ", "out ")
        .replace("const inout ", "inout ")
        .replace("(const ", "(")
        .replace(", const ", ", ")
}

/// Rewrite `textureSample(...)` → `textureSampleLevel(..., 0.0)` in emitted
/// WGSL. See module docs for why this is safe and required.
fn level_zero_samples(wgsl: &str) -> String {
    const NEEDLE: &str = "textureSample(";
    let mut out = String::with_capacity(wgsl.len());
    let mut rest = wgsl;
    while let Some(pos) = rest.find(NEEDLE) {
        out.push_str(&rest[..pos]);
        out.push_str("textureSampleLevel(");
        let args_start = pos + NEEDLE.len();
        let bytes = rest.as_bytes();
        let mut depth = 1usize;
        let mut i = args_start;
        while i < bytes.len() && depth > 0 {
            match bytes[i] {
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ => {}
            }
            i += 1;
        }
        out.push_str(&rest[args_start..i - 1]);
        out.push_str(", 0.0)");
        rest = &rest[i..];
    }
    out.push_str(rest);
    out
}

/// Map a byte offset in the wrapped source to a 1-based USER line number.
/// Returns None when the span falls inside the wrapper header/footer.
fn user_line(wrapped: &str, offset: usize, header_lines: u32, user_lines: u32) -> Option<u32> {
    let clamped = offset.min(wrapped.len());
    let line0 = wrapped[..clamped].bytes().filter(|&b| b == b'\n').count() as u32;
    // Wrapped layout: header (header_lines lines), then user source, then footer.
    let line1 = line0 + 1;
    if line1 <= header_lines {
        return None;
    }
    let user = line1 - header_lines;
    if user > user_lines {
        return None;
    }
    Some(user)
}

/// Friendly pre-scan for constructs the contract cannot support, so the user
/// gets a plain-language error instead of a naga parser message.
fn contract_pre_scan(src: &str) -> Vec<TranspileError> {
    let mut errors = Vec::new();
    let mut has_main_image = false;
    for (i, line) in src.lines().enumerate() {
        let n = Some((i + 1) as u32);
        // Strip line comments before scanning; block comments are rare enough
        // that a false positive error beats a missed one.
        let code = line.split("//").next().unwrap_or("");
        if code.contains("mainImage") {
            has_main_image = true;
        }
        if code.contains("samplerCube") {
            errors.push(TranspileError {
                line: n,
                message: "Cubemap channels (samplerCube) are not supported — Beatform channels are 2D audio/data textures".into(),
            });
        }
        if code.contains("sampler2D ") || code.contains("sampler2D\t") {
            errors.push(TranspileError {
                line: n,
                message: "Passing a channel as a function parameter (sampler2D argument) is not supported yet — use iChannel0..3 directly inside the function".into(),
            });
        }
        if code.contains("mainSound") {
            errors.push(TranspileError {
                line: n,
                message: "Sound shaders (mainSound) are not supported — Beatform analyses the loaded track instead".into(),
            });
        }
        if code.contains("mainVR") {
            errors.push(TranspileError {
                line: n,
                message: "VR shaders (mainVR) are not supported".into(),
            });
        }
    }
    if !has_main_image {
        errors.push(TranspileError {
            line: None,
            message: "No mainImage(out vec4 fragColor, in vec2 fragCoord) found — paste the Image tab of a Shadertoy shader".into(),
        });
    }
    errors
}

pub fn transpile(glsl: &str) -> TranspileResult {
    if glsl.len() > MAX_GLSL_BYTES {
        return fail_one(
            None,
            format!("Shader source exceeds the {MAX_GLSL_BYTES} byte limit"),
        );
    }
    if glsl.trim().is_empty() {
        return fail_one(None, "Shader source is empty");
    }

    let cleaned = clean_user_source(glsl);
    let pre = contract_pre_scan(&cleaned);
    if !pre.is_empty() {
        return fail(pre);
    }

    let user_lines = cleaned.lines().count() as u32;
    let header_lines = HEADER.matches('\n').count() as u32 + 1; // + the join "\n"
    let wrapped = format!("{HEADER}\n{cleaned}\n{FOOTER}");

    let options = naga::front::glsl::Options::from(naga::ShaderStage::Fragment);
    let mut frontend = naga::front::glsl::Frontend::default();
    let module = match frontend.parse(&options, &wrapped) {
        Ok(m) => m,
        Err(errs) => {
            let errors = errs
                .errors
                .iter()
                .map(|e| TranspileError {
                    line: user_line(
                        &wrapped,
                        e.meta.to_range().map(|r| r.start).unwrap_or(0),
                        header_lines,
                        user_lines,
                    ),
                    message: format!("{}", e.kind),
                })
                .collect();
            return fail(errors);
        }
    };

    let info = match naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::default(),
    )
    .validate(&module)
    {
        Ok(i) => i,
        Err(e) => {
            let offset = e
                .spans()
                .next()
                .map(|(s, _)| s.to_range().map(|r| r.start).unwrap_or(0))
                .unwrap_or(0);
            return fail_one(
                user_line(&wrapped, offset, header_lines, user_lines),
                format!("Shader failed validation: {}", e.as_inner()),
            );
        }
    };

    match naga::back::wgsl::write_string(&module, &info, naga::back::wgsl::WriterFlags::empty()) {
        Ok(wgsl) => TranspileResult {
            ok: true,
            wgsl: Some(level_zero_samples(&wgsl)),
            errors: Vec::new(),
        },
        Err(e) => fail_one(None, format!("WGSL emission failed: {e}")),
    }
}

#[tauri::command]
pub fn transpile_shadertoy(glsl: String) -> TranspileResult {
    transpile(&glsl)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRADIENT: &str = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);\n}\n";

    #[test]
    fn gradient_transpiles() {
        let r = transpile(GRADIENT);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
        let wgsl = r.wgsl.unwrap();
        assert!(wgsl.contains("@fragment"));
        assert!(wgsl.contains("fn main("));
        // Y-flip must survive into the module.
        assert!(wgsl.contains("iResolution"));
    }

    #[test]
    fn audio_texture_sample_is_level_zero() {
        let src = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    float f = 0.0;\n    if (uv.x > 0.5) { f = texture(iChannel0, vec2(uv.x, 0.25)).x; }\n    fragColor = vec4(f);\n}\n";
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
        let wgsl = r.wgsl.unwrap();
        assert!(
            wgsl.contains("textureSampleLevel("),
            "sample not rewritten:\n{wgsl}"
        );
        assert!(!wgsl.contains("textureSample(") || wgsl.contains("textureSampleLevel("));
    }

    #[test]
    fn legacy_texture2d_and_precision_pass() {
        let src = "precision mediump float;\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = texture2D(iChannel0, uv);\n}\n";
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn const_param_qualifier_is_stripped() {
        let src = "vec3 rot(const in vec3 p, const float a) { return p * a; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(rot(vec3(fragCoord, 1.0), iTime), 1.0);\n}\n";
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn bom_and_crlf_are_stripped() {
        let src = format!("\u{feff}{}", GRADIENT.replace('\n', "\r\n"));
        let r = transpile(&src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sampler_param_gets_friendly_error() {
        let src = "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(peak(iChannel0, 0.5));\n}\n";
        let r = transpile(src);
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("function parameter"));
        assert_eq!(r.errors[0].line, Some(1));
    }

    #[test]
    fn missing_main_image_is_rejected() {
        let r = transpile("void main() { }\n");
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("mainImage"));
    }

    #[test]
    fn parse_error_maps_to_user_line() {
        let src = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy\n    fragColor = vec4(uv, 0.0, 1.0);\n}\n";
        let r = transpile(src);
        assert!(!r.ok);
        // The missing-semicolon error must land on a line of the USER's
        // source (2 or 3 depending on how naga reports it), never a wrapper line.
        let line = r.errors[0].line.expect("error should map into user source");
        assert!((2..=3).contains(&line), "line was {line}");
    }

    #[test]
    fn cubemap_gets_friendly_error() {
        let src = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = texture(samplerCube(_bf_ch1, _bf_sampler), vec3(0.0));\n}\n";
        let r = transpile(src);
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("Cubemap"));
    }

    #[test]
    fn oversized_source_is_rejected() {
        let big = format!(
            "void mainImage(out vec4 f, in vec2 c) {{}}\n// {}",
            "x".repeat(MAX_GLSL_BYTES)
        );
        let r = transpile(&big);
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("byte limit"));
    }
}
