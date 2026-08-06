// FEAT-003 seed-candidate harness: drives the debug shell over CDP, applies
// each candidate look/theme (complete param maps designed offline from the
// __presets dump), lets the demo track pump it, screenshots the canvas, and
// serializes the candidate through the app's own writers (__gallerySerialize)
// so every seed .bfpreset/.bftheme is exactly what the real export buttons
// would produce.
//
//   node scripts/gallery-seed-shots.mjs --out=<dir> [--only=id1,id2]
// Prereq: Vite dev on 127.0.0.1:1420 (the debug exe loads it).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnApp, attachWithRecovery, waitHooks, killTree } from "./lib/app.mjs";
import { makeDemoLoader, seekAndPlay } from "./lib/demo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = (process.argv.find((a) => a.startsWith("--out=")) ?? "").slice("--out=".length);
if (!outDir) throw new Error("--out=<dir> required");
const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "")
  .slice("--only=".length)
  .split(",")
  .filter(Boolean);
mkdirSync(outDir, { recursive: true });

/**
 * Candidates. `params` are COMPLETE tuned maps (factory-style base merged
 * with deliberate departures) — each candidate must read as new territory
 * next to the built-in styles, not a renamed copy of one.
 * `demo`: which built-in synth track pumps the shot. `settle`: seconds of
 * playback before the screenshot (feedback/particle modes need buildup).
 */
