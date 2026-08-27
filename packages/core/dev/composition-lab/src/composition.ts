import { roving } from '@core/effects/roving.js';
import type { EffectPiece, EffectSpec, PartKind } from '@core/effects/types.js';
import type { ActiveName, EnterName, ExitName } from '@core/motion/types.js';
import type { LookName } from '@core/render/looks.js';
import { buildPiece, type PieceKind } from './pieces.js';

export interface RovingWrap {
  dwell: number;
  seed: number;
  epochs: number;
}

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
}

export const DEFAULT_COMPOSITION: Composition = {
  text: 'ACRONYM',
  look: 'tubing',
  hold: 6000,
  enter: 'slam',
  active: 'none',
  exit: 'none',
  effects: [],
};

/** The piece a layer contributes, wrapper included. Null when its source will not compile. */
export function layerPiece(layer: EffectLayer): EffectPiece | null {
  const inner = buildPiece(layer.kind, layer.params, layer.source);
  if (!inner) return null;
  return layer.roving ? roving(inner, layer.roving) : inner;
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
