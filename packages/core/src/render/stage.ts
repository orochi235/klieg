import * as THREE from 'three';
import type { Align, Budget } from '../text/layout.js';
import { BLOOM_REACH_PX } from './bloom.js';
import { buildEnvironment } from './environment.js';
import { DEFAULTS } from './looks.js';

/** Where the canvas lives: over the whole viewport, or inside one element of the page. */
export type Placement =
  | { kind: 'fullscreen' }
  | {
      kind: 'element';
      el: HTMLElement;
      /**
       * Lets this anchor take `hold: 'click'`. The dismissal is a press anywhere in the window,
       * so set it only where that reads as dismissing the type — an anchor filling the viewport,
       * as a `/show/` page's does. On a strip sharing a page, every unrelated click ends the
       * effect, which is why an anchor does not take a click hold unless it says so.
       */
      clickAnywhere?: boolean;
    };

/**
 * The share of the anchor the type is allowed to fill on each axis, as a fraction of what the
 * camera sees at the word's depth. An omitted axis keeps its default; 1 runs the type to that edge.
 * Height stays the tighter of the two by default because turning the word swings it taller.
 * The fractions cap the type's size; `align` is what places it in the box.
 */
export interface Framing {
  /** Defaults to 0.62. */
  width?: number;
  /** Defaults to `DEFAULT_HEIGHT_FRAC`. */
  height?: number;
  /**
   * Where the word sits in the box, in reading order — `'start'` is the left edge of an `ltr` box
   * and the right edge of an `rtl` one. An element placement defaults to `'start'`, because the
   * page it sits in has a text edge and meeting it is usually the point of anchoring; an overlay
   * has no edge to meet and defaults to `'center'`. The word is placed at whatever size the
   * fractions above chose, so aligning never resizes it, and what meets the edge is the painted
   * silhouette — bevel included.
   */
  align?: Align;
}

/**
 * The lens the type is seen through. `fov` is how much perspective the word shows, not how large
 * it is: the frustum's height at the word is fixed, so narrowing the angle walks the camera back
 * and the word keeps its size. `ortho` is that taken to the limit — parallel projection, where a
 * letter at the end of a long word is drawn exactly as the one in the middle is, and `fov` has
 * nothing to say.
 */
export interface CameraSpec {
  projection?: 'perspective' | 'ortho';
  /** Vertical field of view in degrees. Perspective only; defaults to `BASE_FOV`. */
  fov?: number;
  /**
   * Where the viewer is, as a share of the window's own half-width and half-height: `{ x: 1 }`
   * puts the eye over the window's right edge. The word's plane stays the window, so the type
   * keeps its size and position there and everything in front of or behind it slides — which is
   * what makes a letter's extrusion turn toward a viewer who is not centred. Perspective only:
   * parallel projection has no viewpoint to move.
   */
  eye?: { x?: number; y?: number };
}

/** Past this the window is behind the eye, and the frustum turns inside out. */
const MAX_EYE = 2;

export interface StageOptions {
  /** Resolved at mount, not at construction, so a document-less environment can still get here. */
  target?: HTMLElement;
  /** Idle milliseconds before the WebGL context is torn down. Browsers cap contexts near 16. */
  idleTimeoutMs: number;
  /** Fixed for an instance's lifetime; the canvas CSS and the fit basis both hang off it. */
  placement?: Placement;
  /** Read for `framing.height`, which is what the bleed is a share of. */
  framing?: Framing;
  /** How far the canvas reaches past the anchor. See `KliegOptions.bleed`. */
  bleed?: number;
  /** The lens. Fixed for an instance's lifetime, as the placement is. */
  camera?: CameraSpec;
}

// Inline because a library ships no stylesheet, and host page CSS must not reach the overlay.
const FULLSCREEN_CSS =
  'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
// No z-index: a positioned ancestor with `z-index:auto` is not a stacking context, so the
// fullscreen value here would paint the canvas over page content outside the anchor.
// The size is written out rather than left to the insets: a canvas is a replaced element, so with
// `width: auto` it takes its drawing buffer as its intrinsic size and the right inset is dropped.
const anchoredCss = (bleed: number) =>
  `position:absolute;inset:${-bleed}px;width:calc(100% + ${2 * bleed}px);height:calc(100% + ${2 * bleed}px);pointer-events:none`;

