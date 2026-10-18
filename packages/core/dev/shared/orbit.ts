import { compose, type Transform } from '@core/index.js';
import { BASE_FOV, BASE_Z } from '@core/render/stage.js';
import * as THREE from 'three';

/** The fields of labkit's orbit camera the labs read. */
export interface Orbit {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  distance: number;
}

/** Where a lab's camera opens: klieg's own lens, so a pan moves the word by world units. */
export const HOME = {
  distance: BASE_Z,
  fov: (BASE_FOV * Math.PI) / 180,
  yaw: 0,
  pitch: 0,
  target: { x: 0, y: 0, z: 0 },
};

/** The word's turn for an orbit, in parts, for a lab that poses a three.js group itself. */
export interface OrbitPose {
  rotation: THREE.Euler;
  /** The dolly, as a multiple of the size the word has at home. */
  zoom: number;
  position: THREE.Vector3;
}

/**
 * klieg never moves its camera, so an orbit turns the word the other way about the target, and a
 * dolly is a uniform scale rather than a move in depth, which keeps the word clear of the near plane.
 */
export function orbitPose(orbit: Orbit): OrbitPose {
  const rotation = new THREE.Euler(orbit.pitch, -orbit.yaw, 0, 'XYZ');
  const zoom = HOME.distance / orbit.distance;
  const { x, y, z } = orbit.target;
  const position = new THREE.Vector3(-x, -y, -z)
    .applyQuaternion(new THREE.Quaternion().setFromEuler(rotation))
    .multiplyScalar(zoom);
  return { rotation, zoom, position };
}

/** The orbit as a `FireHandle.turn`. */
export function orbitTransform(orbit: Orbit): Transform {
  const { rotation, zoom, position } = orbitPose(orbit);
  const q = new THREE.Quaternion().setFromEuler(rotation);
  return compose([position.x, position.y, position.z], [q.x, q.y, q.z, q.w], [zoom, zoom, zoom]);
}
