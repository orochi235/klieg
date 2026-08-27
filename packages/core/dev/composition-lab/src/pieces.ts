import { chase, flicker, hue } from '@core/effects/pieces.js';
import type { EffectPiece } from '@core/effects/types.js';
import { compileDraft } from './draft.js';

export type PieceKind = 'flicker' | 'hue' | 'chase' | 'draft';

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
      hint: 'Ramp offset between consecutive parts. Inert on a look with no gradient, and both shipped tube looks are flat.',
    },
  ],
};

/** Defaults for a kind, as a plain params object. */
export function defaultParams(kind: PieceKind): Record<string, number> {
  if (kind === 'draft') return {};
  return Object.fromEntries(PARAMS[kind].map((p) => [p.key, p.value]));
}

/** Null when a draft's source has not compiled; every built-in always builds. */
export function buildPiece(
  kind: PieceKind,
  params: Record<string, number>,
  source?: string,
): EffectPiece | null {
  if (kind === 'draft') return source ? compileDraft(source) : null;
  if (kind === 'flicker') return flicker(params);
  if (kind === 'hue') return hue(params);
  return chase(params);
}