const LOOKS = [
  {
    id: "prism-cathedral",
    name: "Prism Cathedral",
    mode: "echo-trails",
    demo: "groove",
    settle: 9,
    description:
      "A rose window built from your music: six-fold mirrored echoes refract every beat into stained-glass petals that bloom and fade.",
    params: {
      hue: 285,
      mirror: 6,
      sides: 6,
      echoHue: 0.7,
      hueSpin: 0.5,
      hueDrift: 0.3,
      decay: 0.95,
      zoom: 0.3,
      swirl: 0.18,
      radius: 0.3,
      thick: 0.018,
      react: 0.12,
      inject: 0.4,
      beatStar: 0.7,
      kickFlash: 0.12,
      beatZoom: 0.2,
      flowSwirl: 0.15,
      vignette: 0.45,
    },
  },
  {
    id: "orchid-glass",
    name: "Orchid Glass",
    mode: "metaballs",
    demo: "groove",
    settle: 8,
    description:
      "Violet glass in a slow boil — glossy orbs merge and split with the bassline, lit like studio chrome.",
    params: {
      hue: 45,
      hueField: 18,
      count: 4,
      size: 0.16,
      speed: 0.22,
      gloss: 0.95,
      glow: 0.45,
      innerGrad: 0.5,
      rimStart: 0.5,
      threshold: 1.15,
      energyGrow: 1.0,
      radiusBand: 0.6,
      radiusFloor: 0.8,
      beatSwell: 0.28,
      beatBright: 0.12,
      squash: 0.2,
      orbitX: 0.24,
      orbitY: 0.2,
      lightAngle: 55,
      bgLevel: 0.008,
      vignette: 0.5,
    },
  },
  {
    id: "abyssal-bloom",
    name: "Abyssal Bloom",
    mode: "nebula",
    demo: "groove",
    settle: 6,
    description:
      "Bioluminescence from the deep — an emerald kaleidoscope flower that ripples open on every kick and glitters like plankton.",
    params: {
      hue: 210,
      hueRange: 40,
      midHueShift: 0,
      kaleido: 7,
      scale: 2.6,
      warp: 2.2,
      flow: 0.08,
      contrast: 0.95,
      saturation: 0.7,
      depth: 0.4,
      sparkle: 0.7,
      sparkleScale: 26,
      sparkleSharp: 36,
      hotCore: 1.2,
      brightFloor: 0.06,
      bassBright: 0.3,
      beatRipple: 0.4,
      rippleWidth: 24,
      beatBloom: 0.1,
      driveGlow: 0.08,
      spin: 0.2,
      vignette: 0.6,
    },
  },
  {
    id: "solar-cascade",
    name: "Solar Cascade",
    mode: "particle-flow",
    demo: "neuro",
    settle: 9,
    description:
      "120k embers in a golden spiral — the galaxy tightens as the track drives and erupts outward on every kick.",
    params: {
      hue: 40,
      hueSpread: 30,
      swirl: 1.2,
      gravity: 0.6,
      flowStrength: 0.9,
      flowScale: 1.0,
      damping: 0.965,
      spawnRadius: 0.12,
      size: 0.0065,
      brightness: 0.55,
      density: 0.7,
      audioFlow: 2.2,
      beatBurst: 1.5,
      sizePulse: 0.7,
      speedColor: 0.04,
      sat: 0.95,
    },
  },
  {
    id: "neon-monsoon",
    name: "Neon Monsoon",
    mode: "tunnel-rings",
    demo: "neuro",
    settle: 6,
    description:
      "A rain-slick tunnel bending through neon — spectrum-lit tiles, drifting color, and a curve that leans into the drums.",
    params: {
      hue: 210,
      hueSpread: 130,
      colorFade: 0.35,
      speed: 1.0,
      curve: 0.5,
      curveScale: 1.1,
      rings: 11,
      spokes: 18,
      twist: 1.6,
      roundness: 0.7,
      surfaceWarp: 1.2,
      tileSat: 0.9,
      tileSpectrum: 0.55,
      tileLevel: 0.12,
      groutWidth: 0.05,
      groutLevel: 0.26,
      checker: 0.08,
      fogFar: 0.92,
      fogNear: 0.01,
      centerGlow: 0.6,
      beatPulse: 0.9,
      beatBright: 0.3,
      cruiseFloor: 0.5,
      cruiseEnergy: 1.3,
      pulseWidth: 12,
      vignette: 0.3,
    },
  },
  {
    id: "solar-temple",
    name: "Solar Temple",
    mode: "spectrum-scape",
    demo: "groove",
    settle: 4,
    description:
      "A temple of sound rising from an ember moat — every block a frequency band, climbing gold into the dark.",
    params: {
      hue: 285,
      hueRange: 110,
      heightScale: 12,
      camPitch: 34,
      camDist: 20,
      camSpin: -10,
      fov: 58,
      targetY: 1.4,
      emissive: 0.7,
      light: 0.8,
      barWidth: 0.55,
      spacing: 0.75,
    },
  },
  {
    id: "vhs-sunrise",
    name: "VHS Sunrise",
    mode: "synthwave",
    demo: "groove",
    settle: 4,
    description:
      "Golden-hour synthwave off a worn tape — big striped sun, teal grid, soft scanlines, mountains in haze.",
    params: {
      hue: 18,
      gridHue: 168,
      sunX: 0.3,
      sunR: 0.3,
      sunY: 0.3,
      sunRays: 0.45,
      scan: 0.75,
      mountains: 0.4,
      gridGlow: 1.3,
      gridScale: 0.7,
      horizonY: 0.5,
      fog: 0.8,
      speed: 1.0,
      react: 0.9,
      beatPulse: 0.55,
      starDensity: 0.3,
      vignette: 0.3,
    },
  },
  {
    id: "obsidian-pulse",
    name: "Obsidian Pulse",
    mode: "bass-circle",
    demo: "neuro",
    settle: 5,
    description:
      "A dark-club bass ring in cold teal — twin mirrored arcs, floating sparks, and a pump you can feel in the artwork.",
    params: {
      hue: 175,
      hueSpread: 40,
      cover: 0,
      radius: 0.16,
      barLen: 0.3,
      gap: 0.05,
      pump: 0.32,
      beatPump: 0.3,
      beatBurst: 1.1,
      particles: 0.8,
      partDensity: 7,
      partFill: 0.4,
      partFloat: 0.6,
      rimBright: 1.25,
      barGlow: 0.5,
      symmetry: 2,
      spin: 0.2,
      saturation: 1.05,
      lightness: 1,
      vignette: 0.5,
    },
  },
  {
    id: "glass-mandala",
    name: "Glass Mandala",
    mode: "radial-burst",
    demo: "drift",
    settle: 5,
    description:
      "A wine-dark glass mandala — six flame petals that breathe with the low end, made for slow, heavy sets.",
    params: {
      hue: 305,
      hueSpread: 160,
      symmetry: 6,
      rotSpeed: 0.08,
      innerRadius: 0.22,
      barLen: 0.2,
      coreSize: 0.8,
      glow: 0.4,
      rimBright: 0.85,
      coreBright: 0.4,
      wobBase: 0.04,
      wobAmp: 0.14,
      wobClamp: 0.16,
      spinBase: 0.5,
      spinEnergy: 0.6,
      peaks: 0,
      detailPos: 0.75,
      cover: 0,
      vignette: 0.55,
    },
  },
];

