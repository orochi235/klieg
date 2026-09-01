import { fixed, lamp, orbit } from '@core/effects/lamp.js';
import { chase, flicker, hue } from '@core/effects/pieces.js';
import type { EffectPiece } from '@core/effects/types.js';
import { type Look, specOf } from '@core/render/looks.js';
import { compileDraft } from './draft.js';

export type PieceKind = 'flicker' | 'hue' | 'chase' | 'lamp' | 'draft';

/** Which `LightSource` a lamp walks. `fromPointer`, the shipped default, needs a placed word the
 * lab cannot reach; see the design. */
export type LampSourceKind = 'fixed' | 'orbit';

export interface ParamSpec {
  key: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** What the control does, and what it interacts with badly. Shown as a hover hint. */
  hint: string;
}

export const PARAMS: Record<Exclude<PieceKind, 'draft'>, ParamSpec[]> = {
  flicker: [
    {
      key: 'duration',
      min: 200,
      max: 8000,
      step: 100,
      value: 1400,
      hint: 'One pass. A spell and a calm override this to the nearest whole number of cycles.',
    },
    {
      key: 'depth',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0,
      hint: 'Floor of gain during a stutter. 0 is fully out.',
    },
    {
      key: 'unrest',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.18,
      hint: 'Share of the pass spent stuttering. This, not roving dwell, sets how much the sign flickers.',
    },
    {
      key: 'spell',
      min: 0,
      max: 12000,
      step: 100,
      value: 0,
      hint: 'Milliseconds of one flickering bout. Inert without a calm.',
    },
    {
      key: 'calm',
      min: 0,
      max: 30000,
      step: 100,
      value: 0,
      hint: 'Quiet between bouts. Inert without a spell, and lengthens the pass to fit whole cycles.',
    },
  ],
  hue: [
    {
      key: 'duration',
      min: 500,
      max: 20000,
      step: 100,
      value: 6000,
      hint: 'One trip round the wheel.',
    },
    {
      key: 'from',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0,
      hint: 'Where the sweep starts, in turns.',
    },
    {
      key: 'span',
      min: -2,
      max: 2,
      step: 0.01,
      value: 1,
      hint: 'Turns travelled per pass. Only 1 meets itself at the loop seam; anything else snaps back there.',
    },
    {
      key: 'spread',
      min: -1,
      max: 1,
      step: 0.01,
      value: 0,
      hint: 'Hue offset across the word, per unit of part.at. 0 is one synchronized sign.',
    },
    {
      key: 'luminance',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.5,
      hint: 'Rec.709 luma the sweep holds, so it stays one side of the bloom threshold all the way round.',
    },
  ],
  chase: [
    {
      key: 'duration',
      min: 200,
      max: 12000,
      step: 100,
      value: 2400,
      hint: 'One trip of the ramp along the part.',
    },
    {
      key: 'laps',
      min: -4,
      max: 4,
      step: 0.1,
      value: 1,
      hint: 'Ramp lengths per trip. Negative runs the other way.',
    },
    {
      key: 'spread',
      min: -2,
      max: 2,
      step: 0.01,
      value: 0,
      hint: 'Ramp offset between consecutive parts. Inert on a look with no gradient.',
    },
  ],
  lamp: [
    {
      key: 'duration',
      min: 200,
      max: 20000,
      step: 100,
      value: 4000,
      hint: 'One orbit. A fixed source ignores the clock, so this is inert under it.',
    },
    {
      key: 'radius',
      min: 0.05,
      max: 2,
      step: 0.05,
      value: 0.5,
      hint: "How far the light reaches, in em of layout space. Measured to a part's ink centre.",
    },
    {
      key: 'strength',
      min: 0,
      max: 8,
      step: 0.1,
      value: 2,
      hint: 'Light at the centre, falling to zero at the radius.',
    },
    {
      key: 'x',
      min: -3,
      max: 3,
      step: 0.05,
      value: 0,
      hint: 'Lamp position under a fixed source, and the orbit centre under an orbit.',
    },
    {
      key: 'y',
      min: -1.5,
      max: 1.5,
      step: 0.05,
      value: 0,
      hint: 'Same axis as the swatch grid, +y up. A single-line sign sits near 0.35.',
    },
    {
      key: 'sweep',
      min: 0,
      max: 2,
      step: 0.05,
      value: 0.3,
      hint: 'Radius of the circle an orbit walks. Inert under a fixed source.',
    },
  ],
};

/** Whether the look declares the colour ramp `chase` shifts; without one every chase layer is inert. */
export function hasGradient(look: Look): boolean {
  const decoration = specOf(look).decoration;
  return decoration?.kind === 'tube' && decoration.gradient !== undefined;
}

/** Defaults for a kind, as a plain params object. */
export function defaultParams(kind: PieceKind): Record<string, number> {
  if (kind === 'draft') return {};
  return Object.fromEntries(PARAMS[kind].map((p) => [p.key, p.value]));
}

export interface BuildOptions {
  /** A draft's hand-authored body. */
  source?: string;
  lampSource?: LampSourceKind;
}

/** A persisted layer can predate a param, so every read carries the default it was authored with. */
function num(params: Record<string, number>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Null when a draft's source has not compiled; every built-in always builds. */
export function buildPiece(
  kind: PieceKind,
  params: Record<string, number>,
  opts: BuildOptions = {},
): EffectPiece | null {
  if (kind === 'draft') return opts.source ? compileDraft(opts.source) : null;
  if (kind === 'flicker') return flicker(params);
  if (kind === 'hue') return hue(params);
  if (kind === 'chase') return chase(params);

  const x = num(params, 'x', 0);
  const y = num(params, 'y', 0);
  return lamp({
    source:
      opts.lampSource === 'orbit'
        ? orbit({ radius: num(params, 'sweep', 0.3), x, y })
        : fixed(x, y),
    duration: num(params, 'duration', 4000),
    radius: num(params, 'radius', 0.5),
    strength: num(params, 'strength', 2),
  });
}
