import { type HueSpec, hue } from '@core/effects/pieces.js';
import type { EffectSpec } from '@core/effects/types.js';
import { type LookSpec, specOf } from '@core/render/looks.js';
import type { TubeSpec } from '@core/render/tube/index.js';

/** The shipped look every cell departs from. */
const BASE = 'tubing';

export interface Variant {
  id: string;
  /** What this cell varies, printed on its bar. */
  label: string;
  /** Overrides on the tube decoration. */
  tube?: Partial<TubeSpec>;
  /** Overrides on the color sweep. Every cell cycles; this says how fast and how far apart. */
  sweep?: HueSpec;
  /** Share of the run pool the sweep addresses, 0..1. The whole pool when omitted. */
  amount?: number;
}

/**
 * A `replace` gradient writes the ramp alone and drops the run-color attribute the sweep writes,
 * so the hue would resolve every frame and show nothing. `modulate` multiplies the two and reads.
 */
export function sweepIsVisible(tube: TubeSpec): boolean {
  return tube.gradient?.mode !== 'replace';
}

export function effectsFor(variant: Variant): EffectSpec[] {
  return [
    {
      piece: hue(variant.sweep),
      target:
        variant.amount === undefined
          ? { kind: 'run', by: 'index' }
          : { kind: 'run', by: 'seed', amount: variant.amount },
      seed: 1,
    },
  ];
}

/**
 * `specOf` hands back the shipped look itself rather than a copy, so the base and its decoration
 * are both spread: editing either in place would carry one cell's override into every other.
 */
export function lookFor(variant: Variant): LookSpec {
  const base = specOf(BASE);
  const decoration = base.decoration;
  if (decoration?.kind !== 'tube') throw new Error(`tube gallery: ${BASE} has no tube decoration`);
  const tube: TubeSpec = { ...decoration, ...variant.tube };
  if (!sweepIsVisible(tube)) {
    throw new Error(`tube gallery: ${variant.id} hides its own sweep behind a replace gradient`);
  }
  return { ...base, decoration: tube, effects: effectsFor(variant) };
}

/**
 * No cell passes a material override: that clears `readsRunColor`, and the tube builder's color
 * write returns early on it, so the cell would sit at its built color and look merely broken.
 */
export const VARIANTS: Variant[] = [
  // How the sweep moves.
  { id: 'whole-wheel', label: 'whole wheel, 6s' },
  { id: 'fast', label: 'whole wheel, 2s', sweep: { duration: 2000 } },
  { id: 'slow', label: 'whole wheel, 18s', sweep: { duration: 18000 } },
  { id: 'narrow', label: 'quarter turn', sweep: { span: 0.25 } },
  { id: 'warm-only', label: 'reds through yellows', sweep: { from: 0.95, span: 0.2 } },
  { id: 'cool-only', label: 'greens through blues', sweep: { from: 0.35, span: 0.3 } },

  // How far apart the runs sit on the wheel.
  { id: 'spread-none', label: 'one color at a time', sweep: { spread: 0 } },
  { id: 'spread-quarter', label: 'quarter turn across the run', sweep: { spread: 0.25 } },
  { id: 'spread-full', label: 'a whole wheel across the run', sweep: { spread: 1 } },
  { id: 'spread-double', label: 'two wheels across the run', sweep: { spread: 2 } },

  // Where the luma sits. The bloom threshold sees this, so it decides what blooms.
  { id: 'luma-dim', label: 'luma 0.25', sweep: { luminance: 0.25 } },
  { id: 'luma-bright', label: 'luma 0.8', sweep: { luminance: 0.8 } },

  // How much of the sign cycles at all.
  { id: 'half-pool', label: 'half the runs cycle', amount: 0.5 },
  { id: 'quarter-pool', label: 'a quarter cycle', amount: 0.25 },

  // The tube itself.
  { id: 'thin', label: 'thin tube', tube: { radius: 0.014 } },
  { id: 'fat', label: 'fat tube', tube: { radius: 0.034 } },
  { id: 'many-runs', label: '14 runs', tube: { runs: 14 } },
  { id: 'few-runs', label: '3 runs', tube: { runs: 3 } },
  { id: 'unbroken', label: 'no blockout', tube: { blockout: 0 } },
  { id: 'gappy', label: 'wide spacing', tube: { spacing: 0.06 } },
  {
    id: 'sparse',
    label: 'a third of the glyph lit',
    tube: { select: { by: 'seed', amount: 0.35 } },
  },
  { id: 'connected', label: 'corners connect', tube: { corners: { break: 0.15, connect: 0.85 } } },
  { id: 'broken', label: 'corners break', tube: { corners: { break: 0.95, connect: 0.05 } } },
  { id: 'wavy', label: 'high amplitude', tube: { amplitude: 0.06 } },
];
