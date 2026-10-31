import type { TubeSpec } from '@core/render/tube/index.js';
import { type TrialLayout, usePersistedState } from '@weasel-js/labkit';
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';
import { isPanelMode, isPose, isRampSource, type PanelRecord } from './panels.js';
import { isTubeLook, type TubeLook } from './spec.js';

/** What `<Persistence>` keeps the lab under. */
export const STORAGE_KEY = 'tube-lab';

/** The localStorage keys the lab wrote before `<Persistence>`: v2 whole, v1 with a layout v2 cannot read. */
const LEGACY_KEYS = ['tube-lab/v2', 'tube-lab/v1'] as const;

/** The lab's saved state, as each piece was last written; any piece may be missing or stale. */
export interface Saved {
  panels?: unknown;
  layout?: unknown;
  letters?: unknown;
  spec?: unknown;
  look?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validPanels(value: unknown): PanelRecord[] | null {
  if (!Array.isArray(value)) return null;
  const ok = value.every(
    (p) =>
      isRecord(p) &&
      typeof p.id === 'string' &&
      typeof p.letter === 'string' &&
      isPanelMode(p.mode) &&
      isPose(p.pose) &&
      isRampSource(p.source),
  );
  return ok ? (value as PanelRecord[]) : null;
}

/** Only the fields every reader of a spec dereferences; a stale spec missing one is dropped whole. */
export function validSpec(value: unknown): TubeSpec | null {
  if (!isRecord(value) || value.kind !== 'tube') return null;
  const ok =
    Array.isArray(value.surfaces) &&
    Array.isArray(value.colors) &&
    isRecord(value.select) &&
    isRecord(value.look) &&
    typeof value.radius === 'number';
  return ok ? (value as unknown as TubeSpec) : null;
}

export function validLayout(value: unknown): TrialLayout | null {
  return isRecord(value) ? (value as TrialLayout) : null;
}

export function validLook(value: unknown): TubeLook | null {
  return isTubeLook(value) ? value : null;
}

export function validLetters(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * `usePersistedState` for a value whose stored shape may be stale: a record `valid` rejects reads,
 * and is overwritten, as `initial`, so an old save loads or is discarded rather than crashing a reader.
 */
export function useStored<T>(
  name: string,
  initial: () => T,
  valid: (value: unknown) => T | null,
): [T, Dispatch<SetStateAction<T>>] {
  const [fallback] = useState(initial);
  const [stored, setStored] = usePersistedState<unknown>(name, fallback);
  const value = valid(stored) ?? fallback;
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setStored((prev: unknown) =>
        typeof next === 'function' ? (next as (p: T) => T)(valid(prev) ?? fallback) : next,
      ),
    [setStored, valid, fallback],
  );
  return [value, set];
}

/** What the lab last saved to localStorage before `<Persistence>`, carried over once. A v1 save's
 *  layout is a windease store snapshot nothing here reads, so only its tuning survives. */
export function readLegacy(): Saved | null {
  for (const key of LEGACY_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) continue;
      return key === 'tube-lab/v1' ? { ...parsed, panels: null, layout: null } : parsed;
    } catch {
      // An unreadable or blocked save is skipped, and dropped with the rest once the lab carries over.
    }
  }
  return null;
}

/** Removes the localStorage saves, once `<Persistence>` holds what they carried. */
export function dropLegacy(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // Blocked storage has nothing to drop.
  }
}