/** Themes: a look promoted to a complete document (smooth spectrum baked,
 * clean default post/motion, no assets so the file stays tiny). */
const THEMES = [
  {
    id: "deep-current",
    name: "Deep Current",
    fromLook: "abyssal-bloom",
    demo: "drift",
    settle: 6,
    description:
      "A complete deep-sea setup: the Abyssal Bloom kaleidoscope with smoothed spectrum curves — drop it on any track and it reads finished.",
  },
  {
    id: "sunset-circuit",
    name: "Sunset Circuit",
    fromLook: "vhs-sunrise",
    demo: "groove",
    settle: 4,
    description:
      "A complete retrowave setup around VHS Sunrise — golden sun, teal grid and tape-era softness, ready for a whole set.",
  },
];

function applyExpr(candidate) {
  return `(async () => {
    const s = window.__store.getState();
    s.switchPreset(${JSON.stringify(candidate.mode)});
    const params = ${JSON.stringify(candidate.params)};
    for (const [k, v] of Object.entries(params)) s.setParam(k, v);
    return window.__store.getState().presetId;
  })()`;
}

let app;
try {
  app = spawnApp({
    root,
    portBase: 9700, // see the map in lib/app.mjs
    // ISOLATED browser profile: debug + installed Beatform share a WebView2
    // user-data folder, and a second process JOINS the existing browser —
    // silently dropping the debugging port AND entangling this harness with
    // an app the owner may have open. A private folder guarantees our own
    // browser, our own port, and a kill that cannot touch anything else.
    profileName: "wv2-seed-profile",
  });
  const run = [...LOOKS, ...THEMES].filter((c) => only.length === 0 || only.includes(c.id));

  // First demo load rides inside the recovery probe: on a cold Vite dep
  // cache its dynamic imports trigger the one-off "new dependencies
  // optimized" page reload, which destroys the awaited eval — the retry
  // re-attaches and re-loads (wave-shots lesson).
  let ensureDemo;
  const cdp = await attachWithRecovery(app, async (c) => {
    await waitHooks(c, ["__store", "__engine", "__gallerySerialize"]);
    ensureDemo = makeDemoLoader(c);
    if (run[0]) await ensureDemo(run[0].demo);
  });
  for (const c of run) {
    const isTheme = "fromLook" in c;
    const src = isTheme ? LOOKS.find((l) => l.id === c.fromLook) : c;
    await ensureDemo(c.demo);
    await seekAndPlay(cdp);
    const preset = await cdp.eval(applyExpr(src));
    if (preset !== src.mode) throw new Error(`${c.id}: preset is ${preset}, wanted ${src.mode}`);
    if (isTheme) {
      await cdp.eval(`window.__store.getState().setSmoothSpectrum?.(true)`);
    }
    await sleep((c.settle ?? 5) * 1000);
    const shotFile = path.join(outDir, `${c.id}.png`);
    await cdp.shotCanvas(shotFile, { settleMs: 400 });
    console.log("SHOT", shotFile);
    const file = await cdp.eval(
      `window.__gallerySerialize(${JSON.stringify(isTheme ? "theme" : "look")}, ${JSON.stringify({
        name: c.name,
        author: "Beatform",
        description: c.description,
      })})`,
      false,
    );
    const ext = isTheme ? "bftheme" : "bfpreset";
    writeFileSync(path.join(outDir, `${c.id}.${ext}`), file);
    console.log("FILE", `${c.id}.${ext}`, `${file.length} bytes`);
    if (isTheme) {
      await cdp.eval(`window.__store.getState().setSmoothSpectrum?.(false)`);
    }
  }
  console.log("SEED-SHOTS OK", run.length, "candidates");
} finally {
  // Kill OUR process tree only — never a name-wide sweep, which would take
  // down an installed Beatform the owner has open.
  killTree(app);
}
