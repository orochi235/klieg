import { hash01 } from '../motion/types.js';
import { hueColor } from './luminance.js';
import type { EffectName, EffectPiece } from './types.js';

export interface FlickerSpec {
  /** Milliseconds for one pass. With a `spell` and a `calm` the pass becomes the nearest whole
   * number of cycles of the two, which can be longer than this or shorter. */
  duration?: number;
  /** How dark the stutter goes, as the floor of `gain`. 0 is fully out. */
  depth?: number;
  /** Share of the pass spent stuttering. The rest is held lit. */
  unrest?: number;
  /** Milliseconds of one flickering bout. Needs a `calm`, and both must exceed one step. */
  spell?: number;
  /** Milliseconds held steady between bouts. Needs a `spell`, and lengthens the pass to fit whole
   * cycles of the two. 0, the default, flickers throughout. */
  calm?: number;
}

/** One step is ~58ms, so the shortest drop covers about three frames at 60fps; a one-frame drop
 * reads as noise rather than as a failing tube. Derived rather than fixed: 24 steps against a long
 * pass would stretch each one into a multi-second strobe. */
const STEP_MS = 1400 / 24;

function stepsFor(duration: number): number {
  return Math.max(1, Math.round(duration / STEP_MS));
}

/** How far above `depth` a drop is allowed to sit, so a stutter lands near dark, not half-lit. */
const BITE = 0.35;

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}

/** A tube on its way out: mostly lit, with short irregular stutters. */
export function flicker(spec: FlickerSpec = {}): EffectPiece {
  const depth = clamp01(spec.depth ?? 0);
  const unrest = clamp01(spec.unrest ?? 0.18);
  const wanted = spec.duration ?? 1400;
  const calm = Math.max(0, spec.calm ?? 0);
  const spell = Math.max(0, spec.spell ?? 0);

  // Both scales snap to whole steps, which is what puts every gate boundary on a step edge: a
  // boundary inside a step clips that drop to a frame or two and it reads as noise.
  const spellSteps = Math.round(spell / STEP_MS);
  const calmSteps = Math.round(calm / STEP_MS);
  const gated = spellSteps > 0 && calmSteps > 0;
  const cycleSteps = spellSteps + calmSteps;
  const cycles = gated ? Math.max(1, Math.round(wanted / (cycleSteps * STEP_MS))) : 1;
  const duration = gated ? cycles * cycleSteps * STEP_MS : wanted;
  const steps = stepsFor(duration);
  const spellShare = spellSteps / cycleSteps;

  return {
    duration,
    at(t, part) {
      if (gated && (t * cycles) % 1 >= spellShare) return { gain: 1 };
      const step = Math.floor(t * steps) % steps;
      if (hash01(step + part.index * 977.3) > unrest) return { gain: 1 };
      const bite = hash01(step * 3.7 + part.index * 131.1);
      return { gain: depth + (1 - depth) * bite * BITE };
    },
  };
}

export interface HueSpec {
  duration?: number;
  /** Where the sweep starts, in turns. */
  from?: number;
  /** How far it travels in one pass, in turns. 1 is the whole wheel, and the only value that meets
   * itself at the loop seam — any other snaps back there. */
  span?: number;
  /** Hue offset across the word, in turns per unit of `part.at`. 0 is one synchronized sign. */
  spread?: number;
  /** Rec.709 luma the sweep holds. 0.5 is where the wheel's darkest and brightest hues give up the
   * same amount — blue's saturation against yellow's brightness. */
  luminance?: number;
}

/** A sign that changes colour, at a luma the bloom threshold sees the same all the way round. */
export function hue(spec: HueSpec = {}): EffectPiece {
  const duration = spec.duration ?? 6000;
  const from = spec.from ?? 0;
  const span = spec.span ?? 1;
  const spread = spec.spread ?? 0;
  const luminance = clamp01(spec.luminance ?? 0.5);

  return {
    duration,
    at(t, part) {
      return { color: hueColor(from + t * span + part.at * spread, luminance) };
    },
  };
}

export interface ChaseSpec {
  /** One trip of the ramp along the part, in ms. */
  duration?: number;
  /** Ramp lengths travelled per trip. Negative runs the other way. */
  laps?: number;
  /** Ramp offset between consecutive parts, so the chase reads as a procession. */
  spread?: number;
}

/**
 * Slides the colour ramp along the part. Inert on a look that declares no `gradient`: a shift of a
 * ramp that is not there changes nothing, and both shipped looks are flat.
 */
export function chase(spec: ChaseSpec = {}): EffectPiece {
  const duration = spec.duration ?? 2400;
  const laps = spec.laps ?? 1;
  const spread = spec.spread ?? 0;

  return {
    duration,
    at(t, part) {
      return { crawl: t * laps + part.at * spread };
    },
  };
}

// `satisfies` rather than an annotation: it holds every name to a factory usable with no spec,
// which is all a name lookup can supply, without binding the next piece to `FlickerSpec`.
export const EFFECTS = { flicker, hue, chase } satisfies Record<EffectName, () => EffectPiece>;
