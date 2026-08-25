import * as THREE from 'three';
import type { Budget } from '../text/layout.js';
import { buildEnvironment } from './environment.js';

/** Where the canvas lives: over the whole viewport, or inside one element of the page. */
export type Placement = { kind: 'fullscreen' } | { kind: 'element'; el: HTMLElement };

export interface StageOptions {
  /** Resolved at mount, not at construction, so a document-less environment can still get here. */
  target?: HTMLElement;
  /** Idle milliseconds before the WebGL context is torn down. Browsers cap contexts near 16. */
  idleTimeoutMs: number;
  /** Fixed for an instance's lifetime; the canvas CSS and the fit basis both hang off it. */
  placement?: Placement;
}

// Inline because a library ships no stylesheet, and host page CSS must not reach the overlay.
const FULLSCREEN_CSS =
  'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
// No z-index: a positioned ancestor with `z-index:auto` is not a stacking context, so the
// fullscreen value here would paint the canvas over page content outside the anchor.
const ANCHORED_CSS = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';

export function canvasCss(placement: Placement): string {
  return placement.kind === 'element' ? ANCHORED_CSS : FULLSCREEN_CSS;
}

/** Only `static` is certainly broken; every other value is the host positioning it on purpose. */
export function needsContainingBlock(position: string): boolean {
  return position === 'static';
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

export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  canvas: HTMLCanvasElement | null = null;
  renderer: THREE.WebGLRenderer | null = null;
  environment: THREE.WebGLRenderTarget | null = null;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private detachResize: (() => void) | null = null;
  private detachObserver: (() => void) | null = null;
  private restorePosition: (() => void) | null = null;

  readonly placement: Placement;

  constructor(private readonly opts: StageOptions) {
    this.placement = opts.placement ?? { kind: 'fullscreen' };
    this.camera.position.set(0, 0, 11);
  }

  /** Idempotent: repeated fires reuse one context rather than allocating a new one. */
  mount(): THREE.WebGLRenderer {
    this.cancelIdle();
    if (this.renderer) return this.renderer;

    const anchor = this.placement.kind === 'element' ? this.placement.el : null;
    if (anchor) this.claimAnchor(anchor);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = canvasCss(this.placement);

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

    this.canvas = canvas;
    this.renderer = renderer;
    this.environment = buildEnvironment(renderer);
    this.scene.environment = this.environment.texture;

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
    const ratio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Visible extent at the word's depth, used by fitScale. The fractions are a share of whatever
   * `resize` measured — the viewport, or the anchor's box — because `aspect` comes from it and
   * the frustum height at this depth is fixed.
   */
  viewportBudget(widthFrac = 0.62, heightFrac = 0.3): Budget {
    const vh = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.z;
    return {
      width: vh * this.camera.aspect * widthFrac,
      height: vh * heightFrac,
      // The anchor's box is the bound already, and filling it is the whole point of anchoring.
      cap: this.placement.kind === 'element' ? Number.POSITIVE_INFINITY : undefined,
    };
  }

  /** A modal hold is the one state in which the overlay is not click-through. */
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
    const detachResize = this.detachResize;
    const detachObserver = this.detachObserver;
    const restorePosition = this.restorePosition;
    this.canvas = null;
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
    }
  }
}
