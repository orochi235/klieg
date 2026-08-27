import {
  ACTIVE_NAMES,
  type ActiveName,
  type Align,
  ENTER_NAMES,
  type EnterName,
  EXIT_NAMES,
  type ExitName,
  LIGHTING_NAMES,
  type LightingName,
  LOOK_NAMES,
  type LookName,
} from 'klieg';

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

  /** The one look the link was composed against, distinct from the `looks` cycle list. */
  look?: LookName;
  enter?: EnterName;
  active?: ActiveName;
  exit?: ExitName;
  /** Degrees, not a matrix: a hand-edited URL should stay legible. */
  transform?: { yaw: number; pitch: number; roll: number };
  /** How the lines of a multi-line block range against each other. */
  lineAlign: Align;
  /** Present only for an acrostic; absent is an ordinary fire. */
  acronym?: AcronymShare;
  hold?: number | 'click';
  blendMs?: number;
  wrap: boolean;
  /** Whether the looks strip renders. A bare `/show/` keeps it; a link may not want it. */
  chrome: boolean;
}

export interface AcronymShare {
  /** The capitals' tint, as `0x2df0ff`. */
  caps?: number;
  read?: number | 'click';
  settle?: number;
  hold?: number | 'click';
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
  const look = pickName(raw.look, LOOK_NAMES);

  return {
    text: pickText(raw.text),
    looks: looks.length ? looks : look ? [look] : [...DEFAULT_LOOKS],
    cycleMs: pickCycle(raw.cycleMs),
    lighting: LIGHTING_NAMES.includes(raw.lighting as LightingName)
      ? (raw.lighting as LightingName)
      : 'static',
    bloom: typeof raw.bloom === 'boolean' ? raw.bloom : undefined,
    pivot: raw.pivot !== false,
    tint: pickTint(raw.tint),
    look,
    enter: pickName(raw.enter, ENTER_NAMES),
    active: pickName(raw.active, ACTIVE_NAMES),
    exit: pickName(raw.exit, EXIT_NAMES),
    transform: pickTransform(raw.transform),
    lineAlign: pickName(raw.lineAlign, ALIGNS) ?? 'center',
    acronym: pickAcronym(raw.acronym),
    hold: pickPause(raw.hold),
    blendMs: pickMs(raw.blendMs, MAX_BLEND_MS),
    wrap: raw.wrap !== false,
    chrome: raw.chrome !== false,
  };
}

const ALIGNS = ['start', 'center', 'end'] as const;
const MAX_DEGREES = 180;
const MAX_BLEND_MS = 10_000;
const MAX_PAUSE_MS = 60_000;

/** A name the kit exports, or nothing — never the caller's string. */
function pickName<T extends string>(value: unknown, names: readonly T[]): T | undefined {
  return names.includes(value as T) ? (value as T) : undefined;
}

function pickMs(value: unknown, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** A pause is a duration or a wait for a click; anything else is no instruction at all. */
function pickPause(value: unknown): number | 'click' | undefined {
  if (value === 'click') return 'click';
  return pickMs(value, MAX_PAUSE_MS);
}

function pickTransform(value: unknown): ShowConfig['transform'] {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const axis = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(MAX_DEGREES, Math.max(-MAX_DEGREES, v))
      : 0;
  const out = { yaw: axis(raw.yaw), pitch: axis(raw.pitch), roll: axis(raw.roll) };
  return out.yaw === 0 && out.pitch === 0 && out.roll === 0 ? undefined : out;
}

function pickAcronym(value: unknown): AcronymShare | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  return {
    caps: pickTint(raw.caps),
    read: pickPause(raw.read),
    settle: pickMs(raw.settle, MAX_PAUSE_MS),
    hold: pickPause(raw.hold),
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
