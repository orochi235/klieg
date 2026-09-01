import { EffectFrame, planEffects } from '@core/effects/frame.js';
import type { FrameCtx, PartInfo } from '@core/effects/types.js';
import { type Composition, toFireOptions } from './composition.js';
import { type PassSamples, samplePass } from './sample.js';
import { tenureAndJump } from './tenure.js';

/** Below this a part reads as dropped rather than dimmed. Gain rests at 1. */
const DARK_GAIN = 0.5;

/**
 * Spread under this share of a column's own mean reads as flat, not a trend. Sits between the
 * design's null case (dwell moving dark share 19.9/19.9/20.3 — 2%) and the 10%+ a param that
 * does reach a column moves it.
 */
const FLAT = 0.05;

/** The sweep and the live panels must sample at one rate, or their numbers do not compare. */
export const PASS_SAMPLES = 600;

export interface SweepRow {
  value: number;
  /** Share of all part-sample cells sitting below `DARK_GAIN`. */
  darkShare: number;
  /** Longest stretch with no part dark, in milliseconds. */
  longestLitMs: number;
  /** Share of parts some layer ever moved. */
  coverage: number;
  meanTenureMs: number;
  meanJumpParts: number;
  meanLight: number;
}

export type SweepMetric = Exclude<keyof SweepRow, 'value'>;

const METRICS: SweepMetric[] = [
  'darkShare',
  'longestLitMs',
  'coverage',
  'meanTenureMs',
  'meanJumpParts',
  'meanLight',
];

export interface SweepResult {
  param: string;
  rows: SweepRow[];
  /** Metrics the sweep never moved. This is a finding, not a failure. */
  flat: SweepMetric[];
}

/**
 * Longest run of samples with no part dark, in milliseconds. A pass loops, so a lit run open at
 * the end and one open at the start are one stretch across the seam — the same join
 * `tenureAndJump` makes. A single run already spanning the whole pass needs no joining.
 */
export function longestLitMs(s: PassSamples, pass: number): number {
  const runs: number[] = [];
  let run = 0;
  let firstLit = false;
  let lastLit = false;
  for (let c = 0; c < s.samples; c++) {
    let anyDark = false;
    for (const row of s.gain) {
      if ((row[c] as number) < DARK_GAIN) {
        anyDark = true;
        break;
      }
    }
    if (c === 0) firstLit = !anyDark;
    if (c === s.samples - 1) lastLit = !anyDark;
    if (anyDark) {
      if (run > 0) runs.push(run);
      run = 0;
    } else {
      run += 1;
    }
  }
  if (run > 0) runs.push(run);

  if (runs.length > 1 && firstLit && lastLit) {
    const first = runs.shift() as number;
    const last = runs.pop() as number;
    runs.push(first + last);
  }

  const longest = runs.length === 0 ? 0 : Math.max(...runs);
  return (longest / s.samples) * pass;
}

function aggregate(
  value: number,
  s: PassSamples,
  parts: readonly PartInfo[],
  pass: number,
): SweepRow {
  let dark = 0;
  let light = 0;
  let cells = 0;
  for (const row of s.gain) {
    for (const g of row) {
      if (g < DARK_GAIN) dark += 1;
      cells += 1;
    }
  }
  for (const row of s.light) for (const v of row) light += v;

  const t = tenureAndJump(s, parts, pass);
  return {
    value,
    darkShare: cells === 0 ? 0 : dark / cells,
    longestLitMs: longestLitMs(s, pass),
    coverage: parts.length === 0 ? 0 : s.touched.filter(Boolean).length / parts.length,
    meanTenureMs: t.meanTenureMs,
    meanJumpParts: t.meanJumpParts,
    meanLight: cells === 0 ? 0 : light / cells,
  };
}

/**
 * Metrics the sweep never moved. Fewer than two rows report none: one row has nothing to be flat
 * against, and calling every metric flat off a single measurement is the false finding this
 * column exists to prevent.
 */
export function flatMetrics(rows: readonly SweepRow[]): SweepMetric[] {
  if (rows.length < 2) return [];
  return METRICS.filter((m) => {
    const values = rows.map((r) => r[m]);
    const spread = Math.max(...values) - Math.min(...values);
    const scale = Math.abs(values.reduce((a, b) => a + b, 0) / values.length);
    return spread <= Math.max(scale * FLAT, 1e-9);
  });
}

/**
 * Resamples the whole pass once per value of one param. Every row rebuilds the `EffectFrame` from
 * `toFireOptions`, so a sweep measures the composition the preview would render rather than a
 * shortcut through the piece alone.
 */
export function runSweep(
  composition: Composition,
  layerId: string,
  param: string,
  min: number,
  max: number,
  steps: number,
  parts: readonly PartInfo[],
  samples: number,
  ctx: FrameCtx,
): SweepResult {
  const rows: SweepRow[] = [];
  // `toFireOptions` drops a disabled layer, so sweeping one measures a composition it never
  // reaches: identical rows, every column flat, reported as a finding about the param.
  const target = composition.effects.find((l) => l.id === layerId);
  // `Number.isFinite` rather than `steps >= 1`: a NaN count walks past a `< 1` guard into an empty
  // row set, where every flatness test compares against NaN and reports nothing flat.
  if (!target?.enabled || !Number.isFinite(steps) || steps < 1) {
    return { param, rows, flat: [] };
  }

  for (let i = 0; i < steps; i++) {
    const value = steps === 1 ? min : min + ((max - min) * i) / (steps - 1);
    const at: Composition = {
      ...composition,
      effects: composition.effects.map((l) =>
        l.id === layerId ? { ...l, params: { ...l.params, [param]: value } } : l,
      ),
    };
    const specs = toFireOptions(at).effects ?? [];
    const pass = Math.max(1, ...specs.map((s) => (s.piece as { duration: number }).duration));
    const frame = new EffectFrame(planEffects(specs, parts));
    rows.push(aggregate(value, samplePass(frame, parts, pass, samples, ctx), parts, pass));
  }

  return { param, rows, flat: flatMetrics(rows) };
}
