import type { EffectPiece } from '@core/effects/types.js';

export interface DraftResult {
  piece: EffectPiece | null;
  error: string | null;
}

/**
 * Compiles a hand-authored piece. The source is a function body returning `{ duration, at }`, run
 * through a blob URL so it is real JS with real closures rather than a `new Function` fragment.
 */
const cache = new Map<string, DraftResult>();

export function compileDraft(source: string): EffectPiece | null {
  return cache.get(source)?.piece ?? null;
}

export function draftError(source: string): string | null {
  return cache.get(source)?.error ?? null;
}

export function draftKnown(source: string): boolean {
  return cache.has(source);
}

/** Compiles and caches. Resolves to the same result `compileDraft` will then return. */
export async function loadDraft(source: string): Promise<DraftResult> {
  const hit = cache.get(source);
  if (hit) return hit;

  const url = URL.createObjectURL(
    new Blob([`export default () => {\n${source}\n};`], { type: 'text/javascript' }),
  );
  let result: DraftResult;
  try {
    const mod = (await import(/* @vite-ignore */ url)) as { default: () => unknown };
    const piece = mod.default() as EffectPiece;
    result =
      typeof piece?.at === 'function' && typeof piece?.duration === 'number'
        ? { piece, error: null }
        : { piece: null, error: 'must return { duration, at }' };
  } catch (err) {
    result = { piece: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    URL.revokeObjectURL(url);
  }
  cache.set(source, result);
  return result;
}
