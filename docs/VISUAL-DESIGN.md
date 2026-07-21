# Visual design reference

Why some modes read as professional and others read as amateur, and the exact
maths to fix it. Written after a visual review found several modes looked
flat, muddy and static next to Spectrum Bars and Bass Circle.

Every helper named here exists in the WGSL prelude (`HEADER` in
`webgpuRenderer.ts`) and is callable from any preset.

---

## 1. Colour

**Why muddy olive/brown happens.** Three mechanisms, all mechanical rather than
matters of taste:

1. **HSL is not perceptually uniform.** A hue ramp at fixed `s`/`l` does not
   hold constant perceived brightness — green (~60–90°) is far brighter than
   blue (~240°) at the same `l`. A hue that drifts across that range walks
   through the desaturated middle and comes out olive. This is exactly how
   Tunnel got its olive/brown wedges.
2. **Additively mixing near-complements collapses toward grey**, which over a
   dark base reads as brown/khaki rather than as shadow.
3. **The "dark" is not dark.** A background at ~(0.12, 0.12, 0.10) is mud. Keep
   background relative luminance ~**0.02–0.06** and _hue_ it rather than grey
   it — `vec3f(0.02, 0.01, 0.04)`, not a grey.

**Use `cosPalette()` instead of a drifting HSL hue.** Inigo Quilez's cosine
gradient, `col(t) = a + b·cos(TAU·(c·t + d))`, stays saturated across its whole
range because per-channel contrast is explicit rather than derived from a hue
angle.

| a             | b             | c           | d                  | look                                |
| ------------- | ------------- | ----------- | ------------------ | ----------------------------------- |
| 0.5           | 0.5           | (1,1,1)     | (0.00, 0.33, 0.67) | classic evenly-stepped spectrum     |
| 0.5           | 0.5           | (1,1,1)     | (0.00, 0.10, 0.20) | warm, narrow range (reds→yellows)   |
| 0.5           | 0.5           | (1,1,0.5)   | (0.80, 0.90, 0.30) | cooler, richer blue-green variation |
| 0.5           | 0.5           | (1,0.7,0.4) | (0.00, 0.15, 0.20) | irregular, richly multicoloured     |
| 0.5           | 0.5           | (2,1,0)     | (0.50, 0.20, 0.25) | striped / psychedelic               |
| (0.8,0.5,0.4) | (0.2,0.4,0.2) | (2,1,1)     | (0.00, 0.25, 0.25) | low-contrast but warm-biased        |

Keep `c` integer (or half-integer) so the ramp is continuous.

**Structure:** an analogous 60–120° arc for element bodies (coherent), with a
complementary or near-white accent reserved _only_ for peak caps and beat
flashes. One calm gradient plus one sharp point of maximum contrast — not
everything shouting.

**Hot core.** Bright things read as _emitting_ only when they desaturate toward
white and exceed 1.0 before tone mapping:

```wgsl
let hot = smoothstep(0.55, 0.95, signal);
col = mix(col, vec3f(1.0), hot);   // desaturate toward white
col *= 1.0 + hot * 1.5;            // push past 1.0, let tonemap() roll it off
```

Never clamp channels independently — clipping R before G/B shifts hue.

---

## 2. Depth

**Log-polar is what makes a tunnel a tunnel.** Scrolling `log(r)` at constant
speed gives constant _perceived_ speed; scrolling `r` linearly does not, and
reads as a flat dartboard.

```wgsl
let r     = max(length(p), 1e-4);   // pole safety
let ringC = log(r) - u.time * speed;
```

Equivalently, `depth = k / r` is the pinhole mapping for a cylinder viewed down
its axis — `r → 0` is infinitely far. Tunnel uses this form.

**Atmospheric fog** (IQ). Since distance ∝ `1/r`:

```wgsl
let dist   = 1.0 / r;
let fogAmt = 1.0 - exp(-dist * density);   // density ~0.15-0.4
col = mix(col, bgColor, fogAmt);
```

Depth should reduce **contrast, saturation and brightness** together, not just
darken:

```wgsl
let luma = dot(col, vec3f(0.2126, 0.7152, 0.0722));
col = mix(col, vec3f(luma), fogAmt * 0.5);
col = mix(col, bgColor, fogAmt);
```

Shrink detail width with depth too, or distant structure smears into grey.

---

## 3. Motion

**Everything moving at once = nothing reads.** Identical phase across N
elements makes the eye group them into one pulsing blob. Stagger with the
golden-ratio conjugate so offsets never visibly repeat:

```wgsl
let phase_i = fract(f32(i) * 0.6180339887);
```

Use a **different `gridPulse(k)` per layer** so layers stay on-grid without
moving in lockstep.

**Never fully freeze between beats.** Layer continuous drift under the discrete
punch: `slowDrift = u.time * 0.03` plus `u.driveBeat`-driven transient.

