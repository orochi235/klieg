import type { Setting as BlitsSetting, Signal as BlitsSignal } from '@msb235/blits';
import type { LetterInfo, StaggerSpec } from '../motion/types.js';
import type { Vec3 } from '../pose.js';
import type { SelectSpec } from '../select.js';

/**
 * What an effect can address. A part is the smallest thing below a letter. `chunk` is a letter's
 * whole scattered field, not one scatterer: the field is a single instanced draw sharing one
 * material, so it moves and lights together or not at all.
 */
export type PartKind = 'run' | 'body' | 'chunk';

/**
 * One addressable part, described the way `LetterInfo` describes a letter. The pool is word-wide,
 * so `index` and `count` span the whole sign rather than one letter.
 */
export interface PartInfo {
  kind: PartKind;
  /**
   * Which registered fill built this part, when one did. `kind` says what shape of thing a part
   * is and a fill says what it is made of, so a letter carrying several fills stays addressable
   * without a part kind per fill.
   */
  fill?: string;
  index: number;
  count: number;
  /** The letter this part belongs to, so a patch can order by letter as well as by part. */
  letter: LetterInfo;
  /** Layout position in em, relative to the block centre. This is the letter's origin, which on
   * a single line is the shared baseline -- `ink` is where the part is actually drawn. */
  x: number;
  y: number;
  /**
   * The part's drawn bounds in the same space as `x`/`y`, so a patch measuring distance has
   * something with height to measure to. Collapses to the origin for a part that draws nothing.
   * Resolves per letter: every run of a letter reports that letter's bounds.
   */
  ink: { minX: number; maxX: number; minY: number; maxY: number };
  /** The letter's place in the laid-out block, so `stagger`'s `grid` order has something to read. */
  line?: number;
  column?: number;
  lineCount?: number;
  columnCount?: number;
  /** Fraction of the pool's extent lying before this part, and this part's share of it. */
  at: number;
  span: number;
}

/** A relative contribution. Omitted fields mean "no contribution", as `PoseDelta` does. */
export interface PartDelta {
  /** Multiplies the part's emissive. */
  gain?: number;
  color?: number;
  /** 0..1 toward a tube decoration's `dark` material. Composited but not yet written: the swap
   * between the lit and dark materials a tube decoration already builds is its own step. */
  dark?: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  /** Shifts the colour ramp along the part. Needs a look with a `gradient`; without a
   * ramp there is nothing to shift. */
  crawl?: number;
  /** Light landing on the part, added from zero. Lamps sum. A multiplier cannot express this:
   * `emissive` defaults to black, so scaling it is a no-op on every look but `neon`. */
  light?: LightDelta;
}

/** One lamp's contribution to a part. */
export interface LightDelta {
  color: number;
  amount: number;
}

/** Everything a merge resolved. Multiplicative channels rest at 1, additive at 0. */
export interface PartPose {
  gain: number;
  color?: number;
  dark: number;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  crawl: number;
  /** Accumulated lamp colour, premultiplied by amount. sRGB-encoded 0..1 per channel, matching
   * the hex the authoring form takes — not linear radiance. */
  light: Vec3;
}

/** What klieg puts on `setting.host` for every patch, signal and light source it runs. */
export interface Host {
  /** -1..1 over the canvas box, +y down, or null until the pointer has been inside it. */
  pointer: { x: number; y: number } | null;
  /** The same pointer in the word's layout space — the em, block-relative space `PartInfo.x/y`
   * uses, +y up — projected through the camera onto the letters' front face, so on a front-on
   * sign it sits under the cursor. It ignores the word's `transform`, its pose and a moved `eye`,
   * and addresses the layout the word was built with, so after a `stages` regroup it points at
   * where the letters used to be. Null whenever `pointer` is, and before the word has a fit. */
  pointerInWord: { x: number; y: number } | null;
  /**
   * Milliseconds on the instance's clock when this frame was drawn. `setting.timestamp` is the
   * fire's own clock; this one is the same for the hero and its backdrop and every concurrent fire,
   * so it keys state shared across them, as `power`'s is.
   */
  now: number;
}

/**
 * What a patch, signal or light source reads for one frame: blits' setting, with klieg's fields on
 * `host`. `dt` is `Infinity` under reduced motion. Valid only during the call it is handed to.
 */
export type Setting = BlitsSetting<void, Host>;

/**
 * A host whose fields read through to whichever frame `read` returns, so a mix holding it by
 * reference sees each frame's values without the caller resolving a field no patch asks for.
 */
export function relay(read: () => Host): Host {
  return {
    get pointer() {
      return read().pointer;
    },
    get pointerInWord() {
      return read().pointerInWord;
    },
    get now() {
      return read().now;
    },
  };
}

/** A scalar, usually 0..1, resolved per part per frame: blits' signal over parts. */
export type Signal = BlitsSignal<PartInfo, Host>;

export interface EffectPatch {
  /** Milliseconds one pass lasts, and the patch loops. Zero does not hold a patch still — the pass
   * never advances, which pins a time-driven source such as `orbit` at its starting angle for good. */
  period: number;
  /** `phase` is 0..1 across one period. */
  at(phase: number, part: PartInfo, setting: Setting): PartDelta;
  /** Set by `hinge`: the patch as voices the mix weighs, which `at` reproduces for a caller asking
   * it directly. */
  readonly hinged?: Hinged;
}

/**
 * Hands back the patch it is given, typed. A slot that also takes a built-in name cannot type an
 * inline patch's `at` on its own: a name is a string, and a string's own `at` joins the union.
 */
export function effect(patch: EffectPatch): EffectPatch {
  return patch;
}

/** A patch weighed by a signal, or a set of stops crossfaded by one. */
export type Hinged =
  | { readonly by: Signal; readonly patch: EffectPatch }
  | { readonly by: Signal; readonly stops: readonly EffectPatch[] };

export type EffectName = 'flicker' | 'hue' | 'chase';

export interface EffectSpec {
  patch: EffectName | EffectPatch;
  /**
   * Which parts, out of the word's pool. Naming a `kind` selects every part of that shape,
   * whether or not a fill built it — so nothing already written narrows when one does.
   */
  target: ({ kind: PartKind } | { fill: string }) & SelectSpec;
  /** Per-part phase spread. */
  stagger?: number | StaggerSpec;
  /** Fixes the selection so a pinned frame is reproducible. */
  seed?: number;
}
