import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_FOV,
  BASE_Z,
  canHoldCanvas,
  canvasCss,
  edgeFor,
  layerCss,
  lensFor,
  MAX_HALF_ANGLE_DEG,
  needsContainingBlock,
  prefersReducedMotion,
  Stage,
  webglSupported,
} from '../../src/render/stage.js';
import { FIT_CAP, fitScale } from '../../src/text/layout.js';

/** No DOM here, so every test stays on the paths that never touch `target`. */
function headlessStage(idleTimeoutMs = 1000): Stage {
  return new Stage({ idleTimeoutMs });
}

function frustumHeight(stage: Stage): number {
  return 2 * Math.tan((stage.camera.fov * Math.PI) / 360) * stage.camera.position.z;
}

describe('viewportBudget', () => {
  // 2 * tan(38deg / 2) * 11 = 7.5752075 visible units tall at the word's depth.
  it('matches an extent computed by hand from the constructor fov and distance', () => {
    const stage = headlessStage();

    expect(stage.viewportBudget(1, 1).height).toBeCloseTo(7.5752075, 6);
    expect(stage.viewportBudget().width).toBeCloseTo(4.6966286, 6);
    expect(stage.viewportBudget().height).toBeCloseTo(2.2725622, 6);
  });

  it('matches the frustum extent at the camera distance', () => {
    const stage = headlessStage();
    stage.camera.aspect = 1.5;
    const budget = stage.viewportBudget(1, 1);

    expect(budget.height).toBeCloseTo(frustumHeight(stage), 12);
    expect(budget.width).toBeCloseTo(frustumHeight(stage) * 1.5, 12);
  });

  it('leaves room by default rather than filling the frustum', () => {
    const stage = headlessStage();
    const budget = stage.viewportBudget();

    expect(budget.width).toBeCloseTo(frustumHeight(stage) * stage.camera.aspect * 0.62, 12);
    expect(budget.height).toBeCloseTo(frustumHeight(stage) * 0.3, 12);
  });

  it('feeds aspect into width only', () => {
    const stage = headlessStage();
    stage.camera.aspect = 1;
    const square = stage.viewportBudget();
    stage.camera.aspect = 2;
    const wide = stage.viewportBudget();

    expect(wide.width).toBeCloseTo(square.width * 2, 12);
    expect(wide.height).toBeCloseTo(square.height, 12);
  });

  it('scales linearly with the fractions and with camera distance', () => {
    const stage = headlessStage();
    const half = stage.viewportBudget(0.31, 0.15);
    const full = stage.viewportBudget(0.62, 0.3);

    expect(half.width).toBeCloseTo(full.width / 2, 12);
    expect(half.height).toBeCloseTo(full.height / 2, 12);

    stage.camera.position.z *= 3;
    const far = stage.viewportBudget();
    expect(far.width).toBeCloseTo(full.width * 3, 12);
    expect(far.height).toBeCloseTo(full.height * 3, 12);
  });
});

describe('idle teardown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('unmounts once the idle timeout elapses', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(499);
    expect(unmount).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown instead of stacking timers', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(400);
    stage.scheduleIdleTeardown();
    vi.advanceTimersByTime(400);
    expect(unmount).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(unmount).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(unmount).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending teardown when unmounted early', () => {
    vi.useFakeTimers();
    const stage = headlessStage(500);
    const unmount = vi.spyOn(stage, 'unmount');

    stage.scheduleIdleTeardown();
    stage.unmount();
    vi.advanceTimersByTime(10_000);
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});

