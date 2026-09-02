import { buildLayer, type Composition, type EffectLayer } from './composition.js';

/**
 * Past this a lane's passes are closer together than a reader can separate, so it draws as one
 * band and reports the count instead. Blocks that thin are ink, not information.
 */
export const MAX_BLOCKS = 120;

export interface Block {
  /** Left edge as a fraction of the span. */
  at: number;
  width: number;
}

export interface Lane {
  id: string;
  /** The piece and the wrappers over it, outermost last. */
  label: string;
  /** One pass of the layer's piece, wrappers included, in milliseconds. */
  passMs: number;
  /** Passes the span holds, fractional. Below 1 the pass outruns the fire. */
  passes: number;
  /** Empty where `passes` exceeds `MAX_BLOCKS`. */
  blocks: Block[];
  /** How much of one pass plays inside the span. 1 where the pass fits. */
  shareOfPass: number;
  overruns: boolean;
}

export interface Timeline {
  /** What the transport runs: the hold and the tail past it. */
  spanMs: number;
  /** Where `hold` falls, as a fraction of the span. */
  holdAt: number;
  lanes: Lane[];
}

function labelOf(layer: EffectLayer): string {
  const wraps = [layer.roving ? 'roving' : null, layer.intermittent ? 'intermittent' : null];
  return [layer.kind, ...wraps.filter((w): w is string => w !== null)].join(' · ');
}

function blocksOf(passes: number, width: number): Block[] {
  if (passes > MAX_BLOCKS) return [];
  const blocks: Block[] = [];
  for (let at = 0; at < 1 - 1e-9; at += width) {
    blocks.push({ at, width: Math.min(width, 1 - at) });
  }
  return blocks;
}

/**
 * The fire's own clock with a lane per enabled layer on it. Every other panel describes one pass
 * of a piece; this describes how much of that pass the fire is long enough to play.
 */
export function timelineOf(c: Composition, tailMs: number): Timeline {
  const spanMs = Math.max(1, c.hold + tailMs);
  const lanes: Lane[] = [];

  for (const layer of c.effects) {
    if (!layer.enabled) continue;
    const built = buildLayer(layer);
    // A draft that has not compiled contributes no piece to the fire either.
    if (!built || !(built.piece.duration > 0)) continue;

    const passMs = built.piece.duration;
    const passes = spanMs / passMs;
    lanes.push({
      id: layer.id,
      label: labelOf(layer),
      passMs,
      passes,
      blocks: blocksOf(passes, Math.min(1, passMs / spanMs)),
      shareOfPass: Math.min(1, passes),
      overruns: passMs > spanMs,
    });
  }

  return { spanMs, holdAt: Math.min(1, c.hold / spanMs), lanes };
}
