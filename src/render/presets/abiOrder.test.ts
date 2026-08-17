import { describe, expect, it } from "vitest";
import { presets } from "./index";
import { builder } from "./builder";
import { allParams, type PresetDef } from "../types";

/**
 * THE ABI FINGERPRINT — the cheap sibling of `npm run test:gpu`.
 *
 * `params` and `advanced` are the GPU ABI: `allParams` packs them in that
 * order and a spec's position IS its shader accessor index, so moving one spec
 * between the two arrays repacks the whole uniform buffer and moves every one
 * of the 280 pixel hashes. The tier a knob RENDERS in is a separate axis
 * (`ParamSpec.tier`, read only by `advancedKeys`), precisely so presentation
 * work can never reach the ABI.
 *
 * This test fails in ~2 seconds if a spec is moved, inserted, removed or
 * renamed. The GPU matrix would eventually catch it too — on a device, after
 * minutes, as 213 red hashes with no hint of the cause.
 *
 * WHEN THIS FAILS: do not update the baseline to make it green unless the
 * commit genuinely adds/removes/reorders a param on purpose. If the change was
 * "I wanted this knob to show up in the curated tier", the fix is
 * `tier: "curated"` on the spec where it already lives — never a move.
 *
 * Baselines below were generated from the v2.81.0 tree, BEFORE the 2.82.0
 * curation pass, and committed unchanged: the promotions provably moved
 * nothing.
 */
