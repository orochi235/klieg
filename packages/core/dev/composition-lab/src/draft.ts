import type { EffectPatch, PartDelta } from '@core/effects/types.js';

export interface DraftResult {
  patch: EffectPatch | null;
  error: string | null;
  /** Line in the pane the error sits on, where the engine named one. */
  line: number | null;
}

const REST: PartDelta = {};

export interface DraftFaults {
  /** Calls to a draft's `at` that threw since the last clear. */
  throws: number;
  /** The first message of them — the one nearest the cause. */
  message: string | null;
}

let faults: DraftFaults = { throws: 0, message: null };

/** Read before a sampled pass, so the count belongs to that pass rather than to the session. */
export function clearDraftFaults(): void {
  faults = { throws: 0, message: null };
}

export function draftFaults(): DraftFaults {
  return faults;
}

/**
 * Catches what a hand-authored `at` throws and rests for that call. A draft pane exists to run
 * code that does not work yet, and one throw reaches every part of the pool through `EffectFrame`:
 * unguarded, a draft that fails on its second part takes the frame with it.
 */
export function guarded(patch: EffectPatch): EffectPatch {
  return {
    period: patch.period,
    at(phase, part, setting) {
      try {
        return patch.at(phase, part, setting);
      } catch (err) {
        faults = {
          throws: faults.throws + 1,
          message: faults.message ?? (err instanceof Error ? err.message : String(err)),
        };
        return REST;
      }
    },
  };
}

/**
 * The pane line an engine's `blob:` position names. The source is wrapped in a factory before it
 * is compiled, so every reported line is one below the one the author is looking at.
 */
export function lineOfError(text: string): number | null {
  const at = /blob:[^\s)]*?:(\d+):\d+/.exec(text);
  if (!at) return null;
  return Math.max(1, Number(at[1]) - 1);
}

/**
 * Compiles a hand-authored patch. The source is a function body returning `{ period, at }`, run
 * through a blob URL so it is real JS with real closures rather than a `new Function` fragment.
 */
const cache = new Map<string, DraftResult>();

export function compileDraft(source: string): EffectPatch | null {
  return cache.get(source)?.patch ?? null;
}

export function draftError(source: string): string | null {
  return cache.get(source)?.error ?? null;
}

/** Where `draftError` sits in the pane, when the engine named a position. */
export function draftErrorLine(source: string): number | null {
  return cache.get(source)?.line ?? null;
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
    const patch = mod.default() as EffectPatch;
    result =
      typeof patch?.at === 'function' && typeof patch?.period === 'number'
        ? { patch: guarded(patch), error: null, line: null }
        : { patch: null, error: 'must return { period, at }', line: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const where = err instanceof Error ? `${err.stack ?? ''}\n${error}` : error;
    result = { patch: null, error, line: lineOfError(where) };
  } finally {
    URL.revokeObjectURL(url);
  }
  cache.set(source, result);
  return result;
}
