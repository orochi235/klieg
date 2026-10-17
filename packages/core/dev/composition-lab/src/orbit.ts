import { compose, type Transform } from '@core/index.js';
import { BASE_FOV, BASE_Z } from '@core/render/stage.js';
import * as THREE from 'three';

/** The fields of labkit's orbit camera this lab reads. */
export interface Orbit {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  distance: number;
}

/** Where the trial's camera opens: klieg's own lens, so a pan moves the word by world units. */
export const HOME = {
  distance: BASE_Z,
  fov: (BASE_FOV * Math.PI) / 180,
  yaw: 0,
  pitch: 0,
  target: { x: 0, y: 0, z: 0 },
};

/**
 * The orbit as the word's own turn. klieg never moves its camera, so the word turns the other way
 * about the target, and a dolly is a uniform scale rather than a move in depth, which keeps the
 * word clear of the near plane.
 */
export function orbitTransform(orbit: Orbit): Transform {
  const turn = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(orbit.pitch, -orbit.yaw, 0, 'XYZ'),
  );
  const scale = HOME.distance / orbit.distance;
  const { x, y, z } = orbit.target;
  const at = new THREE.Vector3(-x, -y, -z).applyQuaternion(turn).multiplyScalar(scale);
  return compose([at.x, at.y, at.z], [turn.x, turn.y, turn.z, turn.w], [scale, scale, scale]);
}
