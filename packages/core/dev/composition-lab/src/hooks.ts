import { EffectFrame, planEffects } from '@core/effects/frame.js';
import type { EffectPatch, Host, PartInfo } from '@core/effects/types.js';
import type { LoadedFont } from '@core/text/font.js';
import {
  type TrialStateHandle,
  useClockFrame,
  useTrialClock,
  useTrialState,
} from '@weasel-js/labkit';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildLayer, type Composition, finestPass, toFireOptions } from './composition.js';
import { type LabConfig, toComposition } from './config.js';
import { clearDraftFaults, type DraftFaults, draftFaults, draftKnown, loadDraft } from './draft.js';
import { realPool, syntheticPool } from './pool.js';
import { type PassSamples, passSamples, samplePass } from './sample.js';

/** What the lab's patches read on `setting.host`. There is no pointer surface: `pointerFrame`
 * needs a `PlacedWord` only the running fire has, and both lamp sources on offer ignore the
 * cursor. */
export const HOST: Host = { pointer: null, pointerInWord: null, now: 0 };

/** Resolved once before the lab mounts; null when it failed to load. */
let font: LoadedFont | null = null;

export function provideFont(loaded: LoadedFont | null): void {
  font = loaded;
}

export function fontLoaded(): boolean {
  return font !== null;
}

/** A small cache shared by every panel of every trial, so one composition is sampled once however
 * many panels read it. Keyed by value: each trial's config is its own object. */
function cached<T>(size: number): (key: string, make: () => T) => T {
  const held = new Map<string, T>();
  return (key, make) => {
    const hit = held.get(key);
    if (hit !== undefined) {
      held.delete(key);
      held.set(key, hit);
      return hit;
    }
    const made = make();
    held.set(key, made);
    if (held.size > size) held.delete(held.keys().next().value as string);
    return made;
  };
}

const synthetic = syntheticPool(24, 7);
const pools = cached<PartInfo[]>(8);

/** The real pool needs a font: the synthetic one stands in when it failed to load. */
export function partsFor(c: Composition): PartInfo[] {
  if (c.pool === 'synthetic' || !font) return synthetic;
  const loaded = font;
  return pools(`${c.text}\u0000${c.look}`, () => realPool(c.text, loaded, c.look));
}

export interface Sampled {
  parts: PartInfo[];
  pass: number;
  finest: number;
  count: number;
  data: PassSamples;
  faults: DraftFaults;
  /** The one epoch a measured tenure can be read against. Two roving layers have two, and a panel
   * would be naming one of them without saying which. */
  epochMs: number | null;
}

const samplings = cached<Sampled>(8);

/** Counts finished compiles. A draft's patch exists only once its source has compiled, which is
 * async, so whatever read the composition before then has to read it again. */
let compiled = 0;
const compileListeners = new Set<() => void>();

function onCompile(fn: () => void): () => void {
  compileListeners.add(fn);
  return () => compileListeners.delete(fn);
}

/** Compiles stored drafts nothing has compiled yet: a reloaded lab holds sources its pane, folded
 * away, never saw. */
function compileStored(c: Composition): void {
  for (const l of c.effects) {
    if (l.kind !== 'draft' || !l.source || draftKnown(l.source)) continue;
    void loadDraft(l.source).then(() => {
      compiled += 1;
      for (const fn of compileListeners) fn();
    });
  }
}

export function sampledFor(c: Composition): Sampled {
  const parts = partsFor(c);
  return samplings(
    `${compiled}\u0000${c.pool === 'synthetic' || !font}\u0000${JSON.stringify(c)}`,
    () => {
      const specs = toFireOptions(c).effects ?? [];
      const frame = new EffectFrame(planEffects(specs, parts));
      const pass = Math.max(1, ...specs.map((s) => (s.patch as EffectPatch).period));
      // The rate follows the finest patch, not the pass: `roving` at `epochs: 96` makes a 1400ms
      // flicker a 306s pass, where a fixed grid steps straight over whole drops.
      const finest = finestPass(c);
      const count = passSamples(pass, finest);
      // Cleared either side of the pass so the count belongs to this sampling rather than to
      // however many frames the preview has drawn since the last one.
      clearDraftFaults();
      const data = samplePass(frame, parts, pass, count, HOST);
      const epochs = c.effects
        .filter((l) => l.enabled)
        .map((l) => buildLayer(l)?.epochMs)
        .filter((n): n is number => typeof n === 'number');
      return {
        parts,
        pass,
        finest,
        count,
        data,
        faults: draftFaults(),
        epochMs: epochs.length === 1 ? (epochs[0] as number) : null,
      };
    },
  );
}

export interface Lab {
  config: LabConfig;
  setConfig: TrialStateHandle<unknown, LabConfig>['setConfig'];
  composition: Composition;
}

/** This trial's config, its setter, and the composition it describes. */
export function useLab(): Lab {
  const { config, setConfig } = useTrialState<unknown, LabConfig>();
  const version = useSyncExternalStore(onCompile, () => compiled);
  // `version` is a dependency so a compile yields a new object, which is what the memos below key on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const fresh = useMemo(() => toComposition(config), [config, version]);
  const composition = useStable(fresh, version);
  useEffect(() => compileStored(composition), [composition]);
  return { config, setConfig, composition };
}

/** The previous value while the new one is equal to it, so a fire is rebuilt only for a real edit
 * or a compile that changes what a draft builds. */
function useStable<T>(value: T, version: number): T {
  const held = useRef<{ key: string; value: T } | null>(null);
  const key = `${version}\u0000${JSON.stringify(value)}`;
  if (held.current?.key !== key) held.current = { key, value };
  return held.current.value;
}

export function useSampled(): Sampled {
  const { composition } = useLab();
  return useMemo(() => sampledFor(composition), [composition]);
}

/** Where this trial's playhead stands in the run, in ms, re-rendering as it moves. */
export function useRunTime(): number {
  const clock = useTrialClock();
  const [t, setT] = useState(() => (clock ? runTime(clock.elapsed, clock.duration) : 0));
  useClockFrame((elapsed) => setT(runTime(elapsed, clock?.duration ?? Number.POSITIVE_INFINITY)));
  return t;
}

/** The clock counts across passes; a looping run starts over at each one. */
function runTime(elapsed: number, duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? elapsed % duration : elapsed;
}

export interface Focus {
  /** Part indices the raster draws: the kinds some enabled layer targets, or every part. */
  rows: number[];
  kinds: string[];
  /** The focused row, clamped: a shorter row list can strand the stored one past its end. */
  row: number;
  /** Index into the pool of the focused part. */
  part: number;
  /** The real pool was asked for and the synthetic one is standing in. */
  fallback: boolean;
}

export function useFocus(): Focus {
  const { composition, config } = useLab();
  const { parts } = useSampled();
  return useMemo(() => {
    const targets = new Set(composition.effects.filter((l) => l.enabled).map((l) => l.target));
    const rows = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => targets.size === 0 || targets.has(part.kind))
      .map(({ index }) => index);
    const row = Math.min(config.part, Math.max(0, rows.length - 1));
    return {
      rows,
      kinds: [...targets],
      row,
      part: rows[row] ?? 0,
      fallback: composition.pool === 'real' && !font,
    };
  }, [composition, config.part, parts]);
}
