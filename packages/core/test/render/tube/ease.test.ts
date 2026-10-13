import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { vertexBends } from '../../../src/render/tube/bend.js';
import { easeShallowCorners } from '../../../src/render/tube/ease.js';

const RHO_MIN = 0.06;
const STEP = 0.02;

/** A straight run of `n` steps each side of one vertex turning to bend at `rho`. */
function kinked(rho: number, n = 8): THREE.Vector3[] {
  const turn = 2 * Math.asin(STEP / (2 * rho));
  const out = Array.from({ length: n }, (_, k) => new THREE.Vector3((k - n) * STEP, 0, 0));
  out.push(new THREE.Vector3(0, 0, 0));
  for (let k = 1; k <= n; k++) {
    out.push(new THREE.Vector3(Math.cos(turn) * k * STEP, Math.sin(turn) * k * STEP, 0));
  }
  return out;
}

const tightest = (points: THREE.Vector3[]) =>
  Math.min(...vertexBends(points, false).map((b) => b.rho));

describe('easeShallowCorners', () => {
  it('smooths a corner just under the floor until it clears, within the drift allowed', () => {
    const points = kinked(RHO_MIN * 0.97);
    const before = points.map((p) => p.clone());
    expect(easeShallowCorners(points, false, RHO_MIN, 0.015)).toBe(1);
    expect(tightest(points)).toBeGreaterThanOrEqual(RHO_MIN);
    const drift = Math.max(...points.map((p, i) => p.distanceTo(before[i] as THREE.Vector3)));
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThanOrEqual(0.015);
  });

  it('moves the points in place, so whatever aliases them follows', () => {
    const points = kinked(RHO_MIN * 0.97);
    const held = points.slice();
    easeShallowCorners(points, false, RHO_MIN, 0.015);
    expect(points.every((p, i) => p === held[i])).toBe(true);
  });

  it('leaves a corner well under the floor to be cut', () => {
    const points = kinked(RHO_MIN * 0.5);
    const before = points.map((p) => p.clone());
    expect(easeShallowCorners(points, false, RHO_MIN, 0.015)).toBe(0);
    expect(points.every((p, i) => p.equals(before[i] as THREE.Vector3))).toBe(true);
  });

  it('restores a corner whose easing would drift further than allowed', () => {
    const points = kinked(RHO_MIN * 0.97);
    const before = points.map((p) => p.clone());
    expect(easeShallowCorners(points, false, RHO_MIN, 1e-5)).toBe(0);
    expect(points.every((p, i) => p.equals(before[i] as THREE.Vector3))).toBe(true);
  });
});
