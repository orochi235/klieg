import type { TubeSpec } from '@core/render/tube/index.js';
import type { TrialLayout } from '@weasel-js/labkit';
import { useCallback, useEffect, useState } from 'react';
import { type View, validViews } from './PanelTile.js';
import {
  DEFAULT_LETTERS,
  type PanelMode,
  type PanelRecord,
  reconcileLetters,
  seedPanels,
} from './panels.js';
import {
  dropLegacy,
  type Saved,
  useStored,
  validLayout,
  validLetters,
  validLook,
  validPanels,
  validSpec,
} from './persist.js';
import { type TubeLook, tubeSpecOf } from './spec.js';

let nextPanel = 0;

/**
 * A fresh id, never recycled: a view is held against it, and a new panel inheriting a dead one's
 * turn and zoom is indistinguishable from a bug in the pose.
 */
export function mintPanelId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let id = `n${nextPanel++}`;
  while (used.has(id)) id = `n${nextPanel++}`;
  return id;
}

function seed(letters: string, taken: string[] = []): PanelRecord[] {
  return seedPanels(letters).map((meta) => {
    const id = mintPanelId(taken);
    taken.push(id);
    return { id, ...meta };
  });
}

const isBoolean = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** Everything the lab keeps across a reload, each piece its own persisted value. */
export function useLabState(legacy: Saved | null) {
  const [letters, setLetters] = useStored(
    'letters',
    () => validLetters(legacy?.letters) ?? DEFAULT_LETTERS,
    validLetters,
  );
  const [panels, setPanels] = useStored(
    'panels',
    () => validPanels(legacy?.panels) ?? seed(validLetters(legacy?.letters) ?? DEFAULT_LETTERS),
    validPanels,
  );
  const [layout, setLayout] = useStored<TrialLayout>(
    'layout',
    () => validLayout(legacy?.layout) ?? {},
    validLayout,
  );
  const [lookName, setLookName] = useStored<TubeLook>(
    'look',
    () => validLook(legacy?.look) ?? 'tubing',
    validLook,
  );
  const [spec, setSpec] = useStored<TubeSpec>(
    'spec',
    () => validSpec(legacy?.spec) ?? tubeSpecOf(validLook(legacy?.look) ?? 'tubing'),
    validSpec,
  );
  const [bloom, setBloom] = useStored('bloom', () => true, isBoolean);
  const [views, setViews] = useStored<Record<string, View>>('views', () => ({}), validViews);
  /** Bumped when every panel's pose changes at once, which no single panel reports. */
  const [epoch, setEpoch] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: carries a legacy save over once, at mount
  useEffect(() => {
    if (!legacy) return;
    setLetters(letters);
    setPanels(panels);
    setLayout(layout);
    setLookName(lookName);
    setSpec(spec);
    dropLegacy();
  }, []);

  // A dead panel's view would otherwise sit in storage forever: ids are never recycled.
  useEffect(() => {
    const live = new Set(panels.map((p) => p.id));
    if (Object.keys(views).every((id) => live.has(id))) return;
    setViews((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => live.has(id))));
  }, [panels, views, setViews]);

  /** Changing look reseeds the rail, so the controls keep reading as that look's own tuning. */
  const changeLook = useCallback(
    (next: TubeLook) => {
      setLookName(next);
      setSpec(tubeSpecOf(next));
    },
    [setLookName, setSpec],
  );

  const applyLetters = useCallback(
    (next: string) => {
      setLetters(next);
      setPanels((prev) => {
        const { add, remove } = reconcileLetters(prev, next);
        const dropped = new Set(remove);
        const kept = prev.filter((p) => !dropped.has(p.id));
        const taken = kept.map((p) => p.id);
        const added = add.map((meta) => {
          const id = mintPanelId(taken);
          taken.push(id);
          return { id, ...meta };
        });
        return [...kept, ...added];
      });
    },
    [setLetters, setPanels],
  );

  /** The rail's own add: one panel, outside the letters reconcile. */
  const addPanel = useCallback(
    (letter: string, mode: PanelMode) => {
      setPanels((prev) => [
        ...prev,
        { id: mintPanelId(prev.map((p) => p.id)), letter, mode, pose: 'head-on', source: 'depth' },
      ]);
    },
    [setPanels],
  );

  const reorder = useCallback(
    (next: readonly string[]) => {
      setPanels((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        const ordered = next.flatMap((id) => byId.get(id) ?? []);
        // A drop reports every id, but trust the panels rather than the report: anything the grid
        // did not name would otherwise vanish from the lab entirely.
        return ordered.length === prev.length ? ordered : prev;
      });
    },
    [setPanels],
  );

  const setView = useCallback(
    (id: string, view: View) => setViews((prev) => ({ ...prev, [id]: view })),
    [setViews],
  );

  /** Everything back to how a first visit opens. */
  const reset = useCallback(() => {
    setLetters(DEFAULT_LETTERS);
    setPanels((prev) =>
      seed(
        DEFAULT_LETTERS,
        prev.map((p) => p.id),
      ),
    );
    setLayout({});
    setLookName('tubing');
    setSpec(tubeSpecOf('tubing'));
    setBloom(true);
    setViews({});
    setEpoch((n) => n + 1);
  }, [setLetters, setPanels, setLayout, setLookName, setSpec, setBloom, setViews]);

  return {
    letters,
    panels,
    setPanels,
    layout,
    setLayout,
    lookName,
    spec,
    setSpec,
    bloom,
    setBloom,
    views,
    setView,
    epoch,
    changeLook,
    applyLetters,
    addPanel,
    reorder,
    reset,
  };
}

export type LabState = ReturnType<typeof useLabState>;
