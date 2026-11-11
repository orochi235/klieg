import type { LabContextValue, LabOver } from '@weasel-js/labkit';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { labHistory } from './history.js';
import type { PanelMeta } from './panels.js';
import {
  dropLegacy,
  type Saved,
  useStored,
  validLetters,
  validLook,
  validPanels,
  validSpec,
} from './persist.js';
import {
  DEFAULT_SHARED,
  lettersIn,
  type Shared,
  sharedOf,
  validShared,
  writeShared,
} from './shared.js';
import { tubeSpecOf } from './spec.js';
import { reconcileTrials, reseedTrials } from './trials.js';

const isBoolean = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const validMetas = (value: unknown): PanelMeta[] | null => validPanels(value);

/** What the lab kept before the shared settings were one record: each piece under its own name. */
function useEarlier(legacy: Saved | null): Shared {
  const [spec] = useStored('spec', () => validSpec(legacy?.spec), validSpec);
  const [look] = useStored('look', () => validLook(legacy?.look), validLook);
  const [bloom] = useStored('bloom', () => null, isBoolean);
  const [letters] = useStored('letters', () => validLetters(legacy?.letters), validLetters);
  const name = look ?? 'tubing';
  return sharedOf(
    spec ?? tubeSpecOf(name),
    name,
    bloom ?? true,
    letters ?? lettersIn(DEFAULT_SHARED),
  );
}

/**
 * The shared settings, their writer, and the trial operations they drive. `lab` is the lab's context once it has
 * mounted: a letters change opens and closes trials through it, on Undo and Redo as on the write itself.
 */
export function useShared(legacy: Saved | null) {
  const earlier = useEarlier(legacy);
  const [shared, setShared] = useStored<Shared>('shared', () => earlier, validShared);
  const [seeded, setSeeded] = useStored('seeded', () => false, isBoolean);
  const [panels] = useStored<PanelMeta[] | null>(
    'panels',
    () => validMetas(legacy?.panels),
    validMetas,
  );
  const lab = useRef<LabContextValue | null>(null);
  const current = useRef(shared);
  current.current = shared;

  useEffect(() => {
    if (legacy) dropLegacy();
  }, [legacy]);

  const apply = useCallback(
    (next: Shared) => {
      const was = current.current;
      current.current = next;
      setShared(next);
      const letters = lettersIn(next);
      if (lab.current && letters !== lettersIn(was)) reconcileTrials(lab.current, letters);
    },
    [setShared],
  );

  const set = useCallback(
    (path: string, value: unknown) => {
      const before = current.current;
      const after = writeShared(before, path, value);
      if (JSON.stringify(after) === JSON.stringify(before)) return;
      apply(after);
      labHistory.push(path, before, after, apply);
    },
    [apply],
  );

  const over = useMemo<LabOver>(() => ({ values: shared, set }), [shared, set]);

  /** Everything back to how a first visit opens. Undo puts the settings back, not the trials. */
  const reset = useCallback(() => {
    const before = current.current;
    current.current = DEFAULT_SHARED;
    setShared(DEFAULT_SHARED);
    if (lab.current) reseedTrials(lab.current, lettersIn(DEFAULT_SHARED));
    labHistory.push('reset', before, DEFAULT_SHARED, apply);
  }, [setShared, apply]);

  /** Called by the lab once it has loaded: a first visit replaces the lab's opening trial with the seeded set. */
  const attach = useCallback(
    (context: LabContextValue) => {
      const first = lab.current === null;
      lab.current = context;
      if (!first || seeded) return;
      reseedTrials(context, lettersIn(current.current), panels ?? undefined);
      setSeeded(true);
    },
    [seeded, panels, setSeeded],
  );

  return { over, reset, attach };
}
