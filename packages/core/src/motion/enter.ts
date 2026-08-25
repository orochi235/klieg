import { backOut, easeOutCubic } from '../easing.js';
import { transition } from './build.js';
import type { EnterName, MotionPiece } from './types.js';
import { NONE } from './types.js';

const TAU = Math.PI * 2;
/** Golden angle: consecutive letters land far apart without an RNG, so screenshots stay stable. */
const SCATTER = 2.399963;

const slam = transition(900, {
  from: { position: [0, 0, -26], scale: 0.55 },
  ease: backOut,
});

const spin = transition(1100, {
  from: { rotation: [0, TAU, 0], opacity: 0 },
  stagger: 0.55,
});

const flip = transition(1000, {
  from: { rotation: [-Math.PI, 0, 0], opacity: 0 },
  stagger: 0.6,
  // Steps rather than ramps: a half-turned letter reads as a stray edge, so it stays hidden
  // until the turn it has left to travel is under a twentieth.
  easeBy: { opacity: (s) => (1 - easeOutCubic(s) < 0.05 ? 1 : 0) },
});

const assemble = transition(1200, {
  from: (letter) => {
    const a = letter.index * SCATTER;
    return {
      position: [Math.cos(a) * 9, Math.sin(a) * 6, Math.sin(a * 2) * 5],
      rotation: [a, a * 0.7, 0],
      opacity: 0,
    };
  },
  easeBy: { opacity: (s) => easeOutCubic(Math.min(1, s * 2)) },
});

const rise = transition(900, {
  from: { position: [0, -5, 0], opacity: 0 },
  ease: backOut,
  stagger: 0.35,
  easeBy: { opacity: (s) => Math.min(1, s * 3) },
});

export const ENTER: Record<EnterName, MotionPiece> = {
  slam,
  spin,
  flip,
  assemble,
  rise,
  none: NONE,
};
