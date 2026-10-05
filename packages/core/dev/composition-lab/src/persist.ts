import { type Composition, DEFAULT_COMPOSITION, type EffectLayer } from './composition.js';

const KEY = 'klieg:composition-lab';

export function save(composition: Composition): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(composition));
  } catch {
    // A private window with storage blocked is not a reason to lose the lab.
  }
}

/** Layers saved before the effect option was renamed carry `duration`, which every factory now
 * ignores in favor of `period`. */
function renameDuration(layer: EffectLayer): EffectLayer {
  const { duration, ...rest } = layer.params;
  if (duration === undefined || rest.period !== undefined) return layer;
  return { ...layer, params: { ...rest, period: duration } };
}

export function restore(): Composition {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_COMPOSITION;
    // Spread over the default so a composition saved before a field existed still loads.
    const saved = { ...DEFAULT_COMPOSITION, ...(JSON.parse(raw) as Partial<Composition>) };
    return { ...saved, effects: saved.effects.map(renameDuration) };
  } catch {
    return DEFAULT_COMPOSITION;
  }
}
