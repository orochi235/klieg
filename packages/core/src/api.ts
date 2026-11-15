import type * as THREE from 'three';
import type { Clock } from './clock.js';
import type { Easing } from './easing.js';
import type { EffectSpec } from './effects/types.js';
import type { MarkEvent } from './motion/marks.js';
import type {
  ActiveName,
  EnterName,
  ExitName,
  Layered,
  LetterInfo,
  MotionPatch,
} from './motion/types.js';
import type { QueuePolicy } from './queue.js';
import type { LightingSlot } from './render/lighting.js';
import type { Look } from './render/looks.js';
import type { CameraSpec, Framing, Placement } from './render/stage.js';
import type { SelectableMode } from './text/dom-layer.js';
import type { FontSpec } from './text/font-registry.js';
import type { Align } from './text/layout.js';
import type { Arrangement } from './text/placement.js';
import type { TextRun } from './text/runs.js';
import type { Transform } from './transform.js';

export interface KliegOptions {
  target?: HTMLElement;
  /**
   * Fullscreen overlay, or the type anchored inside one element of the page. Fixed for the
   * instance's lifetime; a page wanting both needs two instances, and two WebGL contexts.
   * An element placement is its own parent, so it cannot be combined with `target`.
   */
  placement?: Placement;
  /**
   * The fonts this instance can set type in, addressed by name from `fire()`. A value may name a
   * face within a `.ttc` collection, which is how the fonts macOS ships — Helvetica, Times,
   * Courier, Menlo — are loadable at all.
   *
   * The first entry is the default; `defaultFont` overrides it. Key order is what JS fixes for
   * string keys, so reordering the literal is what changes which font a bare `fire()` uses.
   */
  fonts?: Record<string, FontSpec>;
  /** Which entry a `fire()` with no `font` uses. Defaults to the first. */
  defaultFont?: string;
  /** @deprecated Pass `fonts` instead: `fonts: { display: url }`. */
  fontUrl?: string;
  clock?: Clock;
  /**
   * `concurrent` is unsound for `sweep`: every live effect writes the shared environment
   * rotation from its own elapsed time, so the highlight sawtooths between their phases.
   */
  policy?: QueuePolicy;
  idleTimeoutMs?: number;
  /**
   * The look whose shader programs the warm links, on an idle callback after `createKlieg`. The
   * link is the driver's and lands per look, so warming `gold` buys a page that only fires `neon`
   * nothing. Defaults to `'gold'`.
   */
  warmLook?: Look;
  /** How much of the viewport the type may fill. The default leaves room for the page underneath. */
  framing?: Framing;
  /**
   * The lens: `{ projection: 'ortho' }` for parallel projection, or a `fov` in degrees for how
   * much perspective a word shows. Neither changes how large the type is drawn.
   */
  camera?: CameraSpec;
  /**
   * How far the canvas reaches past its anchor, as a share of the tallest the type may be — room
   * for a glow, a bevel highlight or a bloom halo to fall off in. Without it the canvas is the
   * anchor exactly, and everything a look paints outside the type's own box is cut at the edge the
   * type is aligned against, which on `align: 'start'` is the leading letter's own stem.
   *
   * The bleed never moves the type: the framing fractions and the aligned edge go on measuring the
   * anchor. Sized against the type rather than the box, and never below the blur's own reach, so a
   * small word in a large anchor does not pay for one. `0` pins the canvas back to the anchor.
   *
   * It costs a wider canvas: the extra reaches over whatever the anchor sits beside, and a page
   * that scrolls to its own right edge can gain a few pixels of overflow. An anchor under an
   * `overflow: hidden` ancestor clips it away, and wants the room as padding instead.
   */
  bleed?: number;
}

export type { CameraSpec, Framing, Placement } from './render/stage.js';
export type { Align } from './text/layout.js';
export type { TextRun } from './text/runs.js';

/** A built-in name, your own patch, or several layered together — names and patches may mix. */
export type EnterSlot = EnterName | MotionPatch | Layered<EnterName | MotionPatch>;
export type ActiveSlot = ActiveName | MotionPatch | Layered<ActiveName | MotionPatch>;
export type ExitSlot = ExitName | MotionPatch | Layered<ExitName | MotionPatch>;
export type { LightingSlot };

