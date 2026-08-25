import * as THREE from 'three';
import type { SurfaceKind } from './surfaces.js';

/**
 * A colour the ramp passes through at `t`. Stops are sRGB hex; the returned colour is in three's
 * linear working space, because that is what `new THREE.Color(hex)` produces and what the shader
 * reads. Lerping sRGB components instead sends pink→cyan through grey.
 */
export function rampAt(stops: readonly number[], t: number): THREE.Color {
  if (stops.length === 1) return new THREE.Color(stops[0] as number);

  const u = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u));
  const f = u - i;
  const a = new THREE.Color(stops[i] as number);
  const b = new THREE.Color(stops[i + 1] as number);
  return a.lerp(b, f);
}

export type GradientDomain =
  | { of: 'run' }
  | { of: 'letter' }
  | { of: 'runIndex' }
  | { of: 'surface' }
  | { of: 'axis'; angle?: number }
  | { of: 'radial'; at?: [number, number] };

export interface GradientSpec {
  domain: GradientDomain;
  /** Colours the sweep runs through, in order. Two is a fade; more is a ramp. */
  stops: number[];
  /** `replace` paints the ramp; `modulate` multiplies the run's own colour by it. */
  mode: 'replace' | 'modulate';
}

/** What a per-run domain needs to know about the run it is colouring. */
export interface RunPlace {
  /** The run's ordinal among the lit runs. */
  litOrdinal: number;
  litCount: number;
  surface: SurfaceKind;
}

/** Domains whose value is constant within a run. Null for every other domain. */
export function perRunT(
  domain: GradientDomain,
  place: RunPlace,
  surfaces: readonly SurfaceKind[],
): number | null {
  if (domain.of === 'runIndex') {
    return place.litCount <= 1 ? 0 : place.litOrdinal / (place.litCount - 1);
  }
  if (domain.of === 'surface') {
    const i = surfaces.indexOf(place.surface);
    if (i < 0 || surfaces.length <= 1) return 0;
    return i / (surfaces.length - 1);
  }
  return null;
}

export const GRADIENT_T_ATTRIBUTE = 'gradientT';
/** Per-vertex shift of `gradientT`, written per part per frame by an effect's `crawl` channel. */
export const CRAWL_ATTRIBUTE = 'crawlT';

/** Where a run sits inside its glyph's lit length, as a fraction. */
export interface RunSpan {
  start: number;
  span: number;
}

/** Domains that vary along a run. `along` is the arc-length fraction from the sweep. Null for every other domain. */
export function perVertexT(domain: GradientDomain, along: number, place: RunSpan): number | null {
  if (domain.of !== 'run' && domain.of !== 'letter') return null;
  return domain.of === 'run' ? along : place.start + place.span * along;
}

export const RAMP_RESOLUTION = 256;

/**
 * The ramp as a texture the shader can index by `t`. Built by sampling `rampAt`, so a positional
 * domain and a per-run one resolve the same stops to the same colours.
 *
 * Half float, not float: linear filtering of a float texture needs `OES_texture_float_linear`, and
 * a device without it drops to nearest and bands the ramp into 256 steps rather than erroring.
 */
export function rampTexture(stops: readonly number[]): THREE.DataTexture {
  const data = new Uint16Array(RAMP_RESOLUTION * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0; i < RAMP_RESOLUTION; i++) {
    const c = rampAt(stops, i / (RAMP_RESOLUTION - 1));
    data[i * 4] = THREE.DataUtils.toHalfFloat(c.r);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(c.g);
    data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(c.b);
    data[i * 4 + 3] = one;
  }
  const tex = new THREE.DataTexture(
    data,
    RAMP_RESOLUTION,
    1,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // Already linear: rampAt returns three's working space, so a colour-space conversion would
  // apply the sRGB transfer function a second time.
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