export function canvasCss(placement: Placement, bleed = 0): string {
  return placement.kind === 'element' ? anchoredCss(bleed) : FULLSCREEN_CSS;
}

// One above the canvas: the layer must take a click on a letter, and the canvas must not shade it.
const FULLSCREEN_LAYER_CSS =
  'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483001';

export function layerCss(placement: Placement, bleed = 0): string {
  // The letters are placed in canvas pixels, so the layer has to be the canvas' box and not the
  // anchor's. No z-index, for the reason the canvas gives; appended after it, so paint order stacks.
  return placement.kind === 'element' ? anchoredCss(bleed) : FULLSCREEN_LAYER_CSS;
}

/** Only `static` is certainly broken; every other value is the host positioning it on purpose. */
export function needsContainingBlock(position: string): boolean {
  return position === 'static';
}

/**
 * The edge an alignment names, resolved against the reading direction: `start` is the left edge of
 * an `ltr` box and the right edge of an `rtl` one. `center` names no edge.
 */
export function edgeFor(align: Align, direction: string): 'left' | 'right' | undefined {
  if (align === 'center') return undefined;
  const ltr = direction !== 'rtl';
  return (align === 'start') === ltr ? 'left' : 'right';
}

/** Displays with no box of their own to position the canvas against. */
export function canHoldCanvas(display: string): boolean {
  return display !== 'contents' && display !== 'inline';
}

