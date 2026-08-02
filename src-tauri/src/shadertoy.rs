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

// ---------------------------------------------------------------------------
// Sampler-parameter specialization (v2.65.0).
//
// Real Shadertoy code constantly passes channels to helper functions
// (`float peak(sampler2D ch, float x)`), and naga's GLSL frontend cannot
// parse sampler-typed parameters at all — in the spike corpus this was the
// single largest real-world failure class. Since Beatform channels are a
// fixed set of four globals, every such function can be specialized per
// concrete channel instead:
//
//   float peak(sampler2D ch, float x) { return texture(ch, vec2(x, .25)).x; }
//   ... peak(iChannel0, 0.5) ...
// becomes
//   ... peak__bfch0(0.5) ...
//   float peak__bfch0(float x) { return texture(iChannel0, vec2(x, .25)).x; }
//
// Fixpoint algorithm: each pass rewrites only calls whose sampler arguments
// are all concrete `iChannelN`. Substituting the channel into the clone's
// body turns that clone's own inner calls concrete, so nested forwarding
// (`f(sampler2D c) { return g(c, x); }`) resolves on the next pass without
// any call-graph analysis. Original definitions (and their prototypes) are
// blanked in place — content replaced by spaces, newlines kept — so the
// user's diagnostic line numbers stay valid; clones are appended after the
// source, where spans simply map to no user line. Calls that never become
// concrete (a channel from a ternary, an array, a non-channel variable) get
// a precise per-line error instead of a naga parser dump.
// ---------------------------------------------------------------------------

const MAX_SPECIALIZATIONS: usize = 24;
const MAX_SPECIALIZE_PASSES: usize = 8;

#[derive(Clone)]
struct SamplerFn {
    name: String,
    /// Byte range of the whole definition (return type through closing `}`).
    def_start: usize,
    def_end: usize,
    return_type: String,
    /// All parameters in order; `true` marks sampler2D params.
    params: Vec<(String, bool)>,
    body: String,
}