const ABI_BASELINE: Record<string, string> = {
  "spectrum-bars":
    "hue,hueSpread,saturation,lightness,glow,barGap,beatZoom,mirror,peaks,stereoSplit,capShape,reflect,sway,barHeight,barSat,barLift,glowReach,capBright,bgLevel,bgBassGlow,beatFlash,beatBright,vignette,reflectFade,freqLo,freqHi",
  "radial-burst":
    "hue,hueSpread,saturation,lightness,innerRadius,symmetry,angle,rotSpeed,glow,peaks,cover,coverHue,barLen,ringBreathe,coreSize,corePump,coreBeat,wobBase,wobAmp,wobClamp,spinBase,spinEnergy,coreBright,detailRing,detailPos,beatBloom,coverMix,coverBright,coverFit,coverZoom,coverX,coverY,rimBright,vignette",
  oscilloscope:
    "hue,gain,calm,glow,traceBright,fill,mirror,traces,renderMode,persist,display,traceClamp,coreWidth,traceSpread,agFloor,agRange,hueWave,bandHue,ghostDim,fillDim,bandDim,graticule,gridLevel,gridBeat,scanline,beatLift,bgLevel,vignette,kaleido,xyRotate",
  particles:
    "hue,saturation,lightness,density,size,speed,direction,beatDance,sizePulse,fly,clump,streak,hotCore,shootingStars,constellation,energyDrive,wander,wanderSpeed,fill,layers,parallax,hueVariance,twinkle,glow,brightness,beatFlash,bgLevel,vignette,mirror,sizeVar,bandColor,beatPop",
  "tunnel-rings":
    "hue,hueSpread,colorFade,speed,rings,spokes,material,beatPulse,junction,curve,coverWall,centerGlow,cruiseFloor,curveScale,cruiseEnergy,beatSpeed,tileLevel,tileSpectrum,pulseWidth,tileSat,checker,groutWidth,groutLevel,fogNear,fogFar,vignette,mirror,twist,roundness,surfaceWarp,beatBright",
  nebula:
    "hue,scale,flow,kaleido,contrast,sparkle,beatRipple,duo,hue2,windStrength,stars,warp,angle,spin,depth,hueRange,midHueShift,brightFloor,bassBright,saturation,sparkleScale,sparkleSharp,rippleWidth,rippleWarp,beatBloom,driveGlow,vignette,hotCore,windAngle",
  metaballs:
    "hue,count,size,speed,glow,threshold,gloss,beatSwell,smear,orbitX,orbitY,radiusFloor,energyGrow,radiusBand,rimStart,innerGrad,hueField,beatBright,bgLevel,vignette,mirror,lightAngle,squash,bassWeight,eccentric,environment",
  "led-matrix":
    "display,cols,rows,gap,rounded,hueShift,saturation,lightness,ghost,scrollSpeed,beatBoost,dim,hueLow,hueHigh,spectrumColor,gradStart,gradEnd,litLevel,hotBoost,bassGlow,beatFlash,peaks,peakBright,bloom,histFade,scanline,flicker,panelVariance,vignette",
  // P-19: the spectrogram-waterfall archetype. New in this release, so its
  // row is a first baseline rather than a frozen historical one — every later
  // edit answers to it exactly like the fifteen above.
  "spectro-falls":
    "direction,slices,axis,speed,hue,hueSpread,saturation,lightness,prism,quiet,loud,airLift,beatBoost,glow,edge,fade,hotWhite,spill,floorLevel,grid,gridLines,beatMarks,axisFocus,bassGlow,vignette",
  // P-19 entry 2: the typography mode. First baseline, same contract.
  "lyric-stage":
    "layout,size,context,tilt,hue,hueSpread,saturation,lightness,drift,entrance,beatPunch,wordGlow,chromaSplit,glow,flare,ghostBars,stageLevel,unsungDim,contextScale,greekRows,glowReach,bassStage,flutter,rehearse,vignette",
  // P-19 entry 3: the cover-art-first mode. First baseline, same contract.
  gatefold:
    "layout,artSize,reflection,hue,hueSpread,saturation,lightness,drift,breathe,beatZoom,flare,glow,skirt,wash,cover,coverHue,border,coverFit,coverZoom,coverX,coverY,roomLevel,grain,reflectFade,emblem,vignette",
  // P-19 entry 5 (the roster's last): the reaction-diffusion mode. First
  // baseline, same contract.
  overgrowth:
    "form,scale,speed,hue,hueSpread,saturation,lightness,duo,growth,etch,surge,seeds,glow,relief,flow,contrast,seedSize,barSurge,paper,haze,floorLevel,bassGlow,vignette,grain",
  "voice-orb":
    "hue,size,satellites,ring,ringStyle,mirror,texture,response,voiceFocus,wobble,sparkle,flare,rmsBlend,growth,idleBreath,wobScale,mode1,mode2,mode3,coreGlow,breathGlow,rimGlow,ringDist,ringWave,ringCount,satSize,satDist,satOrbit,sparkleScale,bgLevel,vignette",
  "echo-trails":
    "hue,decay,zoom,swirl,radius,source,react,inject,beatZoom,flowSwirl,thick,hueSpin,hueDrift,kickFlash,vignette,mirror,echoHue,sides,beatStar,warp,centerX,centerY",
  "particle-flow":
    "hue,saturation,lightness,field,flowStrength,swirl,beatBurst,size,brightness,density,ribbon,flowScale,damping,gravity,attractor,audioFlow,midSwirl,trebleJitter,sizePulse,hueSpread,speedColor,sat,spawnRadius,vignette,bgLevel",
  // 2.102.0: ",terrainSmooth" APPENDED for the Waveform terrain layout
  // (P-19 entry 4) — additive at the end of advanced[], so every existing
  // accessor index is unchanged and no shipped pixel hash moves for it.
  "spectrum-scape":
    "hue,heightScale,camPitch,camDist,camSpin,emissive,layout,barShape,saturation,lightness,hotBeat,bandGlow,fov,hueRange,barWidth,spacing,light,camYaw,targetY,driveHeight,hotDrive,glowBeat,hotWindow,hueLift,fillLight,ambientLight,fogDensity,terrainSmooth",
  aurora:
    "hue,bright,react,flow,thick,baseY,wave,layers,beatPulse,palWarm,moon,ground,specAmt,bassSwell,drift,reflect,horizon,reflectFade,hueStep,hueSpread,palSpan,rays,sat,stars,bgGlow,mirror,groundRough,moonX,moonY,moonGlow",
  synthwave:
    "hue,gridHue,speed,react,beatPulse,sunR,roadW,skyline,mountains,gridGlow,scan,sunWarm,sunY,sunX,scanCount,scanWidth,scanPhase,sunRays,roadLanes,roadGlow,skyDensity,windows,gridScale,horizonY,stars,starDensity,gridLock,fog,vignette",
  "bass-circle":
    "hue,saturation,lightness,radius,pump,barLen,segments,particles,spin,rimBright,cover,coreFill,coverHue,symmetry,angle,hueSpread,beatPump,gap,segGap,barGlow,partDensity,partFill,partFloat,beatBurst,partBeat,coverMix,coverBright,coverFit,coverZoom,coverX,coverY,vignette",
  builder2:
    "l0.opacity,l0.hue,l0.hueSpread,l0.glow,l0.flash,l1.opacity,l1.hue,l1.hueSpread,l1.density,l1.speed,l1.streak,l2.opacity,l2.hue,l2.hueSpread,l2.height,l2.gap,l2.glow,l2.peaks,l3.opacity,l3.hue,l3.hueSpread,l3.start,l3.end,l3.sharp,l3.bright",
  builder:
    "hue,hueSpread,bgGlow,beatFlash,bars,radial,waveLine,waveCircle,orb,stars,rings,barsHeight,barsGap,barsGlow,barsPeaks,radialR,radialLen,radialSym,lineY,lineAmp,lineGlow,circleR,circleAmp,orbSize,orbPump,orbWobble,starDensity,starSpeed,starStreak,ringStart,ringEnd,ringSharp,ringBright,orbBeat,vignette",
};

/** The strip, plus the hidden classic `builder` that old projects still render. */
const ALL_BUILTINS: PresetDef[] = [...presets, builder];

describe("ABI order is frozen: no spec ever moves between params[] and advanced[]", () => {
  it("covers every built-in — a new preset must add its baseline here", () => {
    expect(ALL_BUILTINS.map((p) => p.id).sort()).toEqual(Object.keys(ABI_BASELINE).sort());
  });

  for (const preset of ALL_BUILTINS) {
    it(`${preset.id} packs its params in the recorded order`, () => {
      expect(
        allParams(preset)
          .map((s) => s.key)
          .join(","),
        `ABI order moved for "${preset.id}". If you re-tiered a knob, use ` +
          `tier: "curated" where it already lives — do NOT move it between ` +
          `params[] and advanced[]; that moves all 213 GPU pixel hashes.`,
      ).toBe(ABI_BASELINE[preset.id]);
    });
  }

  it("the tier flag is an override on advanced[] only, never decoration", () => {
    for (const preset of ALL_BUILTINS) {
      expect(
        preset.params.every((s) => s.tier === undefined),
        `"${preset.id}" marks a params[] spec tier:"curated" — it is already ` +
          `curated, so the flag is dead weight that hides the real invariant.`,
      ).toBe(true);
    }
  });
});
