import { easeInCubic, linear } from '../easing.js';
import { transition } from './build.js';
import type { ExitName, MotionPatch } from './types.js';
import { NONE } from './types.js';

/** Golden angle: consecutive letters fly apart without an RNG, so screenshots stay stable. */
const SCATTER = 2.399963;

const shatter = transition(800, {
  to: (letter) => {
    const a = letter.index * SCATTER;
    return {
      position: [Math.cos(a) * 10, Math.sin(a) * 7, Math.sin(a * 3) * 6],
      rotation: [a * 3, a * 2, a],
      opacity: 0,
    };
  },
  easeBy: { opacity: easeInCubic },
});

const drop = transition(700, {
  to: (letter) => ({
    position: [0, -22, 0],
    rotation: [0, 0, letter.index % 2 === 0 ? 0.9 : -0.9],
    opacity: 0,
  }),
  // Gravity, not an easing curve: distance goes with the square of the time.
  ease: (t) => t * t,
  easeBy: { opacity: easeInCubic },
});

const recede = transition(650, {
  to: { position: [0, 0, -30], scale: 0.5, opacity: 0 },
  ease: easeInCubic,
});

const fade = transition(500, {
  to: { opacity: 0, scale: 1.06 },
  ease: linear,
});

export const EXIT: Record<ExitName, MotionPatch> = {
  shatter,
  drop,
  recede,
  fade,
  none: NONE,
};
