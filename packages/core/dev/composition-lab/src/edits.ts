import { type LayerEntry, newEntry } from './config.js';
import type { PatchKind } from './patches.js';
import { type Part, WRAPPERS, type Wrapper, wrappersOf } from './pipeline.js';

/** Every edit the diagram makes to the layer list. Each returns a new list, or the same one when it
 * changes nothing, so a no-op edit writes no undo step. */

export function addLayer(entries: LayerEntry[], kind: PatchKind): LayerEntry[] {
  return [...entries, newEntry(kind)];
}

export function removeLayer(entries: LayerEntry[], id: string): LayerEntry[] {
  return entries.filter((e) => e.id !== id);
}

function edit(
  entries: LayerEntry[],
  id: string,
  change: (e: LayerEntry) => LayerEntry,
): LayerEntry[] {
  let changed = false;
  const next = entries.map((e) => {
    if (e.id !== id) return e;
    const after = change(e);
    if (after !== e) changed = true;
    return after;
  });
  return changed ? next : entries;
}

export function setEnabled(entries: LayerEntry[], id: string, on: boolean): LayerEntry[] {
  return edit(entries, id, (e) => (e.enabled === on ? e : { ...e, enabled: on }));
}

const allowed = (entry: LayerEntry, wrapper: Wrapper) =>
  !(wrapper === 'roving' && entry.kind === 'lamp');

function switchWrapper(entries: LayerEntry[], id: string, wrapper: Wrapper, on: boolean) {
  return edit(entries, id, (e) => {
    if (!allowed(e, wrapper) || wrappersOf(e).includes(wrapper) === on) return e;
    return { ...e, [wrapper]: { ...(e[wrapper] as object), on } };
  });
}

/** Switches the wrapper on, keeping whatever settings it had while off. */
export function insertWrapper(entries: LayerEntry[], id: string, wrapper: Wrapper): LayerEntry[] {
  return switchWrapper(entries, id, wrapper, true);
}

export function removeWrapper(entries: LayerEntry[], id: string, wrapper: Wrapper): LayerEntry[] {
  return switchWrapper(entries, id, wrapper, false);
}

/** The layers in `ids`' order, then any `ids` leaves out, in the order they had. */
export function reorder(entries: LayerEntry[], ids: readonly string[]): LayerEntry[] {
  const named = ids.flatMap((id) => entries.filter((e) => e.id === id));
  return [...named, ...entries.filter((e) => !ids.includes(e.id))];
}

const SLOT: Record<string, number> = { patch: 0, roving: 1, intermittent: 2, pool: 3 };
const slotOf = (part: Part) => SLOT[part.kind === 'wrapper' ? part.wrapper : part.kind] ?? -1;

/** The wrappers the + between `from` and `to` of a layer's row may insert. */
export function insertable(entry: LayerEntry, from: Part, to: Part): Wrapper[] {
  const lo = slotOf(from);
  const hi = slotOf(to);
  const has = wrappersOf(entry);
  return WRAPPERS.filter((w) => {
    const at = SLOT[w] as number;
    return lo < at && at < hi && allowed(entry, w) && !has.includes(w);
  });
}

/** An edit of a layer's fields, which never changes which layer it is or whether it is on. */
export function updateEntry(entries: LayerEntry[], id: string, next: LayerEntry): LayerEntry[] {
  return edit(entries, id, (e) => ({ ...next, id: e.id, enabled: e.enabled }));
}