export function webglSupported(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    // The probe holds a context until GC otherwise, out of the ~16 the whole design budgets for.
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Capped: browsers hand back 3 and 4 on phones, and the framebuffer is quadratic in it. */
function pixelRatio(): number {
  return Math.min(globalThis.devicePixelRatio ?? 1, 2);
}

export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** The lens a fullscreen overlay has always used. */
export const BASE_FOV = 38;
export const BASE_Z = 11;
const BASE_FAR = 100;

/**
 * Horizontal half-angle the outer glyphs may be seen at. Past it an extruded glyph is viewed near
 * enough to edge-on that its side wall projects across its neighbour and the word reads as merged.
 * A fullscreen overlay never reaches it because `FIT_CAP` holds the word well inside the frustum;
 * an anchor lifts that cap, so the lens carries the bound instead.
 */
export const MAX_HALF_ANGLE_DEG = 35;

/** Frustum height at the word's depth, fixed so every framing fraction keeps its meaning. */
const FRUSTUM_HEIGHT = 2 * Math.tan((BASE_FOV * Math.PI) / 360) * BASE_Z;

/** `framing.height` when the caller names none. The bleed is a share of it too. */
export const DEFAULT_HEIGHT_FRAC = 0.3;

/**
 * How far the canvas reaches past its anchor by default, as a share of the tallest the type may
 * be. Half a word's height clears the tube a `tubing` look swells to outside the glyph box, which
 * is the widest any shipped look paints outside it.
 */
export const DEFAULT_BLEED = 0.5;

/**
 * A longer lens for a wider box: `z` grows until the frustum's horizontal edge falls within
 * `MAX_HALF_ANGLE_DEG`, and `fov` narrows to hold the frustum height at the word's depth. Narrow
 * boxes keep the base lens exactly, so a fullscreen overlay renders byte-identically.
 */
export function lensFor(aspect: number, fov = BASE_FOV): { fov: number; z: number } {
  // The distance this angle needs to span the fixed frustum height, so `fov` changes how much
  // perspective the word shows and never how large it is.
  const base = FRUSTUM_HEIGHT / (2 * Math.tan((fov * Math.PI) / 360));
  const halfWidth = (FRUSTUM_HEIGHT * aspect) / 2;
  const z = Math.max(base, halfWidth / Math.tan((MAX_HALF_ANGLE_DEG * Math.PI) / 180));
  if (z === base) return { fov, z };
  return { fov: (2 * Math.atan(FRUSTUM_HEIGHT / (2 * z)) * 180) / Math.PI, z };
}

/** The parallel lens: no angle, and the frustum is the same box at every depth. */
export function orthoLens(aspect: number): { height: number; width: number; z: number } {
  return { height: FRUSTUM_HEIGHT, width: FRUSTUM_HEIGHT * aspect, z: BASE_Z };
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** The canvas' aspect, held here because an orthographic camera has no field for it. */
  aspect = 1;
  canvas: HTMLCanvasElement | null = null;
  textLayer: HTMLElement | null = null;
  renderer: THREE.WebGLRenderer | null = null;
  environment: THREE.WebGLRenderTarget | null = null;

  /** CSS pixels the canvas reaches past the anchor on every side. Whole, so its box stays so. */
  private bleedPx = 0;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private detachResize: (() => void) | null = null;
  private detachObserver: (() => void) | null = null;
  private restorePosition: (() => void) | null = null;

  readonly placement: Placement;

  constructor(private readonly opts: StageOptions) {
    this.placement = opts.placement ?? { kind: 'fullscreen' };
    const ortho = opts.camera?.projection === 'ortho';
    const lens = orthoLens(1);
    this.camera = ortho
      ? new THREE.OrthographicCamera(
          -lens.width / 2,
          lens.width / 2,
          lens.height / 2,
          -lens.height / 2,
          0.1,
          BASE_FAR,
        )
      : new THREE.PerspectiveCamera(opts.camera?.fov ?? BASE_FOV, 1, 0.1, BASE_FAR);
    this.camera.position.set(0, 0, BASE_Z);
    this.applyLens(1);
  }

  /** What the lens shows vertically at the word's depth, in world units. */
  private frustumHeight(): number {
    if (this.camera instanceof THREE.OrthographicCamera) {
      return this.camera.top - this.camera.bottom;
    }
    return 2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
  }

  /** Whether the type is drawn in parallel projection. */
  get ortho(): boolean {
    return !this.camera.type.startsWith('Perspective');
  }

  /**
   * What the lens is doing, for the two places that map world to page — the letters' own CSS
   * boxes and a pointer aimed back into the word. An orthographic lens reports the height it
   * shows at every depth instead of an angle, because it has none.
   */
  lens(): { fov: number; cameraZ: number; aspect: number; orthoHeight?: number } {
    const aspect = this.aspect;
    if (this.camera instanceof THREE.OrthographicCamera) {
      return {
        fov: 0,
        cameraZ: this.camera.position.z,
        aspect,
        orthoHeight: this.camera.top - this.camera.bottom,
      };
    }
    return { fov: this.camera.fov, cameraZ: this.camera.position.z, aspect };
  }

  /** Idempotent: repeated fires reuse one context rather than allocating a new one. */
  mount(): THREE.WebGLRenderer {
    this.cancelIdle();
    if (this.renderer) return this.renderer;

    const anchor = this.placement.kind === 'element' ? this.placement.el : null;
    if (anchor) this.claimAnchor(anchor);
    // Before the CSS rather than in the resize below it, so the canvas is never appended at the
    // anchor's own size and re-inset a frame later.
    this.bleedPx = this.bleedFor(this.measure().height, pixelRatio());

    const canvas = document.createElement('canvas');
    canvas.style.cssText = canvasCss(this.placement, this.bleedPx);

    // premultipliedAlpha:false so a straight-alpha composite does not produce bright halos.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    (anchor ?? this.opts.target ?? document.body).appendChild(canvas);

    const layer = document.createElement('div');
    layer.style.cssText = layerCss(this.placement, this.bleedPx);
    (anchor ?? this.opts.target ?? document.body).appendChild(layer);
    this.textLayer = layer;

    this.canvas = canvas;
    this.renderer = renderer;
    this.environment = buildEnvironment(renderer);
    this.scene.environment = this.environment.texture;
    // Only reached by a material with no `envMap` of its own; klieg's all carry one, so this is
    // here so that such a material renders at the looks' exposure rather than silently at 1.
    this.scene.environmentIntensity = DEFAULTS.envMapIntensity;

    const onResize = () => this.resize();
    // Kept for the anchored case too: moving the window to a display of another devicePixelRatio
    // leaves the element's CSS box untouched, so the observer never fires and the buffer goes stale.
    globalThis.addEventListener('resize', onResize);
    this.detachResize = () => globalThis.removeEventListener('resize', onResize);
    if (anchor) this.observeAnchor(anchor);
    this.resize();

    return renderer;
  }

  /** The anchor must be a containing block, or `inset:0` resolves against some ancestor of it. */
  private claimAnchor(el: HTMLElement): void {
    const computed = globalThis.getComputedStyle?.(el);
    if (!computed) return;
    if (!canHoldCanvas(computed.display)) {
      throw new Error(`klieg: an anchor with display:${computed.display} cannot hold the canvas`);
    }
    if (!needsContainingBlock(computed.position)) return;
    const previous = el.style.position;
    el.style.position = 'relative';
    this.restorePosition = () => {
      el.style.position = previous;
    };
  }

  private observeAnchor(el: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(el);
    this.detachObserver = () => observer.disconnect();
  }

  measure(): { width: number; height: number } {
    const p = this.placement;
    if (p.kind === 'element') return { width: p.el.clientWidth, height: p.el.clientHeight };
    return { width: globalThis.innerWidth, height: globalThis.innerHeight };
  }

  resize(): void {
    if (!this.renderer) return;
    const box = this.measure();
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    // Zoom and a move to another display change devicePixelRatio and fire resize; setPixelRatio
    // reallocates the framebuffer, so only pay for it when the ratio actually moved.
    const ratio = pixelRatio();
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);

    const bleed = this.bleedFor(h, ratio);
    if (bleed !== this.bleedPx) {
      this.bleedPx = bleed;
      this.applyBleed();
    }
    const cw = w + 2 * bleed;
    const ch = h + 2 * bleed;
    this.renderer.setSize(cw, ch, false);
    this.applyLens(cw / ch);
  }

  /**
   * How far the canvas reaches past the anchor, so that a glow, a bevel highlight or a bloom halo
   * has pixels to fall off in rather than being cut at the box the type is aligned against. A
   * share of the tallest the type may be, floored at the blur's own reach — which is a fixed
   * count of device pixels, and so the binding one wherever the type is small.
   */
  private bleedFor(height: number, ratio: number): number {
    if (this.placement.kind !== 'element') return 0;
    const share = this.opts.bleed ?? DEFAULT_BLEED;
    if (share <= 0) return 0;
    const tallest = (this.opts.framing?.height ?? DEFAULT_HEIGHT_FRAC) * height;
    return Math.round(Math.max(BLOOM_REACH_PX / ratio, share * tallest));
  }

  /** Property by property, not `cssText`: a modal hold's `pointer-events` is written here too. */
  private applyBleed(): void {
    const bleed = this.bleedPx;
    const size = `calc(100% + ${2 * bleed}px)`;
    for (const el of [this.canvas, this.textLayer]) {
      if (!el) continue;
      el.style.inset = `${-bleed}px`;
      el.style.width = size;
      el.style.height = size;
    }
  }

  /** Only an anchor can be wide enough to need the longer lens; the overlay keeps the base one. */
  applyLens(aspect: number): void {
    this.aspect = aspect;
    if (this.camera instanceof THREE.OrthographicCamera) {
      const lens = orthoLens(aspect);
      this.camera.left = -lens.width / 2;
      this.camera.right = lens.width / 2;
      this.camera.top = lens.height / 2;
      this.camera.bottom = -lens.height / 2;
      this.camera.position.z = lens.z;
      this.camera.far = lens.z + (BASE_FAR - BASE_Z);
      this.camera.updateProjectionMatrix();
      return;
    }
    const want = this.opts.camera?.fov ?? BASE_FOV;
    const lens =
      this.placement.kind === 'element'
        ? lensFor(aspect, want)
        : { fov: want, z: FRUSTUM_HEIGHT / (2 * Math.tan((want * Math.PI) / 360)) };
    const half = { x: (FRUSTUM_HEIGHT * aspect) / 2, y: FRUSTUM_HEIGHT / 2 };
    const eye = this.eyeOffset(half);
    this.camera.fov = lens.fov;
    this.camera.aspect = aspect;
    this.camera.position.set(eye.x, eye.y, lens.z);
    // The far plane rides at a fixed depth behind the word rather than at a fixed distance.
    this.camera.far = lens.z + (BASE_FAR - BASE_Z);
    this.camera.updateProjectionMatrix();
    if (eye.x === 0 && eye.y === 0) return;
    // An off-centre eye sees the same window through a skewed frustum: the sides are no longer
    // symmetric about the axis, so the window — and the word on it — stays put while everything
    // at another depth slides. `updateProjectionMatrix` above wrote the symmetric one.
    const near = this.camera.near;
    const scale = near / lens.z;
    this.camera.projectionMatrix.makePerspective(
      (-half.x - eye.x) * scale,
      (half.x - eye.x) * scale,
      (half.y - eye.y) * scale,
      (-half.y - eye.y) * scale,
      near,
      this.camera.far,
      this.camera.coordinateSystem,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  /** The eye's own place in world units, from the share of the window the caller asked for. */
  private eyeOffset(half: { x: number; y: number }): { x: number; y: number } {
    const eye = this.opts.camera?.eye;
    if (!eye || this.ortho) return { x: 0, y: 0 };
    const clamp = (v: number | undefined) => Math.min(Math.max(v ?? 0, -MAX_EYE), MAX_EYE);
    return { x: clamp(eye.x) * half.x, y: clamp(eye.y) * half.y };
  }

  /**
   * Visible extent at the word's depth, used by fitScale. The fractions are a share of whatever
   * `resize` measured — the viewport, or the anchor's box — because `aspect` comes from it and
   * the frustum height at this depth is fixed.
   *
   * The frustum is the canvas, which reaches past the anchor by the bleed, so the anchor is that
   * share of it. Without the shrink the fractions and the aligned edge would land on the canvas
   * instead, and a word asked to meet the page's text edge would sit a bleed outside it.
   */
  viewportBudget(
    widthFrac = 0.62,
    heightFrac = DEFAULT_HEIGHT_FRAC,
    align?: Align,
    lineAlign?: Align,
  ): Budget {
    // Read off the camera rather than assumed: `applyLens` holds this height fixed, but a caller
    // that moves the camera itself has moved what the fractions are a share of.
    const vh = this.frustumHeight();
    const shrink = this.shrink();
    const extent = vh * this.aspect * shrink.x;
    return {
      width: extent * widthFrac,
      height: vh * shrink.y * heightFrac,
      extent,
      // Zero where nothing tapers: an orthographic frustum is the same box at the near cap as at
      // the word, so a letter's extrusion cannot cross an edge its front face clears.
      cameraZ: this.ortho ? 0 : this.camera.position.z,
      edge: edgeFor(align ?? this.defaultAlign(), this.direction()),
      lineEdge: edgeFor(lineAlign ?? 'start', this.direction()),
      // The anchor's box is the bound already, and filling it is the whole point of anchoring.
      cap: this.placement.kind === 'element' ? Number.POSITIVE_INFINITY : undefined,
    };
  }

  /** The anchor's share of the canvas on each axis: 1 on both wherever there is no bleed. */
  private shrink(): { x: number; y: number } {
    const bleed = this.bleedPx;
    if (bleed <= 0) return { x: 1, y: 1 };
    const box = this.measure();
    const w = Math.max(1, box.width);
    const h = Math.max(1, box.height);
    return { x: w / (w + 2 * bleed), y: h / (h + 2 * bleed) };
  }

  /**
   * An anchored word sits in a page that has its own text edge, and meeting it is usually the
   * point of anchoring. An overlay has no edge to meet, so it stays centred.
   */
  private defaultAlign(): Align {
    return this.placement.kind === 'element' ? 'start' : 'center';
  }

  /** The box's own reading direction; a document-less environment has none, and reads as `ltr`. */
  private direction(): string {
    const box =
      this.placement.kind === 'element' ? this.placement.el : globalThis.document?.documentElement;
    if (!box) return 'ltr';
    return globalThis.getComputedStyle?.(box).direction ?? 'ltr';
  }

  /** A modal hold is the only thing that stops the canvas itself being click-through. */
  setInteractive(on: boolean): void {
    if (this.canvas) this.canvas.style.pointerEvents = on ? 'auto' : 'none';
  }

  scheduleIdleTeardown(): void {
    this.cancelIdle();
    this.idleTimer = setTimeout(() => this.unmount(), this.opts.idleTimeoutMs);
  }

  private cancelIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  unmount(): void {
    this.cancelIdle();
    const { canvas, renderer, environment } = this;
    const layer = this.textLayer;
    const detachResize = this.detachResize;
    const detachObserver = this.detachObserver;
    const restorePosition = this.restorePosition;
    this.canvas = null;
    this.textLayer = null;
    this.renderer = null;
    this.environment = null;
    this.detachResize = null;
    this.detachObserver = null;
    this.restorePosition = null;
    this.scene.environment = null;

    try {
      detachResize?.();
      detachObserver?.();
      restorePosition?.();
      environment?.dispose();
      renderer?.dispose();
    } finally {
      // dispose() drops three's caches but keeps the GL context; only loseContext returns it.
      renderer?.forceContextLoss();
      canvas?.remove();
      layer?.remove();
    }
  }
}
