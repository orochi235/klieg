import * as THREE from 'three';
import type { Point2 } from './field.js';
import { type Frame, rotationMinimizingFrames } from './frames.js';
import { GRADIENT_T_ATTRIBUTE, type GradientDomain, perVertexT, type RunSpan } from './gradient.js';
import { minCurvatureRadius3, smooth } from './resample.js';
import type { Run } from './runs.js';
import { RUN_COLOR_ATTRIBUTE } from './tint.js';

/** Smoothing happens here rather than upstream: a run ends at a corner, so it never crosses one. */
const SMOOTH_PASSES = 3;

/**
 * A run's centerline smoothed in x/y, z untouched. Used for both the curvature measurement and
 * the swept path itself, so the tube doesn't trace the staircase noise this smoothing exists to
 * see past.
 */
export function smoothedPoints(run: Run): THREE.Vector3[] {
  const flat = smooth(
    run.points.map((p) => ({ x: p.x, y: p.y })),
    SMOOTH_PASSES,
    'open',
    run.from.map((source) => source === null),
  );
  return run.points.map((p, i) => {
    const f = flat[i] as Point2;
    return new THREE.Vector3(f.x, f.y, p.z);
  });
}

/**
 * The run's tightest bend radius, in em. A diagnostic: nothing scales geometry by it any more.
 * The corner stage is what makes a path bendable, and a run it could not fix is broken rather than
 * thinned, so diameter is an invariant of the blueprint rather than an outcome of it.
 */
export function tightestBend(run: Run): number {
  return minCurvatureRadius3(smoothedPoints(run));
}

/**
 * Builds tube geometry directly from a rotation-minimizing frame at each point, rather than
 * THREE.TubeGeometry's Frenet frames — Frenet is undefined at inflection points and flips sign
 * wherever curvature is small, tearing the swept surface on any run that bends in 3D.
 */
/**
 * Quarter-turns of hemisphere at each end. A run end is a sealed tube, not an open one: glass is
 * tipped off into a dome, and the sweep used to emit its wall and nothing else, so every run
 * terminated in a hole the backing's transparency drew as a cut edge.
 */
const CAP_RINGS = 4;

interface Ring {
  centre: THREE.Vector3;
  frame: Frame;
  radius: number;
  /** Outward tilt of the ring's normals, for a cap; zero along the tube's own wall. */
  tilt: number;
}

/** The tube's own rings, domed at both ends. */
function ringsOf(points: THREE.Vector3[], radius: number): Ring[] {
  const frames = rotationMinimizingFrames(points);
  const wall: Ring[] = points.map((centre, i) => ({
    centre,
    frame: frames[i] as Frame,
    radius,
    tilt: 0,
  }));

  const cap = (at: number, sign: 1 | -1): Ring[] => {
    const base = wall[at] as Ring;
    const out: Ring[] = [];
    for (let k = 1; k <= CAP_RINGS; k++) {
      const theta = (k / CAP_RINGS) * (Math.PI / 2);
      out.push({
        centre: base.centre
          .clone()
          .addScaledVector(base.frame.tangent, sign * radius * Math.sin(theta)),
        frame: base.frame,
        radius: radius * Math.cos(theta),
        tilt: sign * theta,
      });
    }
    return out;
  };

  return [...cap(0, -1).reverse(), ...wall, ...cap(wall.length - 1, 1)];
}

/** The gradient's placement for one run, when the domain is resolved per vertex. */
export interface GradientPlace {
  domain: GradientDomain;
  place: RunSpan;
}

function buildTubeGeometry(
  points: THREE.Vector3[],
  radius: number,
  segments: number,
  color: number,
  gradient?: GradientPlace,
): THREE.BufferGeometry {
  const rings = ringsOf(points, radius);
  const ringCount = rings.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const ts: number[] = [];
  const indices: number[] = [];
  // Linear, because `setHex` converts from sRGB and the shader works in linear space.
  const tint = new THREE.Color(color);

  // Ring index alone would spend a fixed share of the gradient on the domed caps regardless of
  // their physical length; cumulative centre distance keeps it proportional instead.
  const arcLength: number[] = [0];
  for (let i = 1; i < ringCount; i++) {
    const d = (rings[i] as Ring).centre.distanceTo((rings[i - 1] as Ring).centre);
    arcLength.push((arcLength[i - 1] as number) + d);
  }
  const totalLength = arcLength[ringCount - 1] ?? 0;

  for (let i = 0; i < ringCount; i++) {
    const ring = rings[i] as Ring;
    const frame = ring.frame;
    const p = ring.centre;
    const radial = Math.cos(ring.tilt);
    const axial = Math.sin(ring.tilt);
    const along = totalLength > 0 ? (arcLength[i] as number) / totalLength : 0;
    for (let j = 0; j <= segments; j++) {
      const v = (j / segments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      const nx = radial * (cos * frame.normal.x + sin * frame.binormal.x) + axial * frame.tangent.x;
      const ny = radial * (cos * frame.normal.y + sin * frame.binormal.y) + axial * frame.tangent.y;
      const nz = radial * (cos * frame.normal.z + sin * frame.binormal.z) + axial * frame.tangent.z;
      normals.push(nx, ny, nz);
      positions.push(
        p.x + ring.radius * (cos * frame.normal.x + sin * frame.binormal.x),
        p.y + ring.radius * (cos * frame.normal.y + sin * frame.binormal.y),
        p.z + ring.radius * (cos * frame.normal.z + sin * frame.binormal.z),
      );
      uvs.push(i / (ringCount - 1), j / segments);
      colors.push(tint.r, tint.g, tint.b);
      if (gradient) {
        const t = perVertexT(gradient.domain, along, gradient.place);
        if (t !== null) ts.push(t);
      }
    }
  }

  for (let j = 1; j < ringCount; j++) {
    for (let i = 1; i <= segments; i++) {
      const a = (segments + 1) * (j - 1) + (i - 1);
      const b = (segments + 1) * j + (i - 1);
      const c = (segments + 1) * j + i;
      const d = (segments + 1) * (j - 1) + i;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute(RUN_COLOR_ATTRIBUTE, new THREE.Float32BufferAttribute(colors, 3));
  if (ts.length > 0) {
    geo.setAttribute(GRADIENT_T_ATTRIBUTE, new THREE.Float32BufferAttribute(ts, 1));
  }
  geo.computeBoundingSphere();
  return geo;
}

export function sweepRun(
  run: Run,
  requested: number,
  segments: number,
  gradient?: GradientPlace,
): THREE.BufferGeometry | null {
  if (run.points.length < 2 || requested <= 0) return null;
  // Points are already arc-length spaced (resample.ts) and corner-cut (runs.ts), so a
  // Catmull-Rom re-resample bought nothing but a second parameterization to reason about.
  return buildTubeGeometry(smoothedPoints(run), requested, segments, run.color, gradient);
}