export interface FireOptions {
  enter?: EnterSlot;
  active?: ActiveSlot;
  exit?: ExitSlot;
  /** A built-in name, or a material of your own as plain numbers. */
  look?: Look;
  /**
   * Appearance driven over time, below the level of a letter. Replaces the look's own list rather
   * than adding to it — spread `specOf(look).effects` to keep them.
   */
  effects?: EffectSpec[];
  /** How the environment lights the type. `sweep` rakes the highlight, `static` holds it still.
   * Layers compose: `['sweep', track({ pitchRange: 0.1 })]`, each on its own period.
   *
   * A patch you construct carries its own state, so give each fire its own `track()` rather than
   * sharing one; the name `'pointer'` builds a fresh patch per run and is safe to reuse. */
  lighting?: LightingSlot;
  /**
   * Recolors the look, as `0xff2d6f`. A function is consulted per letter and may return
   * `undefined` for "not mine", leaving that letter the look's own colour.
   *
   * Routed to whichever property carries that look's hue — `gem` is clear stone whose red comes
   * from what light picks up passing through it, so tinting its base color would do nothing.
   */
  tint?: number | ((letter: LetterInfo) => number | undefined);
  /**
   * Turns the whole word as one rigid object — never the camera, which would drift
   * `viewportBudget`'s fit and shrink the word along with its angle. It turns and scales about the
   * middle of the ink's face, where the letters' poses hold it that frame, and moves in world units,
   * in which the frame is about 7.6 tall at that face.
   * Build one with `fromEuler`, `fromAxisAngle` or `compose` rather than writing the sixteen
   * numbers by hand.
   */
  transform?: Transform;
  /**
   * Milliseconds in the active segment, `'click'` to hold until the viewer dismisses it, or
   * `'forever'` to stay until `destroy()`. A held effect blocks the queue under the default
   * `queue` policy, and its promise stays pending until it leaves the screen.
   *
   * `'click'` has no meaning for an element placement and is refused there; `'forever'` is legal
   * everywhere.
   */
  hold?: number | 'click' | 'forever';
  bloom?: boolean;
  blendMs?: number;
  /** @deprecated Unread. Placement is fixed per instance — pass it to `createKlieg` instead. */
  placement?: Placement;
  /**
   * How the lines of a multi-line block range against each other, in reading order. Defaults to
   * `'start'`, which is what an acrostic wants: centred lines scatter its initials across as many
   * x positions as there are lines. Distinct from `framing.align`, which places the whole block
   * in the frame. A single-line word places identically either way.
   */
  lineAlign?: Align;
  /** A name from the instance's `fonts`. Defaults to `defaultFont`, else the first entry. */
  font?: string;
  /**
   * Extra advance after each glyph, in em. Negative tightens. A face with advances too tight for
   * display sizes — a pixel face especially — wants a little here.
   */
  tracking?: number;
  /** Break long lines to whatever arrangement renders largest. Explicit newlines always break. */
  wrap?: boolean;
  /** Let the overlay swallow the dismissing click instead of passing it through to the page. */
  modal?: boolean;
  /**
   * Who dismisses a `'click'` hold. `'host'` attaches no window listeners at all — neither
   * `pointerdown` nor `Escape` — so one press does one thing, and `advance()` on the handle is the
   * only way out. Per effect rather than per instance, so window-dismissed flourishes and
   * host-driven held slides can share one `Klieg`.
   */
  dismiss?: 'window' | 'host';
  /**
   * How the word appears in the DOM, so it can be copied, found and read aloud. `'hidden'` is one
   * visually-hidden node; `'layer'` adds a transparent per-letter layer a drag can select, and
   * takes a click on a letter instead of passing it through; `'none'` adds nothing, for a page
   * whose own markup already carries this text.
   *
   * `'layer'` needs the word still — it falls back to `'hidden'` under a `transform` or a motion
   * patch that moves the letters. Defaults to `'hidden'`.
   */
  selectable?: SelectableMode;
  /**
   * Stages played after the enter, each regrouping what survives it. Advanced by the viewer when
   * a stage holds on `'click'`. Ignored under reduced motion, which never travels.
   */
  stages?: Stage[];
  /**
   * Starts the effect already settled in one of its holds, as if it had played there and every
   * earlier hold had been released the moment it settled. Hold 0 is the opening word's; hold `k` is
   * `stages[k - 1]`'s, so a fire has one more hold than it has stages. The enter and every boundary
   * before that hold are skipped, and no mark is reported for them — `active` included — nor for
   * the boundary that hold sits in. From there it plays live: a `'click'` hold waits for its press.
   *
   * Throws for a hold the fire does not have. Under reduced motion, which plays no stages, the word
   * is the opening one whatever the hold.
   */
  startAt?: { hold: number };
  /**
   * Called as the effect crosses each mark. `active` is the instant the word has landed
   * and is at full presence — mid-blend, which is what a host swapping a page behind the flourish
   * wants. A listener that throws does not stop the render loop.
   */
  onMark?: (event: MarkEvent) => void;
  /**
   * The sign repeated in rows behind this one, tilted and dimmed and running effects of its own.
   * It shares this instance's caches, and adds nothing to the DOM — the hero already carries the
   * text a reader copies or hears.
   */
  backdrop?: BackdropSpec;
  /**
   * Aborts this one effect without touching the instance. Composed with the queue's own signal
   * rather than replacing it: an abort plays no exit, and the promise resolves rather than
   * rejecting, which is what it already promises for an effect the queue drops.
   */
  signal?: AbortSignal;
}

