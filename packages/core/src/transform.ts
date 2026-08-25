import * as THREE from 'three';
import type { Vec3 } from './pose.js';

/**
 * A rigid transform as 16 numbers, column-major — three's `Matrix4.toArray()`/`fromArray()`
 * layout. Plain numbers rather than a `THREE.Matrix4`, so this package's public API never leaks
 * three's classes to callers who don't otherwise depend on it. Build one with `fromEuler`,
 * `fromAxisAngle` or `compose` rather than writing the sixteen numbers by hand.
 */
export type Transform = readonly number[];

const scratch = new THREE.Matrix4();
const IDENTITY = new THREE.Matrix4().toArray();

/** Whether a transform leaves the word exactly where the layout put it. */
export function isIdentity(transform: Transform): boolean {
  return transform.length === 16 && IDENTITY.every((v, i) => transform[i] === v);
}

/** Rotation only, three's default XYZ Euler order, radians. */
export function fromEuler(x: number, y: number, z: number): Transform {
  return scratch.makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ')).toArray();
}

/** Rotation only, `radians` about `axis` (need not be unit length). */
export function fromAxisAngle(axis: Vec3, radians: number): Transform {
  const a = new THREE.Vector3(...axis).normalize();
  return scratch.makeRotationAxis(a, radians).toArray();
}

/** Position, rotation (as a quaternion `[x, y, z, w]`) and scale, composed in that order. */
export function compose(
  position: Vec3,
  quaternion: readonly [number, number, number, number],
  scale: Vec3,
): Transform {
  return scratch
    .compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion(...quaternion),
      new THREE.Vector3(...scale),
    )
    .toArray();
}
