import type * as THREE from 'three';
import type { TubeStageId } from './stages.js';

/**
 * What the corner stage does to make a fillet meet its legs. `stretch` appears in both registries:
 * the name covers two unrelated implementations with different floors; splitting them keeps each
 * one separable and lets the lab show them apart.
 * @internal
 */
export type CutRepairId =
  | 'stretch'
  | 'setback'
  | 'resume'
  | 'fillet'
  | 'close'
  | 'return'
  | 'hairpin';

/** @internal */
export const CUT_REPAIR_IDS: readonly CutRepairId[] = [
  'stretch',
  'setback',
  'resume',
  'fillet',
  'close',
  'return',
  'hairpin',
];

/** Which end of the corner a pass is working, since every inner repair fires on both. @internal */
export type RepairSide = 'entry' | 'exit';

/**
 * Where a repair would act and what it would change there. Returned whether or not the repair is
 * switched on: a boolean cannot be ghosted, and showing a worse path without showing what was
 * skipped leaves the reader to infer the difference.
 * @internal
 */
export interface RepairSite {
  /** Index into the leg the repair acts on. */
  at: number;
  /** The geometry it would put there, empty where the repair only removes vertices. */
  points: readonly THREE.Vector3[];
  /**
   * The vertices it would take out, empty where the repair only adds. An anchor index alone is not
   * enough to ghost a removal — it draws a dot where a stretch of path was going to disappear.
   */
  removed: readonly THREE.Vector3[];
  /** Which end of the corner this site is on; absent where the repair has no side. */
  side?: RepairSide;
}

/**
 * Identity, label, order, and where the repair hangs in the pipeline — no `apply`. Each id fires
 * with a body no one signature spans (`setback` trims a span entering and yields an index leaving),
 * so the gate and the site live at each call site and this is what the lab enumerates.
 * @internal
 */
export interface RepairEntry {
  id: CutRepairId;
  label: string;
  /** The stage this repair runs inside. Every one of them is `cut`; the field is what a diagram
   * reads, and the day a repair hangs off another stage nothing has to be rewritten to say so. */
  stage: TubeStageId;
  /** `corner` inside `mergeArc`, `span` at the `stitchPath` level, `decision` where a strategy is
   * chosen before either runs. */
  level: 'corner' | 'span' | 'decision';
}

/** @internal */
export type CornerRepair = RepairEntry;
/** @internal */
export type SpanRepair = RepairEntry;

/**
 * Runs inside `mergeArc`, twice per corner — once per side, with the `fillet` splice fixed between
 * the two passes. Order is the order the sides are worked, not the order of the ids.
 * @internal
 */
export const CORNER_REPAIRS: readonly RepairEntry[] = [
  { id: 'stretch', label: 'stretch', stage: 'cut', level: 'corner' },
  { id: 'setback', label: 'setback', stage: 'cut', level: 'corner' },
  { id: 'resume', label: 'resume', stage: 'cut', level: 'corner' },
];

/**
 * Runs at the `stitchPath` level, where the accumulator is a list of spans rather than one span:
 * `return` turns one span into three and `close` acts on two at once, so neither fits the inner
 * pass. `stretch` here is the break path's `dropHead`/`dropTail`, which floors at 2 — the inner
 * `stretch` is a `pop()` loop that can empty the span.
 * @internal
 */
export const SPAN_REPAIRS: readonly RepairEntry[] = [
  { id: 'stretch', label: 'stretch (break)', stage: 'cut', level: 'span' },
  { id: 'close', label: 'close the loop', stage: 'cut', level: 'span' },
  { id: 'return', label: 'return', stage: 'cut', level: 'span' },
];

/**
 * Gated where the corner's strategy is picked, ahead of both other registries: switching either off
 * does not skip a step, it changes which step runs at all.
 * @internal
 */
export const DECISION_REPAIRS: readonly RepairEntry[] = [
  { id: 'fillet', label: 'fillet', stage: 'cut', level: 'decision' },
  { id: 'hairpin', label: 'hairpin', stage: 'cut', level: 'decision' },
];

/**
 * The corner side's stretch: drops the corner's whole group before the setback trims by distance.
 * No floor — it can empty the span.
 * @internal
 */
export function popStretch(span: THREE.Vector3[], count: number): void {
  for (let i = 0; i < count && span.length > 0; i++) span.pop();
}

/**
 * The break side's stretch. Floors at two vertices, because a break's product is a span that still
 * has to sweep — unlike the corner side, where an emptied `target` is refilled by the arc.
 * @internal
 */
export function trimStretch(
  span: THREE.Vector3[],
  count: number,
  end: 'head' | 'tail',
): THREE.Vector3[] {
  const keep = Math.max(2, span.length - count);
  return end === 'tail' ? span.slice(0, keep) : span.slice(span.length - keep);
}
