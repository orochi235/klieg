import { intermittent } from '@core/effects/intermittent.js';
import { roving } from '@core/effects/roving.js';
import type { EffectPiece, EffectSpec, PartKind } from '@core/effects/types.js';
import type { ActiveName, EnterName, ExitName } from '@core/motion/types.js';
import type { LookName } from '@core/render/looks.js';
import { buildPiece, type LampSourceKind, type PieceKind } from './pieces.js';

export interface RovingWrap {
  dwell: number;
  seed: number;
  epochs: number;
}

export interface IntermittentWrap {
  spell: number;
  calm: number;
  bouts: number;
}

/** Which pool the panels describe. Lab-only: `toFireOptions` and `emit` both ignore it. */
export type PoolSource = 'real' | 'synthetic';

export interface EffectLayer {
  id: string;
  kind: PieceKind;
  enabled: boolean;
  params: Record<string, number>;
  target: PartKind;
  /** `SelectSpec.amount`: a share of the pool, so 1 is all of it. */
  amount: number;
  seed: number;
  stagger?: number;
  roving?: RovingWrap;
  intermittent?: IntermittentWrap;
  /** Set only when `kind` is `'lamp'`. */
  lampSource?: LampSourceKind;
  /** Source for a hand-authored piece; set only when `kind` is `'draft'`. */
  source?: string;
}

export interface Composition {
  text: string;
  look: LookName;
  hold: number;
  enter: EnterName;
  active: ActiveName;
  exit: ExitName;
  effects: EffectLayer[];
  pool: PoolSource;
}

export const DEFAULT_COMPOSITION: Composition = {
  text: 'ACRONYM',
  look: 'tubing',
  hold: 6000,
  enter: 'slam',
  active: 'none',
  exit: 'none',
  effects: [],
  pool: 'real',
};

/** `roving` substitutes a part's index and leaves its x/y alone, so a position-dependent piece
 * such as `lamp` would light the part it is standing on rather than the one holding the fault. */
export function carriesRoving(layer: EffectLayer): layer is EffectLayer & { roving: RovingWrap } {
  return layer.roving !== undefined && layer.kind !== 'lamp';
}

export interface BuiltLayer {
  /** What the frame gets, wrappers included. */
  piece: EffectPiece;
  /**
   * The innermost piece's own pass. This, not `piece.duration`, is what a sampler has to resolve:
   * `roving` at `epochs: 96` publishes a pass two hundred times longer than the piece inside it.
   */
  innerPass: number;
  /** The slot `roving` settled `dwell` on, for a layer that rovs. Null for one that does not. */
  epochMs: number | null;
}

/** A layer's piece and the two durations a panel needs to read it. Null when it will not build. */
export function buildLayer(layer: EffectLayer): BuiltLayer | null {
  const inner = buildPiece(layer.kind, layer.params, {
    source: layer.source,
    lampSource: layer.lampSource,
  });
  if (!inner) return null;

  const roved = carriesRoving(layer) ? roving(inner, layer.roving) : null;
  const piece = roved ?? inner;
  const epochMs = roved?.epoch ?? null;
  if (!layer.intermittent) return { piece, innerPass: inner.duration, epochMs };
  try {
    return { piece: intermittent(piece, layer.intermittent), innerPass: inner.duration, epochMs };
  } catch {
    return null;
  }
}

/** The piece a layer contributes, wrappers included. Null when it will not build. */
export function layerPiece(layer: EffectLayer): EffectPiece | null {
  return buildLayer(layer)?.piece ?? null;
}

/** A composition with no layer still needs a grid to plot the hold against. */
const NO_LAYERS_PASS = 1000;

/** The shortest pass any enabled layer's inner piece runs, which is what fixes the sample rate. */
export function finestPass(c: Composition): number {
  const passes = c.effects
    .filter((l) => l.enabled)
    .map((l) => buildLayer(l)?.innerPass)
    .filter((d): d is number => typeof d === 'number' && d > 0);
  return passes.length === 0 ? NO_LAYERS_PASS : Math.min(...passes);
}

export interface FireArgs {
  look: LookName;
  hold: number;
  enter: EnterName;
  active: ActiveName;
  exit: ExitName;
  effects?: EffectSpec[];
}

/** The `FireOptions` this composition describes. Pure: no GL, no DOM, no clock. */
export function toFireOptions(c: Composition): FireArgs {
  const effects: EffectSpec[] = [];
  for (const layer of c.effects) {
    if (!layer.enabled) continue;
    const piece = layerPiece(layer);
    if (!piece) continue;
    effects.push({
      piece,
      target: { kind: layer.target, by: 'index', amount: layer.amount },
      seed: layer.seed,
      ...(layer.stagger === undefined ? {} : { stagger: layer.stagger }),
    });
  }
  return {
    look: c.look,
    hold: c.hold,
    enter: c.enter,
    active: c.active,
    exit: c.exit,
    // Undefined rather than an empty list: `effects` replaces the look's own rather than adding to
    // it, so an empty array silently strips whatever the look declared.
    ...(effects.length > 0 ? { effects } : {}),
  };
}