**Avoid pure sine wobble** — it is perfectly symmetric and perfectly periodic,
which is what reads as mechanical. Either shape the exponential pulse
(`pow(u.driveBeat, 0.6)` lengthens the tail), or sum incommensurate
frequencies: `sin(t) + 0.4*sin(t*1.618) + 0.2*sin(t*2.41)` never repeats.

**Frame-rate-independent smoothing** (this is a real bug, not a nicety):

```
value = mix(value, target, 1.0 - exp(-rate * dt))
```

Attack rate ~40–60, release ~8–15. Asymmetric: fast attack, slow release.

---

## 4. Detail

**Uniform random particles ARE white noise** — that is definitionally why they
read as TV static. Two separate causes, both fixable:

- positions/velocities drawn independently instead of from a shared coherent
  field → use **curl noise** (divergence-free, so particles neither clump nor
  evacuate, and visible streamlines appear);
- per-particle size/brightness **re-rolled every frame** → persistence of
  vision can never lock onto a particle. Hold stochastic per-particle values
  for the particle's lifetime; never re-roll per frame.

```wgsl
fn curl(p: vec2f) -> vec2f {
  let e = 0.01;
  let dx = (fbm(p + vec2f(e, 0.0)) - fbm(p - vec2f(e, 0.0))) / (2.0 * e);
  let dy = (fbm(p + vec2f(0.0, e)) - fbm(p - vec2f(0.0, e))) / (2.0 * e);
  return vec2f(dy, -dx);
}
```

**Domain warping** (`warpFbm()` in the prelude) turns blobby noise into
filaments — the difference between "fog" and "nebula". Modulating the warp
strength with `u.mid` makes it breathe.

Also: elongate a particle along its velocity for cheap motion blur; vary
density by depth rather than uniformly.

---

## 5. Finishing

- **Glow**: analytic, per element — `exp(-k * dist)`, k ~8–20, intensity
  ~0.3–0.6. No blur pass needed.
- **Tone map**: `tonemap()` (ACES approx.) as the _last_ colour step. Run the
  shader body in a range where cores reach ~2.0–3.0. Do not add a manual gamma
  on top if the swapchain is already `-srgb` — double-applying sRGB is a very
  literal cause of "why is this flat".
- **Vignette**: 0.25–0.4. Mix, never multiply to black.
- **Chromatic aberration**: ~0.03–0.10, i.e. 2–4 px at the frame edge. Drive it
  partly off `u.driveBeat` so it flares on hits instead of sitting on like a
  fixed filter.
- **Dither/grain**: ±0.002–0.004 kills 8-bit banding invisibly (`grain()`).
  0.01–0.02 is a deliberate film look. If grain is consciously visible in a
  background wash it is ~2–3× too strong.

---

## 6. Audio mapping

Map different bands to **different visual dimensions**. If more than one signal
triggers a discrete pop, the result reads as busy rather than on-beat — pick
exactly one driver of discrete events.

| signal                   | dimension                    | character                          |
| ------------------------ | ---------------------------- | ---------------------------------- |
| `u.driveBeat` / `u.kick` | zoom, flash, scale pop       | discrete — the ONLY instant events |
| `u.bass`                 | core radius, wash brightness | slow, weighty                      |
| `u.mid` / `u.voice`      | hue rotation, warp strength  | continuous, carries information    |
| `u.treble` / `u.hat`     | glow sharpness, sparkle      | fine detail                        |
| `u.rms` / `u.energy`     | vignette, overall level      | whole-frame breathing              |

**Anticipation**: stage motion _before_ the hit using grid phase —

```wgsl
let coil = smoothstep(0.85, 1.0, u.barPhase) * 0.1;
let scale = base - coil + punch;
```

**Loudness is logarithmic.** Pass linear energy through `pow(x, 0.4-0.6)`
before driving a continuous parameter, or it feels dead at the bottom and
harsh at the top.

---

## Sources

Inigo Quilez ([palettes](https://iquilezles.org/articles/palettes/),
[domain warping](https://iquilezles.org/articles/warp/),
[fog](https://iquilezles.org/articles/fog/));
[Ottosson on OKLab](https://bottosson.github.io/posts/oklab/);
[log-spherical mapping](https://www.osar.fr/notes/logspherical/);
[Narkowicz ACES](https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/);
[tone mapping survey](https://64.github.io/tonemapping/);
[Catlike Coding bloom](https://catlikecoding.com/unity/tutorials/advanced-rendering/bloom/);
[Bridson curl noise](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph2007-curlnoise.pdf);
[exponential smoothing](https://lisyarus.github.io/blog/posts/exponential-smoothing.html);
[banding/dither](https://blog.frost.kiwi/GLSL-noise-and-radial-gradient/).