/**
 * The sign repeated in rows behind the fired word. Not tied to a look: any look and any effect can
 * be used this way, and `stagger: { from: 'line' }` is what makes an effect crawl across the rows.
 *
 * It never takes the motion slots. No enter, no active, no exit — it is placed once and runs only
 * its effects, so it is already at full presence when the hero arrives over it.
 */
export interface BackdropSpec {
  /** How many lines the sign is repeated on. Defaults to 1, which is an ordinary second sign. */
  rows?: number;
  /** What is repeated, in place of the hero's own text. */
  text?: string | TextRun[];
  /** Defaults to the hero's look — it is the same sign, standing further back. */
  look?: Look;
  /** Replaces the backdrop look's own effects, as `FireOptions.effects` does for the hero. */
  effects?: EffectSpec[];
  /** Turns the rows as one rigid object, so a tilt can run them off the corners of the frame. */
  transform?: Transform;
  /**
   * Multiple of the hero's fitted letter size. Above 1 the rows overfill the frame, which is what
   * keeps a tilt from exposing a corner. Defaults to 1.
   */
  scale?: number;
  /**
   * Scales the backdrop's frame-owned base — its opacity and its emissive — so the rows sit under
   * the hero. Not the effect layer: an effect still modulates from the dimmed base, so a chase
   * reads at full contrast against a dimmed row. Defaults to 1.
   */
  dim?: number;
}

/** Timing for the move into a new layout. `scale` addresses the viewport fit, not letter size. */
export interface TweenSpec {
  /** Milliseconds for the move. Defaults to 700. */
  duration?: number;
  /** Defaults to `easeOutCubic`. */
  ease?: Easing;
  /**
   * Fraction of a span a channel waits before starting. `position` is a fraction of the move;
   * `scale` is a fraction of the move or this stage's exit, whichever is longer, so the fit can
   * wait for an exit that outlasts the move.
   */
  delayBy?: { position?: number; scale?: number };
}

/** One regroup: some letters leave, the rest re-lay out and the effect carries on. */
export interface Stage {
  /** Letters that continue. The rest exit. Omitted keeps all of them. */
  keep?: (letter: LetterInfo) => boolean;
  /** How the letters that do not continue leave. */
  exit?: ExitSlot;
  /** Arrangement for the survivors' new layout. One line by default. */
  as?: Arrangement;
  active?: ActiveSlot;
  hold?: number | 'click';
  tween?: TweenSpec;
}

/**
 * What `fire()` hands back: the promise it has always been, plus control over this one effect.
 * A `Promise` rather than a bare thenable — callers already use `.catch()` on a fire.
 */