describe('unmount', () => {
  it('is safe on a stage that was never mounted, and repeatable', () => {
    const stage = headlessStage();
    expect(() => {
      stage.unmount();
      stage.unmount();
    }).not.toThrow();

    expect(stage.canvas).toBeNull();
    expect(stage.renderer).toBeNull();
    expect(stage.environment).toBeNull();
    expect(stage.scene.environment).toBeNull();
  });

  it('detaches the canvas even when disposal throws, so no context is stranded', () => {
    const stage = headlessStage();
    const remove = vi.fn();
    stage.canvas = { remove } as unknown as HTMLCanvasElement;
    stage.environment = {
      dispose: () => {
        throw new Error('dispose failed');
      },
    } as unknown as THREE.WebGLRenderTarget;

    expect(() => stage.unmount()).toThrow('dispose failed');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(stage.canvas).toBeNull();
    expect(stage.environment).toBeNull();
  });
});

describe('resize', () => {
  it('does nothing without a renderer, so no NaN aspect reaches the camera', () => {
    const stage = headlessStage();
    expect(() => stage.resize()).not.toThrow();
    expect(stage.camera.aspect).toBe(1);
  });
});

describe('webglSupported', () => {
  it('reports false rather than throwing where there is no document', () => {
    expect(webglSupported()).toBe(false);
  });
});

describe('prefersReducedMotion', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'matchMedia');
  });

  it('is false where matchMedia is unavailable', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('asks for the reduce query and returns its match', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    Object.defineProperty(globalThis, 'matchMedia', { value: matchMedia, configurable: true });

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');

    matchMedia.mockReturnValue({ matches: false });
    expect(prefersReducedMotion()).toBe(false);
  });
});

function anchor(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

describe('canvasCss', () => {
  it('pins a fullscreen canvas to the viewport above everything', () => {
    const css = canvasCss({ kind: 'fullscreen' });

    expect(css).toContain('position:fixed');
    expect(css).toContain('z-index:2147483000');
  });

  it('carries no z-index when anchored, which would escape the anchor', () => {
    const css = canvasCss({ kind: 'element', el: anchor(800, 120) });

    expect(css).toContain('position:absolute');
    expect(css).toContain('inset:0');
    expect(css).not.toContain('z-index');
  });

  it('stays click-through either way', () => {
    expect(canvasCss({ kind: 'fullscreen' })).toContain('pointer-events:none');
    expect(canvasCss({ kind: 'element', el: anchor(800, 120) })).toContain('pointer-events:none');
  });
});

describe('layerCss', () => {
  it('is click-through at the container, so only a span can take a click', () => {
    expect(layerCss({ kind: 'fullscreen' })).toContain('pointer-events:none');
    expect(layerCss({ kind: 'element', el: null as unknown as HTMLElement })).toContain(
      'pointer-events:none',
    );
  });

  it('sits one above the canvas when fullscreen, and stacks by paint order when anchored', () => {
    expect(layerCss({ kind: 'fullscreen' })).toContain('z-index:2147483001');
    expect(layerCss({ kind: 'element', el: null as unknown as HTMLElement })).not.toContain(
      'z-index',
    );
  });

  it('covers the same box the canvas does', () => {
    for (const css of [layerCss({ kind: 'fullscreen' }), canvasCss({ kind: 'fullscreen' })]) {
      expect(css).toContain('inset:0');
    }
  });
});

describe('needsContainingBlock', () => {
  it('claims only a static anchor, leaving every deliberate value alone', () => {
    expect(needsContainingBlock('static')).toBe(true);
    for (const value of ['relative', 'absolute', 'fixed', 'sticky']) {
      expect(needsContainingBlock(value)).toBe(false);
    }
  });
});

describe('canHoldCanvas', () => {
  it('rejects the displays with no box to position against', () => {
    expect(canHoldCanvas('contents')).toBe(false);
    expect(canHoldCanvas('inline')).toBe(false);
  });

  it('accepts anything that lays out a box', () => {
    for (const value of ['block', 'flex', 'grid', 'inline-block', 'flow-root']) {
      expect(canHoldCanvas(value)).toBe(true);
    }
  });
});

describe('measure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to fullscreen and reads the viewport', () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    const stage = new Stage({ idleTimeoutMs: 1000 });

    expect(stage.placement).toEqual({ kind: 'fullscreen' });
    expect(stage.measure()).toEqual({ width: 1440, height: 900 });
  });

  it('reads the anchor box, not the viewport, when anchored', () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    const stage = new Stage({
      idleTimeoutMs: 1000,
      placement: { kind: 'element', el: anchor(800, 120) },
    });

    expect(stage.measure()).toEqual({ width: 800, height: 120 });
  });
});

