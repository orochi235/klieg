import { LIGHTING_NAMES, type LightingName, LOOK_NAMES, type LookName } from 'klieg';

/**
 * What a `show` URL carries, as base64 JSON in the hash (or `?c=`). Every field is optional on the
 * way in; a missing, malformed or out-of-range one falls back to its default rather than failing
 * the page, because these URLs get pasted around and hand-edited.
 */
export interface ShowConfig {
  /** The word on screen. */
  text: string;
  /** Looks to cycle through, in order. */
  looks: LookName[];
  /** Milliseconds a look holds before the next; the enter and exit add ~1.5s on top. 0 never advances. */
  cycleMs: number;
  /**
   * `sweep` rakes a highlight across the type, which leaves it dim between passes; `pointer`
   * aims it wherever the cursor or finger is, and lights exactly like `static` until one arrives.
   */
  lighting: LightingName;
  /** Undefined lets each look decide, which is what the default does. */
  bloom?: boolean;
  /** Whether dragging turns the type. */
  pivot: boolean;
  /** Recolors the type, as `0xff2d6f`. */
  tint?: number;
}

/** A hostile URL should not be able to ask for thousands of glyph meshes. */
const MAX_TEXT = 120;
const MIN_CYCLE_MS = 800;
const MAX_CYCLE_MS = 60_000;
const DEFAULT_CYCLE_MS = 3000;

export function encodeConfig(config: Partial<ShowConfig>): string {
  return btoa(encodeURIComponent(JSON.stringify(config)));
}

/** Never throws: anything unreadable resolves to the defaults. */
export function decodeConfig(raw: string | null | undefined): ShowConfig {
  return resolveConfig(parse(raw));
}

function parse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    // URLSearchParams turns base64's '+' into a space, so a `?c=` value arrives corrupted
    // without this and decodes to garbage.
    return JSON.parse(decodeURIComponent(atob(raw.replaceAll(' ', '+'))));
  } catch {
    console.warn('show: ignoring an unreadable config');
    return null;
  }
}

export function resolveConfig(input: unknown): ShowConfig {
  const raw: Record<string, unknown> =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const looks = pickLooks(raw.looks);

  return {
    text: pickText(raw.text),
    looks: looks.length ? looks : [...DEFAULT_LOOKS],
    cycleMs: pickCycle(raw.cycleMs),
    lighting: LIGHTING_NAMES.includes(raw.lighting as LightingName)
      ? (raw.lighting as LightingName)
      : 'static',
    bloom: typeof raw.bloom === 'boolean' ? raw.bloom : undefined,
    pivot: raw.pivot !== false,
    tint: pickTint(raw.tint),
  };
}

function pickText(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return 'klieg';
  return value.slice(0, MAX_TEXT);
}

/** `tubing` supersedes `neon` as klieg's neon: a swept glass tube rather than a flat pink glow. */
export const DEFAULT_LOOKS: readonly LookName[] = LOOK_NAMES.filter((name) => name !== 'neon');

function pickLooks(value: unknown): LookName[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<LookName>();
  for (const name of value) {
    if (LOOK_NAMES.includes(name as LookName)) seen.add(name as LookName);
  }
  return [...seen];
}

function pickCycle(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CYCLE_MS;
  if (value <= 0) return 0;
  return Math.min(MAX_CYCLE_MS, Math.max(MIN_CYCLE_MS, Math.round(value)));
}

function pickTint(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  return value >= 0 && value <= 0xffffff ? value : undefined;
}
