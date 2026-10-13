import type { ActiveSlot, EnterSlot, ExitSlot } from './api.js';
import type { EffectSpec } from './effects/types.js';
import type { Slot } from './motion/compositor.js';
import { type Layered, layersOf, type MotionPatch } from './motion/types.js';
import { type Look, specOf } from './render/looks.js';

/** The look a fire, a warm or a backdrop draws when nobody names one. */
export const DEFAULT_LOOK: Look = 'gold';

/**
 * Names index the built-in record; anything else is already a patch the caller supplied. Names
 * inside a layered slot are resolved too — leaving a bare string in the array puts it where a
 * patch is expected, and reading `.duration` off it yields NaN rather than throwing.
 */
export function resolveSlot<N extends string>(
  slot: N | MotionPatch | Layered<N | MotionPatch>,
  builtin: Record<N, MotionPatch>,
): Slot {
  if (typeof slot === 'string') return builtin[slot];
  if (!Array.isArray(slot)) return slot as MotionPatch;
  return layersOf<N | MotionPatch>(slot).map((s) => (typeof s === 'string' ? builtin[s] : s));
}

/** Names a slot for a diagnostic; a caller's own patch has no name to give. */
export function describeSlot(slot: EnterSlot | ActiveSlot | ExitSlot): string {
  if (typeof slot === 'string') return slot;
  if (Array.isArray(slot)) return layersOf(slot).map(describeSlot).join(' + ');
  return 'a custom patch';
}

/** `look` with its effects swapped for `effects` when given. A caller's list replaces the look's own
 * rather than adding to it. */
export function withEffects(look: Look, effects: EffectSpec[] | undefined): Look {
  return effects ? { ...specOf(look), effects } : look;
}