describe('the fit cap', () => {
  it('holds a fullscreen overlay to the default bound', () => {
    const stage = new Stage({ idleTimeoutMs: 1000 });

    expect(stage.viewportBudget().cap).toBeUndefined();
    expect(fitScale(1, 1, stage.viewportBudget())).toBe(FIT_CAP);
  });

  it('lifts it when anchored, where the box is the bound and the cap only starves the fit', () => {
    const strip = new Stage({
      idleTimeoutMs: 1000,
      placement: { kind: 'element', el: anchor(800, 120) },
    });
    strip.camera.aspect = 800 / 120;
    const budget = strip.viewportBudget(0.94, 0.66);

    expect(budget.cap).toBe(Number.POSITIVE_INFINITY);
    // A short word in a wide strip: the height budget binds, not an arbitrary ceiling.
    expect(fitScale(1, 1, budget)).toBeCloseTo(budget.height, 12);
    expect(fitScale(1, 1, budget)).toBeGreaterThan(FIT_CAP);
  });
});

describe('framing against an anchor', () => {
  it('spends the same fractions on the anchor box that it spends on the viewport', () => {
    const strip = new Stage({
      idleTimeoutMs: 1000,
      placement: { kind: 'element', el: anchor(800, 120) },
    });
    // What resize() writes for that box; the frustum height at this depth never moves.
    strip.camera.aspect = 800 / 120;
    const budget = strip.viewportBudget(0.94, 0.66);

    expect(budget.width / (frustumHeight(strip) * strip.camera.aspect)).toBeCloseTo(0.94, 12);
    expect(budget.height / frustumHeight(strip)).toBeCloseTo(0.66, 12);
  });
});

it('reports the whole box as the extent the alignment measures against', () => {
  const strip = new Stage({
    idleTimeoutMs: 1000,
    placement: { kind: 'element', el: anchor(800, 120) },
  });
  strip.camera.aspect = 800 / 120;
  const budget = strip.viewportBudget(0.94, 0.66);

  expect(budget.extent).toBeCloseTo(frustumHeight(strip) * strip.camera.aspect, 12);
  // The fractions cut the budget out of the extent; alignment needs the extent itself.
  expect(budget.width).toBeCloseTo((budget.extent as number) * 0.94, 12);
});

describe('which edge an alignment names', () => {
  const strip = () =>
    new Stage({ idleTimeoutMs: 1000, placement: { kind: 'element', el: anchor(800, 120) } });

  it('resolves start and end against the reading direction', () => {
    expect(edgeFor('start', 'ltr')).toBe('left');
    expect(edgeFor('end', 'ltr')).toBe('right');
    expect(edgeFor('start', 'rtl')).toBe('right');
    expect(edgeFor('end', 'rtl')).toBe('left');
  });

  it('names no edge for a centred word', () => {
    expect(edgeFor('center', 'ltr')).toBeUndefined();
    expect(edgeFor('center', 'rtl')).toBeUndefined();
  });

  it('meets the anchor own edge unless the caller says otherwise', () => {
    // The page an anchored word sits in has a text edge, and meeting it is the point of anchoring.
    expect(strip().viewportBudget(0.94, 0.66).edge).toBe('left');
    expect(strip().viewportBudget(0.94, 0.66, 'center').edge).toBeUndefined();
    expect(strip().viewportBudget(0.94, 0.66, 'end').edge).toBe('right');
  });

  it('leaves a fullscreen overlay centred, which has no edge to meet', () => {
    expect(headlessStage().viewportBudget().edge).toBeUndefined();
    expect(headlessStage().viewportBudget(0.62, 0.3, 'start').edge).toBe('left');
  });

  it('mirrors the default in an anchor the page reads right to left', () => {
    const rtl = { clientWidth: 800, clientHeight: 120, dir: 'rtl' } as unknown as HTMLElement;
    const stage = new Stage({ idleTimeoutMs: 1000, placement: { kind: 'element', el: rtl } });
    vi.stubGlobal('getComputedStyle', (el: HTMLElement) => ({
      direction: (el as unknown as { dir?: string }).dir ?? 'ltr',
    }));

    expect(stage.viewportBudget(0.94, 0.66).edge).toBe('right');
    expect(stage.viewportBudget(0.94, 0.66, 'end').edge).toBe('left');

    vi.unstubAllGlobals();
  });
});

