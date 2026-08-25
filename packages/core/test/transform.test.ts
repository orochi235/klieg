import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { compose, fromAxisAngle, fromEuler, isIdentity } from '../src/transform.js';

function apply(matrix: readonly number[], v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(...v).applyMatrix4(new THREE.Matrix4().fromArray(matrix as number[]));
}

describe('fromEuler', () => {
  it('rotates about y in three default XYZ order', () => {
    const p = apply(fromEuler(0, Math.PI / 2, 0), [1, 0, 0]);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(-1, 10);
  });

  it('is the identity transform at zero', () => {
    const p = apply(fromEuler(0, 0, 0), [1, 2, 3]);
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
  });
});

describe('fromAxisAngle', () => {
  it('rotates about an arbitrary axis by the given angle', () => {
    const p = apply(fromAxisAngle([0, 1, 0], Math.PI / 2), [1, 0, 0]);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(-1, 10);
  });

  it('normalizes the axis, so a non-unit vector still rotates cleanly', () => {
    const p = apply(fromAxisAngle([0, 5, 0], Math.PI / 2), [1, 0, 0]);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(-1, 10);
  });
});

describe('compose', () => {
  it('combines position, rotation and scale in that order', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const matrix = compose([5, 0, 0], [q.x, q.y, q.z, q.w], [2, 2, 2]);
    const p = apply(matrix, [1, 0, 0]);
    // Scale then rotate then translate: (1,0,0)*2 -> (2,0,0) -> rotate y90 -> (0,0,-2) -> +(5,0,0).
    expect(p.x).toBeCloseTo(5, 10);
    expect(p.z).toBeCloseTo(-2, 10);
  });
});

describe('isIdentity', () => {
  it('clears a transform that leaves the word alone', () => {
    expect(isIdentity(fromEuler(0, 0, 0))).toBe(true);
    expect(isIdentity(fromAxisAngle([0, 1, 0], 0))).toBe(true);
  });

  it('catches a rotation, a move and a scale', () => {
    expect(isIdentity(fromEuler(0, 0.3, 0))).toBe(false);
    expect(isIdentity(compose([1, 0, 0], [0, 0, 0, 1], [1, 1, 1]))).toBe(false);
    expect(isIdentity(compose([0, 0, 0], [0, 0, 0, 1], [2, 2, 2]))).toBe(false);
  });

  it('rejects anything that is not sixteen numbers', () => {
    expect(isIdentity([1, 0, 0, 1])).toBe(false);
  });
});
