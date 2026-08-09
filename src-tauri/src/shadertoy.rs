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

/// Byte index just PAST the char that a `rfind`/`find` located at `p`.
///
/// `p + 1` is only right for one-byte chars. A multi-byte separator — a
/// non-breaking space, which is what copying code out of a rendered web page
/// routinely produces; a BOM that ended up mid-file; an accented letter in a
/// comment — puts `p + 1` INSIDE the char, and slicing a `&str` there panics.
/// `transpile` is a Tauri command whose argument is pasted text, so that
/// panic was reachable straight from the import dialog. Found by fuzzing.
fn after_char(s: &str, p: usize) -> usize {
    p + s[p..].chars().next().map_or(1, char::len_utf8)
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
        let name_end = after_char(head, name_start);
        let name = head[name_end..].to_string();
        let ret_head = head[..name_end].trim_end();
        let Some(ret_start) = ret_head
            .rfind(|c: char| !c.is_alphanumeric() && c != '_')
            .map(|p| after_char(ret_head, p))
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
                // The replacement is one line. The call it replaces may not
                // be — real shaders wrap long argument lists — and
                // `split_top_level` trims each argument, so those newlines
                // would simply vanish. Every line number below the call
                // would then be off by that many, which matters because line
                // numbers are the unit the user's error spans are reported
                // in. Put them back AFTER the call: whitespace is
                // insignificant in GLSL, so the statement is unchanged and
                // everything below keeps the line it was on. Found by
                // fuzzing, caught by the line-count assert at the end.
                //
                // Count what is actually LOST, not what was there: `trim`
                // only touches the ends of an argument, so a newline INSIDE
                // one survives into the replacement, and re-adding it would
                // overshoot by exactly as much as dropping it undershot
                // (the second fuzz finding, after the first fix).
                let replacement = format!("{new_name}({})", kept_args.join(", "));
                let swallowed = view[at..close + 1]
                    .matches('\n')
                    .count()
                    .saturating_sub(replacement.matches('\n').count());
                rewrites.push((
                    at,
                    close + 1,
                    format!("{replacement}{}", "\n".repeat(swallowed)),
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
        // Descending order keeps earlier spans valid while later ones are
        // edited — but only for spans that do not OVERLAP. Two of them can:
        //
        //  - Same name, twice. GLSL overloads are legal and a double-pasted
        //    shader has literal duplicates, and each definition scans the
        //    whole view for calls, so one call site is queued once per
        //    definition. Applying an identical span twice replaces the first
        //    replacement PLUS whatever followed it.
        //  - Nested calls, `outer(iChannel0, inner(iChannel1, uv))`. The
        //    inner span applies first and shortens the text under the outer
        //    span's stale `end`.
        //
        // Both corrupt the source rather than fail it: found by fuzzing, on a
        // doubled shader that came out with a `;` and a closing brace eaten
        // and two statements merged into one. Anything overlapping a span
        // already applied on this pass is dropped and re-scanned on the next
        // one, by which point it is a fresh span over the edited text — the
        // pass loop already exists for exactly this kind of second look.
        let mut applied_from = usize::MAX;
        for (start, end, replacement) in rewrites {
            if end > applied_from {
                continue;
            }
            applied_from = start;
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
    let leftover_names: Vec<String> = leftover_fns.iter().map(|f| f.name.clone()).collect();
    // A clone belongs to exactly ONE definition. `origin` is a name, and a
    // name is not unique — GLSL overloads are legal, so `grab(sampler2D,
    // vec2)` and `grab(sampler2D, vec2, float)` both answer to "grab" and
    // both used to embed the whole clone set, which naga rejected outright
    // with "Function already defined". Ownership is assigned once, to the
    // EARLIEST definition of the name: earliest keeps the declaration ahead
    // of every call site, which is what the GLSL frontend requires.
    let mut owned: Vec<Vec<usize>> = vec![Vec::new(); leftover_fns.len()];
    for (ci, clone) in clones.iter().enumerate() {
        if let Some(fi) = leftover_fns.iter().position(|f| f.name == clone.origin) {
            owned[fi].push(ci);
        }
    }
    for (fi, f) in leftover_fns.iter().enumerate().rev() {
        blank_range(&mut work, f.def_start, f.def_end);
        let embedded = owned[fi]
            .iter()
            // one_line over the WHOLE clone, signature included: a
            // definition may wrap its own parameter list across lines, and
            // `split_top_level` only trims the ends of each parameter, so a
            // newline inside one survived into `sig` and this single-line
            // write became a two-line one. Found by fuzzing.
            .map(|&ci| one_line(&format!("{} {{ {} }}", clones[ci].sig, clones[ci].body)))
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
                .map(|p| after_char(head, p))
                .unwrap_or(0);
            let proto_name = head[name_start..].to_string();
            let semi = close + 1 + (work[close + 1..].len() - work[close + 1..].trim_start().len());
            let line_start = work[..open].rfind('\n').map(|p| p + 1).unwrap_or(0);
            blank_range(&mut work, line_start, semi + 1);
            let protos = clones
                .iter()
                .filter(|c| c.origin == proto_name)
                // Same reason as the embed above: `sig` can carry a
                // newline from a wrapped parameter list, and this is written
                // onto one line.
                .map(|c| one_line(&format!("{};", c.sig)))
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
    for name in leftover_names {
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
                // A residual call inside an embedded clone sits on the origin
                // definition's line, so line_of covers both cases directly.
                return Err(vec![TranspileError {
                    line: Some(line_of(&work, at)),
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

    // naga is not panic-safe on hostile input, and this function's argument
    // IS hostile input: `transpile_shadertoy` is a Tauri command over text
    // the user pasted off a web page. Fuzzing found `index out of bounds:
    // the len is 15 but the index is 20` inside `Typifier::get`
    // (naga 30.0.0, front/mod.rs:77) from a 78-byte token soup, which in the
    // app is the whole window going down on a bad paste.
    //
    // So the third-party parser runs behind a boundary and an upstream panic
    // degrades to an ordinary import error. Nothing here is shared state —
    // `Frontend` and `Validator` are built per call — so there is no
    // half-updated structure left behind to worry about, which is what
    // AssertUnwindSafe is asserting.
    let translated = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        translate(&wrapped, header_lines, user_lines)
    }));
    match translated {
        Ok(result) => result,
        Err(_) => fail_one(
            None,
            "The GLSL parser crashed on this shader. It is almost certainly malformed — check for unbalanced braces or a truncated paste.",
        ),
    }
}

/// The naga half of `transpile`: parse, validate, emit. Split out so the
/// panic boundary above has something to wrap.
fn translate(wrapped: &str, header_lines: u32, user_lines: u32) -> TranspileResult {
    let options = naga::front::glsl::Options::from(naga::ShaderStage::Fragment);
    let mut frontend = naga::front::glsl::Frontend::default();
    let module = match frontend.parse(&options, wrapped) {
        Ok(m) => m,
        Err(errs) => {
            let errors = errs
                .errors
                .iter()
                .map(|e| TranspileError {
                    line: user_line(
                        wrapped,
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
                user_line(wrapped, offset, header_lines, user_lines),
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

    /// `TranspileError` deliberately carries no `Debug` (it is a serialized
    /// wire type), so unwrapping one needs its message pulled out by hand.
    fn specialized_or_panic(src: &str) -> String {
        specialize_sampler_params(src).unwrap_or_else(|errors| {
            panic!(
                "specialization refused a legal source: {:?}",
                errors.iter().map(|e| &e.message).collect::<Vec<_>>()
            )
        })
    }

    /// Found by the fuzz module below, on the "paste the whole thing twice"
    /// mutation. Two definitions of the same sampler2D helper each scanned
    /// the whole source for calls, so every call site was queued for rewrite
    /// twice, and the second application ate the four bytes that followed the
    /// first — here exactly `;\n}\n`, which merged two statements and deleted
    /// a closing brace. The line-count `debug_assert` at the end of
    /// specialization is what caught it, so in a RELEASE build the corruption
    /// was silent: naga then rejected a shader that should have imported, and
    /// pointed at the wrong line while doing it.
    #[test]
    fn duplicate_sampler_helper_definitions_do_not_corrupt_source() {
        let one = "vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = grab(iChannel0, fragCoord / iResolution.xy);\n}\n";
        let doubled = format!("{one}{one}");
        let specialized = specialized_or_panic(&doubled);
        assert_eq!(
            specialized.lines().count(),
            doubled.lines().count(),
            "specialization must preserve line count:\n{specialized}"
        );
        // The concrete symptom, named so a regression cannot pass by
        // coincidentally landing on the right line count.
        assert!(
            !specialized.contains(")vec4"),
            "a definition was spliced into a statement:\n{specialized}"
        );
        assert_eq!(
            specialized.matches("grab__bfch0(fragCoord").count(),
            2,
            "both call sites should be specialized:\n{specialized}"
        );
    }

    /// The same defect through a shape that is legal, idiomatic GLSL rather
    /// than a paste accident: an overloaded helper. Both overloads take a
    /// sampler2D and share a name, so both scan for the same calls.
    #[test]
    fn overloaded_sampler_helper_does_not_corrupt_source() {
        let src = "vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvec4 grab(sampler2D ch, vec2 uv, float k) { return texture(ch, uv) * k; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = grab(iChannel0, uv) + grab(iChannel1, uv, 0.5);\n}\n";
        let specialized = specialized_or_panic(src);
        assert_eq!(
            specialized.lines().count(),
            src.lines().count(),
            "specialization must preserve line count:\n{specialized}"
        );
        let r = transpile(src);
        assert!(
            r.ok,
            "overloaded channel helper failed to transpile: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    /// The other overlap shape the guard covers: a channel helper whose
    /// argument is another channel helper's call. The inner span is applied
    /// first and shortens the text the outer span was measured against.
    #[test]
    fn nested_sampler_helper_calls_do_not_corrupt_source() {
        let src = "vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvec4 mixch(sampler2D ch, vec4 c) { return texture(ch, c.xy) + c; }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = mixch(iChannel1, grab(iChannel0, uv));\n}\n";
        let specialized = specialized_or_panic(src);
        assert_eq!(
            specialized.lines().count(),
            src.lines().count(),
            "specialization must preserve line count:\n{specialized}"
        );
        let r = transpile(src);
        assert!(
            r.ok,
            "nested channel helpers failed to transpile: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );
    }

    /// Found by the fuzz module below, and the sharpest of its findings: a
    /// hard panic, not a debug assert, inside a `#[tauri::command]` whose
    /// argument is text the user pasted. `find_sampler_fns` walked back from
    /// a function name with `rfind(char).map(|p| p + 1)`, which lands INSIDE
    /// any multi-byte char and makes the next `&str` slice panic.
    ///
    /// The fuzzer reached it through a stray BOM. The input worth naming is
    /// the one a person would actually produce: a non-breaking space, which
    /// is what copying code out of a rendered web page gives you — and
    /// Shadertoy is a web page.
    #[test]
    fn multibyte_char_before_a_helper_does_not_panic() {
        let nbsp = "\u{a0}vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = grab(iChannel0, fragCoord / iResolution.xy);\n}\n";
        // Not asserted as ok: naga may or may not accept U+00A0 as
        // whitespace, and which way it goes is not this test's business.
        // What is: the call returns at all.
        let r = transpile(nbsp);
        assert!(r.ok || !r.errors.is_empty());

        // The literal shape the fuzzer produced, kept so the finding stays
        // reproducible from the corpus that found it.
        let soup = format!(
            "{}{}{}{}",
            "{".repeat(20),
            "\u{feff}".repeat(27),
            "vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = grab(iChannel0, fragCoord / iResolution.xy);",
            "}".repeat(21)
        );
        let r = transpile(&soup);
        assert!(!r.ok, "brace soup should not transpile");
        assert!(!r.errors.is_empty());
    }

    /// Found by the fuzz module at a million iterations, and the one finding
    /// that is not our bug: naga's own GLSL frontend panics with `index out
    /// of bounds: the len is 15 but the index is 20` inside `Typifier::get`
    /// (naga 30.0.0, `front/mod.rs:77`) on this 78-byte token soup. It is
    /// still OUR crash — `transpile_shadertoy` is a Tauri command over pasted
    /// text — so the boundary in `transpile` turns it into an import error.
    ///
    /// Expect a naga backtrace in the test output: the panic still happens,
    /// it is just caught. Silencing the hook would mean swapping global state
    /// mid-suite, which is worse than the noise.
    #[test]
    fn a_parser_panic_becomes_an_import_error() {
        let soup = "vec2vec2vec2vec2iChannel0mainImagefloat\t[iChannel0(//,\"vec2intextureLodhighp";
        let r = transpile(soup);
        assert!(!r.ok, "token soup should not transpile");
        assert!(
            !r.errors.is_empty(),
            "a caught panic must still name itself to the user"
        );
    }

    /// Found by fuzzing, and the shape is ordinary rather than adversarial:
    /// a channel-helper call with its arguments wrapped across two lines,
    /// which is how any real shader writes a long argument list. The
    /// specialized call is one line, so the wrap used to vanish and every
    /// line number below it shifted up — silently, in release, where the
    /// line-count assert is compiled out. The error the user then reads
    /// points at the wrong line of a shader that imported fine.
    #[test]
    fn a_call_wrapped_across_lines_keeps_the_lines_below_it_in_place() {
        let src = "vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = grab(iChannel0,\n        fragCoord / iResolution.xy);\n    fragColor.a = 1.0;\n}\n";
        let specialized = specialized_or_panic(src);
        assert_eq!(
            specialized.lines().count(),
            src.lines().count(),
            "a wrapped call swallowed a line:\n{specialized}"
        );
        // The line below the call must still BE the line below the call.
        assert_eq!(
            specialized.lines().nth(4).map(str::trim),
            Some("fragColor.a = 1.0;"),
            "content shifted between lines:\n{specialized}"
        );
        let r = transpile(src);
        assert!(
            r.ok,
            "wrapped channel-helper call failed to transpile: {:?}",
            r.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
        );

        // The other wrap position, and the reason the first fix had to count
        // what is LOST rather than what was there: a newline INSIDE an
        // argument survives `trim`, so re-adding one would overshoot.
        let inside = "vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = grab(iChannel0, vec2(uv.x,\n        uv.y));\n    fragColor.a = 1.0;\n}\n";
        let specialized = specialized_or_panic(inside);
        assert_eq!(
            specialized.lines().count(),
            inside.lines().count(),
            "a newline inside an argument was double-counted:\n{specialized}"
        );

        // And the third place a wrap can sit: the DEFINITION's own parameter
        // list. That newline rode `split_top_level` into the clone's
        // signature, and the signature is written onto a single line, so the
        // embed turned one line into two.
        let wrapped_def = "vec4 grab(sampler2D ch,\n          vec2 uv) { return texture(ch, uv); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = grab(iChannel0, fragCoord / iResolution.xy);\n}\n";
        let specialized = specialized_or_panic(wrapped_def);
        assert_eq!(
            specialized.lines().count(),
            wrapped_def.lines().count(),
            "a wrapped parameter list changed the line count:\n{specialized}"
        );
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

/// Structural fuzzing of the GLSL translator (BACKLOG F4).
///
/// `transpile_shadertoy` is a Tauri command whose argument is a string the
/// user pasted from a web page, so every byte of it is untrusted, and the
/// translator reaches that input through three hand-written scanners
/// (`clean_user_source`, `specialize_sampler_params`, `contract_pre_scan`)
/// plus naga's GLSL frontend. Hand-written examples cover the shapes an
/// author thought of; this covers the ones nobody did.
///
/// Deterministic on purpose. A coverage-guided run belongs in `fuzz/` under
/// cargo-fuzz, which needs a nightly toolchain and therefore cannot be a
/// gate; this walks a fixed pseudo-random corpus so it runs inside plain
/// `cargo test --workspace` on every commit, and so a red result reproduces
/// from its seed instead of from a saved artifact.
#[cfg(test)]
mod fuzz {
    use super::*;
    use std::panic::AssertUnwindSafe;
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// xorshift64* in eight lines. `rand` would buy nothing here — the point
    /// is that every machine walks the identical corpus, not distribution
    /// quality.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x >> 12;
            x ^= x << 25;
            x ^= x >> 27;
            self.0 = x;
            x.wrapping_mul(0x2545_f491_4f6c_dd1d)
        }

        fn below(&mut self, n: usize) -> usize {
            if n == 0 {
                0
            } else {
                (self.next() % n as u64) as usize
            }
        }

        fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
            &xs[self.below(xs.len())]
        }
    }

    /// Seeds chosen for the branches the scanners actually special-case: a
    /// plain shader, a sampler2D helper (the specialization path), a channel
    /// sample with a `#version`/`precision` preamble (the cleaner plus the
    /// level-zero rewrite), and the two non-Image entry points.
    const SEEDS: &[&str] = &[
        "void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    vec2 uv = fragCoord / iResolution.xy;\n    fragColor = vec4(uv, 0.0, 1.0);\n}\n",
        "vec4 grab(sampler2D ch, vec2 uv) { return texture(ch, uv); }\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    fragColor = grab(iChannel0, fragCoord / iResolution.xy);\n}\n",
        "#version 330\nprecision highp float;\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n    float f = texture(iChannel0, vec2(0.5)).x;\n    fragColor = vec4(f, f, f, 1.0);\n}\n",
        "void mainSound(int samp, float time) { }\n",
        "void mainVR(out vec4 fragColor, in vec2 fragCoord, in vec3 ro, in vec3 rd) { }\n",
        "",
    ];

    /// Fragments the scanners branch on, plus the delimiters that drive
    /// `matching()` and `split_top_level()` — the two places a deliberately
    /// unbalanced source could run away.
    const TOKENS: &[&str] = &[
        "{",
        "}",
        "(",
        ")",
        "[",
        "]",
        ";",
        ",",
        "//",
        "/*",
        "*/",
        "\n",
        "\"",
        "\\",
        "#version",
        "precision",
        "highp",
        "sampler2D",
        "samplerCube",
        "iChannel0",
        "iChannel3",
        "iResolution",
        "iTime",
        "texture",
        "textureLod",
        "mainImage",
        "mainSound",
        "mainVR",
        "out",
        "in",
        "vec2",
        "vec4",
        "float",
        "void",
        "return",
        "\u{0}",
        "\u{feff}",
        "\u{e9}",
        "\t",
        "  ",
    ];

    fn mutate(rng: &mut Rng, src: &str) -> String {
        // Byte-slicing a UTF-8 string would panic on its own, which is a bug
        // in the FUZZER rather than a finding — cut on char boundaries and
        // let the token alphabet supply the odd code points.
        let chars: Vec<char> = src.chars().collect();
        match rng.below(7) {
            0 if !chars.is_empty() => {
                let at = rng.below(chars.len());
                let len = 1 + rng.below(chars.len() - at);
                chars[..at].iter().chain(&chars[at + len..]).collect()
            }
            1 => {
                let at = rng.below(chars.len() + 1);
                let mut out: String = chars[..at].iter().collect();
                out.push_str(rng.pick(TOKENS));
                out.extend(&chars[at..]);
                out
            }
            2 => format!("{src}{src}"),
            3 => {
                // Deep nesting: the shape that turns a hand-written scanner
                // into a stack overflow if recursion ever creeps in.
                let depth = 1 + rng.below(64);
                let closes = rng.below(depth);
                format!("{}{src}{}", "{".repeat(depth), "}".repeat(closes))
            }
            4 => {
                let token = rng.pick(TOKENS);
                format!("{}{src}", token.repeat(1 + rng.below(32)))
            }
            5 if !chars.is_empty() => chars[..rng.below(chars.len())].iter().collect(),
            _ => {
                let n = 1 + rng.below(24);
                let mut soup = String::new();
                for _ in 0..n {
                    soup.push_str(rng.pick(TOKENS));
                }
                soup
            }
        }
    }

    /// Everything `transpile` promises its one caller. Panicking IS the
    /// failure mode under test, so there is nothing to catch here: a panic
    /// inside this function or inside the translator fails the test.
    fn check(src: &str) {
        let result = transpile(src);
        if result.ok {
            let wgsl = result
                .wgsl
                .as_ref()
                .expect("ok result must carry WGSL — the caller unwraps it");
            assert!(
                wgsl.contains("@fragment"),
                "ok result without a fragment entry point"
            );
            assert!(
                result.errors.is_empty(),
                "ok result carrying errors: {:?}",
                result.errors.iter().map(|e| &e.message).collect::<Vec<_>>()
            );
        } else {
            assert!(result.wgsl.is_none(), "failed result still carried WGSL");
            assert!(
                !result.errors.is_empty(),
                "failure with no message — the import dialog would show a blank error"
            );
        }
        // A reported line is the user's own, 1-based. Cleaning is documented
        // as line-count preserving, so the wrapper's header must never leak a
        // line number the editor cannot scroll to.
        let user_lines = src.lines().count().max(1) as u32;
        for error in &result.errors {
            if let Some(line) = error.line {
                assert!(
                    (1..=user_lines).contains(&line),
                    "error line {line} outside the user's 1..={user_lines}: {}",
                    error.message
                );
            }
            assert!(!error.message.is_empty(), "empty error message");
        }
    }

    #[test]
    fn transpile_survives_mutated_sources() {
        // Deep runs: BEATFORM_FUZZ_ITERS=200000 cargo test --workspace fuzz
        let iterations: usize = std::env::var("BEATFORM_FUZZ_ITERS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2_000);
        // A genuine infinite loop cannot be interrupted from inside, so the
        // walk runs on its own thread and the test fails on a timeout instead
        // of hanging the gate forever. `last` names the input that was in
        // flight, so even a hang stays reproducible.
        let last = Arc::new(Mutex::new(String::new()));
        let worker_last = Arc::clone(&last);
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let survived = std::panic::catch_unwind(AssertUnwindSafe(|| {
                let mut rng = Rng(0x5eed_1234_abcd_ef01);
                for i in 0..iterations {
                    let mut src = SEEDS[i % SEEDS.len()].to_string();
                    for _ in 0..1 + rng.below(3) {
                        src = mutate(&mut rng, &src);
                        // The size guard is `transpile`'s own first branch.
                        // Let the doubling mutation reach it, but do not
                        // spend the whole budget re-proving one early return.
                        if src.len() > MAX_GLSL_BYTES * 2 {
                            src.truncate(MAX_GLSL_BYTES + 1);
                        }
                    }
                    *worker_last.lock().unwrap_or_else(|e| e.into_inner()) = src.clone();
                    check(&src);
                }
            }))
            .is_ok();
            let _ = tx.send(survived);
        });
        // Debug-formatted on purpose: the inputs that find things are full of
        // BOMs and NULs, and printing those raw produces a culprit nobody can
        // read (the first run of this test did exactly that).
        let culprit = || {
            let text = last.lock().unwrap_or_else(|e| e.into_inner()).clone();
            format!("{:?}", &text[..text.len().min(2_000)])
        };
        // The budget SCALES with the walk, because a fixed one cannot serve
        // both uses: the default 2 000 iterations finish in about two
        // seconds, while a 200 000-iteration debug run measured 179.9s — a
        // flat 180s cap would have been a coin flip on that run and a
        // useless hang detector on the default one. A panic is NOT a
        // timeout: catch_unwind above lets the two report as themselves.
        let budget = Duration::from_secs(60 + iterations as u64 / 1_000);
        match rx.recv_timeout(budget) {
            Ok(true) => {}
            Ok(false) => panic!(
                "a mutated source broke the contract (the panic above says how); input was:\n{}",
                culprit()
            ),
            Err(_) => panic!(
                "transpile did not finish within the budget; last input was:\n{}",
                culprit()
            ),
        }
    }

    /// The mutator generates plausible GLSL, so it rarely lands on the exact
    /// byte sequence that trips a given scanner. These are the ones worth
    /// naming — each is a shape the code has an explicit branch for.
    #[test]
    fn transpile_survives_named_edges() {
        let edges = [
            "{",
            "}",
            "(((((((((((((((((((((((((((((((((",
            "void mainImage(out vec4 f, in vec2 c) {",
            "vec4 g(sampler2D a, sampler2D b) { return vec4(0.0); }\nvoid mainImage(out vec4 f, in vec2 c) { f = g(iChannel0, iChannel1); }",
            "vec4 g(sampler2D a) { return texture(a, vec2(0.0)); }\nvoid mainImage(out vec4 f, in vec2 c) { f = g(g); }",
            "\u{0}void mainImage(out vec4 f, in vec2 c) { f = vec4(0.0); }",
            "\u{feff}void mainImage(out vec4 f, in vec2 c) { f = vec4(0.0); }",
            "// mainImage\n",
            "/* void mainImage(out vec4 f, in vec2 c) {} ",
            "#version\n#version\n#version\n",
            "void mainImage(out vec4 f, in vec2 c) { f = vec4(0.0); }\u{0}",
            "\n\n\n\n\n\n\n\n\n\nsamplerCube c;\n",
        ];
        for edge in edges {
            check(edge);
        }
    }
}
