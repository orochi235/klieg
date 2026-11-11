import type { TubeSpec } from '@core/render/tube/index.js';
import { DEFAULT_LETTERS } from './panels.js';
import { specValues, withSpecValue } from './rail/values.js';
import { isTubeLook, type TubeLook, tubeSpecOf } from './spec.js';

/** The settings every panel shares, by path as the rail shows them: what `<Lab over>` holds. */
export type Shared = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueAt(record: unknown, path: string): unknown {
  let node = record;
  for (const step of path.split('.')) {
    if (!isRecord(node)) return undefined;
    node = node[step];
  }
  return node;
}

function leafPaths(record: Record<string, unknown>, at = ''): string[] {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = at === '' ? key : `${at}.${key}`;
    return isRecord(value) ? leafPaths(value, path) : [path];
  });
}

/** Every spec row's path, in the order `specValues` lists them, which is the order a row's write depends on the last. */
const SPEC_PATHS = leafPaths(specValues(tubeSpecOf('tubing')));

export function sharedOf(spec: TubeSpec, look: TubeLook, bloom: boolean, letters: string): Shared {
  return { ...specValues(spec), preset: look, bloom, letters };
}

export const DEFAULT_SHARED: Shared = sharedOf(
  tubeSpecOf('tubing'),
  'tubing',
  true,
  DEFAULT_LETTERS,
);

export function lookOf(shared: Shared): TubeLook {
  return isTubeLook(shared.preset) ? shared.preset : 'tubing';
}

export function lettersIn(shared: Shared): string {
  return typeof shared.letters === 'string' ? shared.letters : DEFAULT_LETTERS;
}

/**
 * The spec `shared` describes: its look's own spec with each row that reads differently written over it. A row that
 * reads the same is left alone, so a look's palette survives a run color row that shows only its first color.
 */
export function specOfShared(shared: Shared): TubeSpec {
  let spec = tubeSpecOf(lookOf(shared));
  for (const path of SPEC_PATHS) {
    const want = valueAt(shared, path);
    if (want === undefined || want === valueAt(specValues(spec), path)) continue;
    spec = withSpecValue(spec, path, want) ?? spec;
  }
  return spec;
}

/** `shared` with the rail's row at `path` set to `value`. A new look reseeds every spec row from that look. */
export function writeShared(shared: Shared, path: string, value: unknown): Shared {
  if (path === 'preset') {
    if (!isTubeLook(value)) return shared;
    return sharedOf(tubeSpecOf(value), value, shared.bloom !== false, lettersIn(shared));
  }
  if (path === 'bloom') return { ...shared, bloom: value === true };
  if (path === 'letters') return typeof value === 'string' ? { ...shared, letters: value } : shared;
  const next = withSpecValue(specOfShared(shared), path, value);
  return next ? { ...shared, ...specValues(next) } : shared;
}

/** The shared record as a trial reads it, through `ctx.over`; outside a lab, the defaults. */
export function sharedFrom(read: ((path: string) => unknown) | undefined): Shared {
  if (!read) return DEFAULT_SHARED;
  return Object.fromEntries(Object.keys(DEFAULT_SHARED).map((key) => [key, read(key)]));
}

/** Whether a write to `path` changes the spec, and so rebuilds every panel. */
export function isSpecPath(path: string): boolean {
  return SPEC_PATHS.includes(path);
}

/** A stored record, read through `specOfShared` so a row it lacks or holds stale takes its look's value. */
export function validShared(value: unknown): Shared | null {
  if (!isRecord(value) || !isTubeLook(value.preset)) return null;
  return sharedOf(specOfShared(value), value.preset, value.bloom !== false, lettersIn(value));
}