describe('the lens against a wide anchor', () => {
  const halfAngleDeg = (aspect: number, lens: { fov: number; z: number }): number => {
    const frustumH = 2 * Math.tan((lens.fov * Math.PI) / 360) * lens.z;
    return (Math.atan((frustumH * aspect) / 2 / lens.z) * 180) / Math.PI;
  };

  it('leaves a narrow box on the lens the overlay has always used', () => {
    expect(lensFor(16 / 9)).toEqual({ fov: BASE_FOV, z: BASE_Z });
  });

  it('holds the frustum height at the word depth, so framing keeps its meaning', () => {
    const base = 2 * Math.tan((BASE_FOV * Math.PI) / 360) * BASE_Z;

    for (const aspect of [1, 2.5, 6.9, 10.17, 14.75]) {
      const lens = lensFor(aspect);
      expect(2 * Math.tan((lens.fov * Math.PI) / 360) * lens.z).toBeCloseTo(base, 9);
    }
  });

  it('bounds the angle the outer glyphs are seen at, however wide the box', () => {
    for (const aspect of [6.9, 10.17, 14.75, 40]) {
      expect(halfAngleDeg(aspect, lensFor(aspect))).toBeLessThanOrEqual(MAX_HALF_ANGLE_DEG + 1e-9);
    }
  });

  it('narrows monotonically as the box widens', () => {
    const wide = lensFor(10.17);
    const wider = lensFor(14.75);

    expect(wider.fov).toBeLessThan(wide.fov);
    expect(wider.z).toBeGreaterThan(wide.z);
  });

  it('keeps a fullscreen overlay on the base lens at any aspect', () => {
    const stage = headlessStage();
    stage.applyLens(10.17);

    expect(stage.camera.fov).toBe(BASE_FOV);
    expect(stage.camera.position.z).toBe(BASE_Z);
  });

  it('narrows an anchored stage on a strip the overlay would never see', () => {
    const strip = new Stage({
      idleTimeoutMs: 1000,
      placement: { kind: 'element', el: anchor(1180, 116) },
    });
    strip.applyLens(1180 / 116);

    expect(strip.camera.fov).toBeLessThan(BASE_FOV);
    expect(strip.camera.position.z).toBeGreaterThan(BASE_Z);
    expect(
      halfAngleDeg(1180 / 116, { fov: strip.camera.fov, z: strip.camera.position.z }),
    ).toBeLessThanOrEqual(MAX_HALF_ANGLE_DEG + 1e-9);
  });

  it('spends the same framing fractions on the box after narrowing', () => {
    const strip = new Stage({
      idleTimeoutMs: 1000,
      placement: { kind: 'element', el: anchor(1180, 116) },
    });
    strip.camera.aspect = 1180 / 116;
    strip.applyLens(1180 / 116);
    const budget = strip.viewportBudget(0.94, 0.66);

    expect(budget.width / (frustumHeight(strip) * strip.camera.aspect)).toBeCloseTo(0.94, 12);
    expect(budget.height / frustumHeight(strip)).toBeCloseTo(0.66, 12);
  });
});