export interface FireHandle extends Promise<void> {
  /**
   * Treats this as the dismissing press. A no-op unless a hold is waiting for one; called before
   * the effect starts, it releases the first hold that effect reaches rather than being lost.
   */
  advance(): void;
  /**
   * Replaces the fire's `transform` while it runs — a lab's orbit, a slider, a drag. Called before
   * the effect starts, it is the transform the effect opens with. It shows on the next frame the
   * clock draws, so under a paused `ManualClock` the caller follows it with `advance(0)`. A turn
   * away from identity drops `selectable: 'layer'` to `'hidden'`, as a `transform` does at fire
   * time; the backdrop keeps its own.
   */
  turn(transform: Transform): void;
}

/**
 * Something drawn in klieg's own scene beside the type — sparks, smoke, anything a three.js object
 * can carry. Structural, so klieg depends on nothing that builds one.
 */
export interface SceneLayer {
  /** Joins the scene on `attach`, before the first `update`. */
  readonly object: THREE.Object3D;
  /** Advances the layer by `dt` seconds. Called once a frame for as long as it is attached. */
  update(dt: number): void;
  /** Whether it has anything left on screen. While any attached layer is live, frames keep coming. */
  readonly live: boolean;
}

/** A point on the drawn type in world units, and how large a CSS pixel is at its depth. */
export interface TypePoint {
  x: number;
  y: number;
  z: number;
  /** World units one CSS pixel spans at `z`, for sizing in pixels whatever is placed there. */
  unitsPerPx: number;
  /** The same point in the word's layout space, where effects measure distance — a `kick` lands
   * here. The fit and `transform` are undone; a letter's own motion is not. */
  inWord: { x: number; y: number };
}

export interface Klieg {
  readonly supported: boolean;
  /** Resolves when the effect leaves the screen, whether it played out or was cancelled. */
  fire(text: string | TextRun[], options?: FireOptions): FireHandle;
  /**
   * Links a look's shader programs now instead of waiting for the idle callback after
   * construction. For a host that already knows what it is about to fire — a page swap that has
   * decided — so the link is paid before the swap rather than inside it. Defaults to `warmLook`.
   *
   * Resolves once the linking draw has been issued, and never rejects: a warm that cannot run
   * leaves the fire paying exactly what it would have paid anyway.
   */
  warm(look?: Look): Promise<void>;
  /**
   * Fetches, parses and extrudes a face's glyphs for every distinct character of `chars`, so the
   * first fire that draws them pays for none of it. For a host that knows its corpus — a roster of
   * names is a couple of dozen characters, however many words it fires.
   *
   * Letters only. A tube look's blueprint keys on a per-letter seed as well as the character, so
   * there is nothing a corpus alone can warm; `warm()` covers the shader link beside it.
   *
   * Throws synchronously on a font name the instance does not hold, as `fire()` does — that is a
   * typo in the host's own code. Rejects if the face cannot be fetched or parsed, which is the
   * same failure the next fire would hit.
   */
  preheat(chars: string, font?: string): Promise<void>;
  /**
   * Adds a layer's object to the scene the type is drawn in, so it shares the type's camera, depth
   * buffer and, during a fire that asks for it, bloom. Returns a function that takes it out again;
   * disposing the layer stays the caller's job.
   *
   * While the layer is `live`, frames keep coming — between fires, and after the fire that set it
   * off has ended — and the WebGL context is held. Once it goes quiet with no fire running, one
   * frame clears it and the stage idles as usual. Between fires the scene is drawn without bloom,
   * which belongs to a fire. `update` runs every frame while attached, live or not, so a layer that
   * starts something on its own is drawn from the next frame; that costs a frame callback for as
   * long as it stays attached. A no-op where WebGL is unsupported and after `destroy()`.
   */
  attach(layer: SceneLayer): () => void;
  /**
   * The point on the fired word drawn under a client position, or null where there is none — off
   * the letters, outside the canvas, or with nothing on screen. Hit against the geometry as drawn,
   * so it follows a `transform`, the letters' pose and a moved `eye`. A backdrop is never answered.
   */
  pointOn(clientX: number, clientY: number): TypePoint | null;
  /**
   * Cancels everything in flight; the stage comes down once the running effect has settled. The
   * promise resolves once the stage is unmounted and the caches are released. Repeated calls,
   * including calls made while disposal is under way, return the same promise.
   */
  destroy(): Promise<void>;
}
