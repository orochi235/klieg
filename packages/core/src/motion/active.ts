import { cycle } from './build.js';
import type { ActiveName, MotionPatch } from './types.js';
import { NONE } from './types.js';

const TAU = Math.PI * 2;

const float = cycle(5200, {
  amplitude: { position: [0, 0.12, 0], rotation: [0.03, 0.1, 0] },
  // Rotation-x runs at double rate against the fundamental, and that beat is the whole character
  // of the motion.
  harmonic: { rotation: [2, 1, 1] },
});

const pulse = cycle(1600, { amplitude: { scale: 0.035 } });

const shimmer = cycle(2600, {
  amplitude: { rotation: [0, 0.05, 0] },
  shift: (letter) => (letter.index / Math.max(1, letter.count)) * TAU,
});

export const ACTIVE: Record<ActiveName, MotionPatch> = {
  float,
  pulse,
  shimmer,
  none: NONE,
};
