import { type Composition, DEFAULT_COMPOSITION } from './composition.js';

const KEY = 'klieg:composition-lab';

export function save(composition: Composition): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(composition));
  } catch {
    // A private window with storage blocked is not a reason to lose the lab.
  }
}

export function restore(): Composition {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_COMPOSITION;
    // Spread over the default so a composition saved before a field existed still loads.
    return { ...DEFAULT_COMPOSITION, ...(JSON.parse(raw) as Partial<Composition>) };
  } catch {
    return DEFAULT_COMPOSITION;
  }
}
