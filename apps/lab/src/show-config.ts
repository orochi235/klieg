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
 * What a `show` URL carries: a query string holding only what differs from the defaults
 * `resolveConfig` applies, written with the short keys in `SHORT` — `t=JACKPOT&lk=tubing&ln=start`.
 * A shared link wraps that in base64url and rides in `?c=`, which hides the text and keeps the
 * whole link one detector-safe token; the bare form is for reading and hand-editing in the hash.
 * Every field is optional on the way in; a missing, malformed or out-of-range one falls back to
 * its default rather than failing the page.
 *
 * Both spellings decode, so a hand-editor can write `text=` or `t=`. Two query-string rules bite
 * one: a space rides as `+`, so a literal plus has to be written `%2B`. Links made before this
 * format are base64 JSON, and still read.
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

/**
 * The wire spelling of each field. Two letters throughout rather than one where it fits: a table
 * that is uniformly abbreviated is one a reader can check, where a mix of `t` and `lighting` is a
 * table they have to memorise. Decoding accepts the long name too.
 */
const SHORT: Record<string, string> = {
  text: 't',
  look: 'lk',
  looks: 'ls',
  enter: 'en',
  active: 'ac',
  exit: 'ex',
  lighting: 'lt',
  lines: 'ln',
  cycle: 'cy',
  hold: 'hd',
  blend: 'bd',
  bloom: 'bm',
  tint: 'ti',
  pivot: 'pv',
  wrap: 'wr',
  chrome: 'ch',
  yaw: 'y',
  pitch: 'p',
  roll: 'r',
  acronym: 'an',
  caps: 'cp',
  read: 'rd',
  settle: 'st',
  gather: 'gt',
};

/** Only what differs from the defaults: a link carrying every field is mostly its own defaults. */
export function encodeConfig(config: Partial<ShowConfig>, opaque = false): string {
  const base = resolveConfig({});
  const c = resolveConfig(config);
  const out = new URLSearchParams();
  const put = (key: string, value: string | number | undefined) => {
    if (value !== undefined) out.append(SHORT[key] ?? key, String(value));
  };

  if (c.text !== base.text) put('text', c.text);
  // Read off the input rather than off `c`: a lone `look` resolves to a cycle of one, and writing
  // that back out would name the same look twice.
  const looks = pickLooks((config as Partial<ShowConfig>)?.looks);
  if (looks.length && looks.join() !== DEFAULT_LOOKS.join()) for (const l of looks) put('looks', l);
  put('look', c.look);
  put('enter', c.enter);
  put('active', c.active);
  put('exit', c.exit);
  if (c.lighting !== base.lighting) put('lighting', c.lighting);
  if (c.lineAlign !== base.lineAlign) put('lines', c.lineAlign);
  if (c.cycleMs !== base.cycleMs) put('cycle', c.cycleMs);
  put('hold', c.hold);
  put('blend', c.blendMs);
  if (c.tint !== undefined) put('tint', hex(c.tint));
  if (c.bloom !== undefined) put('bloom', c.bloom ? 'on' : 'off');
  if (!c.pivot) put('pivot', 'off');
  if (!c.wrap) put('wrap', 'off');
  if (!c.chrome) put('chrome', 'off');
  if (c.transform) {
    for (const axis of ['yaw', 'pitch', 'roll'] as const) {
      if (c.transform[axis]) put(axis, c.transform[axis]);
    }
  }
  if (c.acronym) {
    // A flag of its own rather than inferring it from `caps`: the routine can run on defaults
    // alone, and an acrostic with nothing overridden would otherwise have no way to say so.
    put('acronym', 'on');
    if (c.acronym.caps !== undefined) put('caps', hex(c.acronym.caps));
    put('read', c.acronym.read);
    put('settle', c.acronym.settle);
    put('gather', c.acronym.hold);
  }
  return opaque ? toBase64Url(out.toString()) : out.toString();
}

const hex = (value: number): string => value.toString(16).padStart(6, '0');

/**
 * `URLSearchParams` percent-encodes everything outside ASCII, so what goes in here is always
 * Latin-1 and `btoa` can take it directly. Feed it anything else and `btoa` throws.
 */
function toBase64Url(query: string): string {
  return btoa(query).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(raw: string): string | null {
  try {
    return atob(raw.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return null;
  }
}

/** Never throws: anything unreadable resolves to the defaults. */
export function decodeConfig(raw: string | null | undefined): ShowConfig {
  return resolveConfig(parse(raw));
}

/** A bare query string, told apart from base64 by the '=' that `atob` would refuse. */
const isQuery = (raw: string): boolean => /^[a-z]{1,8}=/.test(raw);

function parse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  if (isQuery(raw)) return fromQuery(raw);
  const unwrapped = fromBase64Url(raw);
  if (unwrapped !== null && isQuery(unwrapped)) return fromQuery(unwrapped);
  return parseLegacy(raw);
}

/** The base64 JSON this format replaced. Null unless the whole chain reads back as an object. */
function parseLegacy(raw: string): Record<string, unknown> | null {
  try {
    // URLSearchParams turns base64's '+' into a space, so a `?c=` value arrives corrupted
    // without this and decodes to garbage.
    const parsed: unknown = JSON.parse(decodeURIComponent(atob(raw.replaceAll(' ', '+'))));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The query string, shaped into what `resolveConfig` validates. Nothing is range-checked here —
 * every value stays suspect until it has been through the same picks a legacy link goes through.
 */
function fromQuery(raw: string): Record<string, unknown> {
  const q = new URLSearchParams(raw);
  const get = (key: string) => q.get(SHORT[key] ?? key) ?? q.get(key);
  const text = (key: string) => get(key) ?? undefined;
  const num = (key: string) => {
    const value = get(key);
    return value === null || value.trim() === '' ? undefined : Number(value);
  };
  const pause = (key: string) => (get(key) === 'click' ? 'click' : num(key));
  const flag = (key: string) => {
    const value = get(key);
    return value === null ? undefined : !(value === 'off' || value === 'false' || value === '0');
  };
  const color = (key: string) => {
    const value = get(key);
    return value && /^[0-9a-f]{1,6}$/i.test(value) ? Number.parseInt(value, 16) : undefined;
  };

  const looks = [...q.getAll(SHORT.looks as string), ...q.getAll('looks')];
  const axes = { yaw: num('yaw'), pitch: num('pitch'), roll: num('roll') };
  const turned = Object.values(axes).some((v) => v !== undefined);

  return {
    text: text('text'),
    looks: looks.length ? looks : undefined,
    cycleMs: num('cycle'),
    lighting: text('lighting'),
    bloom: flag('bloom'),
    pivot: flag('pivot'),
    tint: color('tint'),
    look: text('look'),
    enter: text('enter'),
    active: text('active'),
    exit: text('exit'),
    transform: turned ? axes : undefined,
    lineAlign: text('lines'),
    acronym:
      get('acronym') !== null
        ? { caps: color('caps'), read: pause('read'), settle: num('settle'), hold: pause('gather') }
        : undefined,
    hold: pause('hold'),
    blendMs: num('blend'),
    wrap: flag('wrap'),
    chrome: flag('chrome'),
  };
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