/// Split a parameter list or argument list on top-level commas.
fn split_top_level(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut cur = String::new();
    for c in s.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth -= 1,
            ',' if depth == 0 => {
                out.push(cur.trim().to_string());
                cur = String::new();
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// Find the byte index of the matching close for the delimiter at `open`.
fn matching(src: &[u8], open: usize, inc: u8, dec: u8) -> Option<usize> {
    let mut depth = 0usize;
    for (i, &b) in src.iter().enumerate().skip(open) {
        if b == inc {
            depth += 1;
        } else if b == dec {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
    }
    None
}

/// Locate every function DEFINITION whose parameter list contains sampler2D.
fn find_sampler_fns(src: &str) -> Vec<SamplerFn> {
    let bytes = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while let Some(rel) = src[i..].find("sampler2D") {
        let at = i + rel;
        i = at + 9;
        // Walk back to the enclosing `(`; a sampler2D param sits directly
        // inside a single paren level of a signature.
        let Some(open) = src[..at].rfind('(') else {
            continue;
        };
        let Some(close) = matching(bytes, open, b'(', b')') else {
            continue;
        };
        if close < at {
            continue; // the sampler2D wasn't inside THIS paren pair
        }
        // Signature = `<ret> <name>` immediately before `(`.
        let head = src[..open].trim_end();
        let Some(name_start) = head.rfind(|c: char| !c.is_alphanumeric() && c != '_') else {
            continue;
        };
        let name = head[name_start + 1..].to_string();
        let ret_head = head[..name_start + 1].trim_end();
        let Some(ret_start) = ret_head
            .rfind(|c: char| !c.is_alphanumeric() && c != '_')
            .map(|p| p + 1)
            .or(Some(0))
        else {
            continue;
        };
        let return_type = ret_head[ret_start..].to_string();
        if name.is_empty() || return_type.is_empty() || name == "mainImage" {
            continue;
        }
        // Definition requires a `{` after the params (else it's a prototype —
        // handled by blanking alongside the definition later).
        let after = src[close + 1..].trim_start();
        if !after.starts_with('{') {
            continue;
        }
        let brace = close + 1 + (src[close + 1..].len() - src[close + 1..].trim_start().len());
        let Some(body_end) = matching(bytes, brace, b'{', b'}') else {
            continue;
        };
        let params = split_top_level(&src[open + 1..close])
            .into_iter()
            .filter(|p| !p.is_empty())
            .map(|p| {
                let is_sampler = p.contains("sampler2D");
                let pname = p
                    .rsplit(|c: char| c.is_whitespace())
                    .next()
                    .unwrap_or("")
                    .trim_end_matches(|c: char| c == '[' || c == ']' || c.is_numeric())
                    .to_string();
                (pname, is_sampler)
            })
            .collect::<Vec<_>>();
        // def_start = start of the return-type token (head ends with
        // "<return_type> <name>"; ret_start indexes into ret_head which is a
        // prefix of the source).
        let def_start = ret_start;
        out.push(SamplerFn {
            name,
            def_start,
            def_end: body_end + 1,
            return_type,
            params,
            body: src[brace + 1..body_end].to_string(),
        });
    }
    out
}

/// Blank a byte range in place: every non-newline becomes a space, so all
/// subsequent line numbers are untouched.
fn blank_range(src: &mut String, start: usize, end: usize) {
    let blanked: String = src[start..end]
        .chars()
        .map(|c| if c == '\n' { '\n' } else { ' ' })
        .collect();
    src.replace_range(start..end, &blanked);
}

/// Substitute identifier `from` → `to` at word boundaries.
fn subst_ident(body: &str, from: &str, to: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(pos) = rest.find(from) {
        let before_ok = pos == 0
            || !rest[..pos]
                .chars()
                .next_back()
                .map(|c| c.is_alphanumeric() || c == '_')
                .unwrap_or(false);
        let after = &rest[pos + from.len()..];
        let after_ok = !after
            .chars()
            .next()
            .map(|c| c.is_alphanumeric() || c == '_')
            .unwrap_or(false);
        out.push_str(&rest[..pos]);
        if before_ok && after_ok {
            out.push_str(to);
        } else {
            out.push_str(from);
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

fn channel_suffix(args: &[String]) -> String {
    args.iter()
        .map(|a| a.trim_start_matches("iChannel").to_string())
        .collect::<Vec<_>>()
        .join("_")
}

/// 1-based line of a byte offset.
fn line_of(src: &str, offset: usize) -> u32 {
    src[..offset.min(src.len())]
        .bytes()
        .filter(|&b| b == b'\n')
        .count() as u32
        + 1
}

/// A generated per-channel clone of a sampler-param helper.
struct SamplerClone {
    /// The helper it was cloned from — clones are embedded back at this
    /// function's (blanked) source location so naga's definition-order
    /// dependency rules are inherited from the original program for free.
    origin: String,
    name: String,
    /// Signature without body, e.g. `float peak__bfch0(float x)`.
    sig: String,
    body: String,
}

/// Collapse a function body onto one line: strip `//` comments (they would
/// swallow the rest of the line) and fold newlines to spaces. Block comments
/// survive as-is.
fn one_line(body: &str) -> String {
    body.lines()
        .map(|l| l.split("//").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The specialization pass. Returns the rewritten source with the SAME line
/// count: originals are blanked in place and their clones are written —
/// newline-free — onto the first line of the blanked region, so both
/// diagnostic line mapping and GLSL/naga declaration order are preserved.
fn specialize_sampler_params(src: &str) -> Result<String, Vec<TranspileError>> {
    if !src.contains("sampler2D") {
        return Ok(src.to_string());
    }
    let original_lines = src.lines().count();
    let mut work = src.to_string();
    let mut clones: Vec<SamplerClone> = Vec::new();

    for _pass in 0..MAX_SPECIALIZE_PASSES {
        // View = user source + rendered clones (a clone can carry calls that
        // only become concrete on this pass).
        let mut view = work.clone();
        let mut clone_spans: Vec<(usize, usize)> = Vec::new();
        for c in &clones {
            view.push('\n');
            let start = view.len();
            view.push_str(&c.sig);
            view.push_str(" {");
            view.push_str(&c.body);
            view.push('}');
            clone_spans.push((start, view.len()));
        }
        let fns = find_sampler_fns(&view);
        if fns.is_empty() {
            break;
        }
        let mut rewrites: Vec<(usize, usize, String)> = Vec::new();
        let mut new_clones: Vec<SamplerClone> = Vec::new();
        for f in &fns {
            let mut search = 0usize;
            while let Some(rel) = view[search..].find(&f.name) {
                let at = search + rel;
                search = at + f.name.len();
                let before_ok = at == 0
                    || !view[..at]
                        .chars()
                        .next_back()
                        .map(|c| c.is_alphanumeric() || c == '_')
                        .unwrap_or(false);
                if !before_ok {
                    continue;
                }
                let after = &view[at + f.name.len()..];
                let ws = after.len() - after.trim_start().len();
                if !after.trim_start().starts_with('(') {
                    continue;
                }
                // Skip the definition site (name preceded by the return type).
                let head = view[..at].trim_end();
                if head.ends_with(&f.return_type)
                    && !head
                        .trim_end_matches(&f.return_type)
                        .ends_with(|c: char| c.is_alphanumeric() || c == '_')
                {
                    continue;
                }
                let open = at + f.name.len() + ws;
                let Some(close) = matching(view.as_bytes(), open, b'(', b')') else {
                    continue;
                };
                let args = split_top_level(&view[open + 1..close]);
                if args.len() != f.params.len() {
                    continue;
                }
                let sampler_args: Vec<String> = args
                    .iter()
                    .zip(&f.params)
                    .filter(|(_, (_, is_s))| *is_s)
                    .map(|(a, _)| a.clone())
                    .collect();
                if !sampler_args.iter().all(|a| {
                    matches!(
                        a.as_str(),
                        "iChannel0" | "iChannel1" | "iChannel2" | "iChannel3"
                    )
                }) {
                    continue; // not concrete yet — maybe next pass
                }
                let kept_args: Vec<String> = args
                    .iter()
                    .zip(&f.params)
                    .filter(|(_, (_, is_s))| !*is_s)
                    .map(|(a, _)| a.clone())
                    .collect();
                let new_name = format!("{}__bfch{}", f.name, channel_suffix(&sampler_args));
                rewrites.push((
                    at,
                    close + 1,
                    format!("{new_name}({})", kept_args.join(", ")),
                ));

                if !clones.iter().any(|c| c.name == new_name)
                    && !new_clones.iter().any(|c| c.name == new_name)
                {
                    if clones.len() + new_clones.len() >= MAX_SPECIALIZATIONS {
                        return Err(vec![TranspileError {
                            line: None,
                            message: format!(
                                "Too many channel-helper specializations (limit {MAX_SPECIALIZATIONS}) — simplify how helpers receive iChannel arguments"
                            ),
                        }]);
                    }
                    let mut body = f.body.clone();
                    let mut si = 0usize;
                    for (pname, is_s) in &f.params {
                        if *is_s {
                            body = subst_ident(&body, pname, &sampler_args[si]);
                            si += 1;
                        }
                    }
                    // Rebuild kept params from the ORIGINAL signature text so
                    // their types/qualifiers survive.
                    let sig_open = view[f.def_start..f.def_end]
                        .find('(')
                        .map(|p| f.def_start + p)
                        .unwrap_or(f.def_start);
                    let sig_close =
                        matching(view.as_bytes(), sig_open, b'(', b')').unwrap_or(sig_open);
                    let kept_params: Vec<String> = split_top_level(&view[sig_open + 1..sig_close])
                        .into_iter()
                        .filter(|p| !p.contains("sampler2D"))
                        .collect();
                    new_clones.push(SamplerClone {
                        origin: f.name.clone(),
                        name: new_name.clone(),
                        sig: format!("{} {new_name}({})", f.return_type, kept_params.join(", ")),
                        body,
                    });
                }
            }
        }
        if rewrites.is_empty() && new_clones.is_empty() {
            break;
        }
        rewrites.sort_by_key(|r| std::cmp::Reverse(r.0));
        for (start, end, replacement) in rewrites {
            if end <= work.len() {
                work.replace_range(start..end, &replacement);
                continue;
            }
            for (i, (span_start, span_end)) in clone_spans.iter().enumerate() {
                if start >= *span_start && end <= *span_end {
                    let body_start = span_start + clones[i].sig.len() + 2; // sig + " {"
                    clones[i]
                        .body
                        .replace_range(start - body_start..end - body_start, &replacement);
                    break;
                }
            }
        }
        clones.extend(new_clones);
    }

    // Blank each sampler-param definition and embed its clones — newline-free
    // — on the first line of the blanked region. Reverse order keeps earlier
    // byte ranges valid while later ones are edited.
    let leftover_fns = find_sampler_fns(&work);
    let leftover_names: Vec<(String, u32)> = leftover_fns
        .iter()
        .map(|f| (f.name.clone(), line_of(&work, f.def_start)))
        .collect();
    for f in leftover_fns.iter().rev() {
        blank_range(&mut work, f.def_start, f.def_end);
        let embedded = clones
            .iter()
            .filter(|c| c.origin == f.name)
            .map(|c| format!("{} {{ {} }}", c.sig, one_line(&c.body)))
            .collect::<Vec<_>>()
            .join(" ");
        if !embedded.is_empty() {
            let line_end = work[f.def_start..]
                .find('\n')
                .map(|p| f.def_start + p)
                .unwrap_or(work.len());
            work.replace_range(f.def_start..line_end, &embedded);
        }
    }
    // Prototypes (`<ret> name(...sampler2D...);`): blank, and where the
    // function has clones, declare the clones there instead — naga allocates
    // function IR at the declaration site, so clone prototypes must hold the
    // same relative position the original prototype did.
    let mut proto_guard = 0usize;
    while let Some(at) = work.find("sampler2D") {
        proto_guard += 1;
        if proto_guard > 64 {
            break;
        }
        let Some(open) = work[..at].rfind('(') else {
            break;
        };
        let Some(close) = matching(work.as_bytes(), open, b'(', b')') else {
            break;
        };
        if close > at && work[close + 1..].trim_start().starts_with(';') {
            let head = work[..open].trim_end();
            let name_start = head
                .rfind(|c: char| !c.is_alphanumeric() && c != '_')
                .map(|p| p + 1)
                .unwrap_or(0);
            let proto_name = head[name_start..].to_string();
            let semi = close + 1 + (work[close + 1..].len() - work[close + 1..].trim_start().len());
            let line_start = work[..open].rfind('\n').map(|p| p + 1).unwrap_or(0);
            blank_range(&mut work, line_start, semi + 1);
            let protos = clones
                .iter()
                .filter(|c| c.origin == proto_name)
                .map(|c| format!("{};", c.sig))
                .collect::<Vec<_>>()
                .join(" ");
            if !protos.is_empty() {
                let line_end = work[line_start..]
                    .find('\n')
                    .map(|p| line_start + p)
                    .unwrap_or(work.len());
                work.replace_range(line_start..line_end, &protos);
            }
            continue;
        }
        break;
    }
    if let Some(at) = work.find("sampler2D") {
        return Err(vec![TranspileError {
            line: Some(line_of(&work, at)),
            message: "sampler2D here can't be resolved to a fixed channel — pass iChannel0..3 directly (variable or computed channel arguments aren't supported)".into(),
        }]);
    }
    // A remaining call to a blanked function = a channel argument that never
    // became a concrete iChannelN. Report the call's line when it is in the
    // user's own code, else the unresolvable helper's definition line.
    for (name, def_line) in leftover_names {
        let mut search = 0usize;
        while let Some(rel) = work[search..].find(&name) {
            let at = search + rel;
            search = at + name.len();
            let before_ok = at == 0
                || !work[..at]
                    .chars()
                    .next_back()
                    .map(|c| c.is_alphanumeric() || c == '_')
                    .unwrap_or(false);
            // Not a specialized clone of itself (name__bfch...).
            let tail = &work[at + name.len()..];
            if tail.starts_with("__bfch") {
                continue;
            }
            let after_call = tail.trim_start().starts_with('(');
            if before_ok && after_call {
                let line = Some(line_of(&work, at)).filter(|_| at < work.len());
                return Err(vec![TranspileError {
                    line: line.or(Some(def_line)),
                    message: format!(
                        "'{name}' takes a channel argument that isn't a direct iChannel0..3 — variable or computed channels aren't supported"
                    ),
                }]);
            }
        }
    }

    debug_assert_eq!(work.lines().count(), original_lines);
    Ok(work)
}

/// Rewrite implicit-derivative sampling in emitted WGSL to explicit level 0:
/// `textureSample(...)` -> `textureSampleLevel(..., 0.0)` and
/// `textureSampleBias(..., bias)` -> `textureSampleLevel(..., 0.0)` (bias
/// only shifts mip selection, and channel textures carry no mip chain, so
/// dropping it is bit-identical). Both are subject to WGSL's uniform-control-
/// flow rule that tint enforces and real shaders constantly violate; see the
/// module docs.
fn level_zero_samples(wgsl: &str) -> String {
    fn args_end(bytes: &[u8], args_start: usize) -> usize {
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
        i
    }

    // Bias first — its name contains "textureSample" as a prefix, so the
    // plain pass must not see it.
    let mut out = String::with_capacity(wgsl.len());
    let mut rest = wgsl;
    const BIAS: &str = "textureSampleBias(";
    while let Some(pos) = rest.find(BIAS) {
        out.push_str(&rest[..pos]);
        out.push_str("textureSampleLevel(");
        let args_start = pos + BIAS.len();
        let i = args_end(rest.as_bytes(), args_start);
        let args = &rest[args_start..i - 1];
        // Drop the trailing bias argument (last top-level comma).
        let mut depth = 0i32;
        let mut cut = args.len();
        for (bi, c) in args.char_indices().rev() {
            match c {
                ')' | ']' => depth += 1,
                '(' | '[' => depth -= 1,
                ',' if depth == 0 => {
                    cut = bi;
                    break;
                }
                _ => {}
            }
        }
        out.push_str(&args[..cut]);
        out.push_str(", 0.0)");
        rest = &rest[i..];
    }
    out.push_str(rest);

    let biased = out;
    let mut out = String::with_capacity(biased.len());
    let mut rest = biased.as_str();
    const NEEDLE: &str = "textureSample(";
    while let Some(pos) = rest.find(NEEDLE) {
        out.push_str(&rest[..pos]);
        out.push_str("textureSampleLevel(");
        let args_start = pos + NEEDLE.len();
        let i = args_end(rest.as_bytes(), args_start);
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
    let mut has_main_sound = false;
    let mut has_main_vr = false;
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
        // sampler2D parameters are handled by specialize_sampler_params
        // before this scan runs; anything left over already errored there.
        if code.contains("mainSound") {
            has_main_sound = true;
        }
        if code.contains("mainVR") {
            has_main_vr = true;
        }
    }
    // mainSound/mainVR ALONGSIDE mainImage is fine — real Shadertoy shaders
    // ship extra entry points that translate as dead code (found on the real
    // corpus: rejecting them cost two otherwise-perfect imports). They are
    // only worth a specific message when there is no Image entry at all.
    if !has_main_image {
        errors.push(TranspileError {
            line: None,
            message: if has_main_sound {
                "This is a sound shader (mainSound) — Beatform analyses the loaded track instead; paste the Image tab of a visual shader".into()
            } else if has_main_vr {
                "This is a VR-only shader (mainVR without mainImage) — paste the Image tab of a regular shader".into()
            } else {
                "No mainImage(out vec4 fragColor, in vec2 fragCoord) found — paste the Image tab of a Shadertoy shader".into()
            },
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
    // Channel-helper specialization BEFORE the pre-scan: functions taking
    // sampler2D params are resolved into per-channel clones; only genuinely
    // unresolvable channel plumbing errors out (with its own message).
    let cleaned = match specialize_sampler_params(&cleaned) {
        Ok(s) => s,
        Err(errors) => return fail(errors),
    };
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
    fn bias_sampling_is_rewritten_to_level_zero() {
        // texture(ch, uv, bias) emits textureSampleBias — same uniformity
        // trap as textureSample (found on the real corpus: venice.frag).
        let src = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    float v = 0.0;\n    if (uv.x > 0.5) { v = texture(iChannel0, uv, -100.0).x; }\n    fragColor = vec4(v);\n}\n";
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
        let wgsl = r.wgsl.unwrap();
        assert!(
            !wgsl.contains("textureSampleBias("),
            "bias survived:\n{wgsl}"
        );
        assert!(wgsl.contains("textureSampleLevel("));
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
    fn sampler_param_is_specialized() {
        // v2.65.0: the former #1 real-world failure class now transpiles —
        // the helper is cloned per concrete channel.
        let src = "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(peak(iChannel0, 0.5));\n}\n";
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sampler_param_multi_channel_specializes_per_channel() {
        let src = "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = vec4(peak(iChannel0, uv.x), peak(iChannel1, uv.x), 0.0, 1.0);\n}\n";
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sampler_param_nested_forwarding_resolves() {
        let src = concat!(
            "float inner(sampler2D c, float x) { return texture(c, vec2(x, 0.25)).x; }\n",
            "float outerf(sampler2D c, float x) { return inner(c, x) * 2.0; }\n",
            "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n",
            "    fragColor = vec4(outerf(iChannel0, 0.5));\n",
            "}\n"
        );
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sampler_param_with_const_qualifier_specializes() {
        let src = "float peak(const in sampler2D ch, in float x) { return texture(ch, vec2(x, 0.25)).x; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = vec4(peak(iChannel0, 0.5));\n}\n";
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sampler_prototype_is_blanked_too() {
        let src = concat!(
            "float peak(sampler2D ch, float x);\n",
            "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n",
            "    fragColor = vec4(peak(iChannel0, 0.5));\n",
            "}\n",
            "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\n"
        );
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn non_concrete_channel_argument_gets_friendly_error() {
        // A channel arriving through anything but a literal iChannelN cannot
        // be specialized — the error must name the function and a line, not
        // dump a naga parse failure.
        let src = concat!(
            "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\n",
            "float route(sampler2D a, sampler2D b, float x) { return peak(x > 0.5 ? a : b, x); }\n",
            "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n",
            "    fragColor = vec4(route(iChannel0, iChannel1, fragCoord.x));\n",
            "}\n"
        );
        let r = transpile(src);
        assert!(!r.ok);
        let msg = &r.errors[0].message;
        assert!(
            msg.contains("iChannel0..3") || msg.contains("channel"),
            "unhelpful message: {msg}"
        );
        assert!(r.errors[0].line.is_some());
    }

    #[test]
    fn specialization_preserves_user_line_numbers() {
        // Error AFTER a specialized helper: the missing semicolon lives on
        // line 4 of the user's source and must still be reported there.
        let src = concat!(
            "float peak(sampler2D ch, float x) { return texture(ch, vec2(x, 0.25)).x; }\n",
            "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n",
            "    float v = peak(iChannel0, 0.5);\n",
            "    float broken = v\n",
            "    fragColor = vec4(v);\n",
            "}\n"
        );
        let r = transpile(src);
        assert!(!r.ok);
        let line = r.errors[0].line.expect("should map to user source");
        assert!((4..=5).contains(&line), "line was {line}");
    }

    #[test]
    fn missing_main_image_is_rejected() {
        let r = transpile("void main() { }\n");
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("mainImage"));
    }

    #[test]
    fn extra_vr_entry_alongside_main_image_is_dead_code_not_an_error() {
        // Real corpus shaders ship mainVR next to mainImage; the VR entry
        // translates as an unused function and must not block the import.
        let src = concat!(
            "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n",
            "    fragColor = vec4(fragCoord / iResolution.xy, 0.0, 1.0);\n",
            "}\n",
            "void mainVR(out vec4 fragColor, in vec2 fragCoord, in vec3 ro, in vec3 rd) {\n",
            "    fragColor = vec4(rd, 1.0);\n",
            "}\n"
        );
        let r = transpile(src);
        assert!(
            r.ok,
            "errors: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sound_only_shader_gets_specific_message() {
        let r = transpile("vec2 mainSound(int samp, float time) { return vec2(0.0); }\n");
        assert!(!r.ok);
        assert!(r.errors[0].message.contains("sound shader"));
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

    /// Real-corpus pass-rate measurement (spike-2 methodology): point
    /// CORPUS_DIR at a directory of .frag files fetched for analysis and run
    /// with `cargo test corpus_pass_rate -- --ignored --nocapture`. Not part
    /// of CI — the corpus is never committed or redistributed.
    #[test]
    #[ignore]
    fn corpus_pass_rate() {
        let dir = std::env::var("CORPUS_DIR").expect("set CORPUS_DIR");
        let mut pass = 0usize;
        let mut total = 0usize;
        let mut entries: Vec<_> = std::fs::read_dir(&dir)
            .expect("corpus dir")
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().map(|x| x == "frag").unwrap_or(false))
            .collect();
        entries.sort();
        for path in entries {
            let src = std::fs::read_to_string(&path).unwrap();
            total += 1;
            let r = transpile(&src);
            if r.ok {
                pass += 1;
                // Emit WGSL for the device-compile stage.
                let out = std::path::Path::new(&dir).join("out");
                let _ = std::fs::create_dir_all(&out);
                let name = path.file_stem().unwrap().to_string_lossy().to_string();
                let _ = std::fs::write(out.join(format!("{name}.wgsl")), r.wgsl.unwrap());
            } else {
                println!(
                    "FAIL {}: {}",
                    path.file_name().unwrap().to_string_lossy(),
                    r.errors
                        .first()
                        .map(|e| e.message.clone())
                        .unwrap_or_default()
                );
            }
        }
        println!("corpus pass rate: {pass}/{total}");
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
