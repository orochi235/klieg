import { bench, describe } from 'vitest';
import { EffectFrame, planEffects } from '../../src/effects/frame.js';
import { hinge } from '../../src/effects/hinge.js';
import { kicks } from '../../src/effects/kick.js';
import { flicker } from '../../src/effects/patches.js';
import { power } from '../../src/effects/power.js';
import { dwell, near } from '../../src/effects/signal.js';
import type { EffectPatch, PartInfo } from '../../src/effects/types.js';
import { blankPose, Timeline } from '../../src/motion/compositor.js';
import type { LetterInfo, MotionPatch } from '../../src/motion/types.js';

/**
 * What one frame of the mix costs, so the schema's open question about `at` writing into a buffer
 * has a number to answer to. A frame is every letter posed and every part resolved once; the
 * budget it has to fit inside is 16.7ms.
 */

const LETTERS = 12;
const PARTS = 60;
const EFFECTS = 3;

const drift: MotionPatch = {
  duration: 900,
  at: (phase, letter) => ({
    position: [Math.sin(phase * 6.28 + letter.index), phase * 0.1, 0],
    rotation: [0, phase * 0.2, 0],
    scale: 1 + phase * 0.05,
    opacity: 1 - phase * 0.1,
  }),
};

const timeline = new Timeline({
  enter: drift,
  active: [drift, drift],
  exit: drift,
  hold: 1200,
  blendMs: 300,
});

const letters: LetterInfo[] = Array.from({ length: LETTERS }, (_, index) => ({
  char: 'a',
  index,
  count: LETTERS,
  line: 0,
  column: index,
  lineCount: 1,
  columnCount: LETTERS,
  x: index,
  y: 0,
}));
const scratch = letters.map(() => blankPose());

const flick: EffectPatch = {
  period: 700,
  at: (phase, part) => ({
    gain: 0.5 + 0.5 * Math.sin(phase * 6.28 + part.index),
    dark: phase * 0.2,
    crawl: phase * 0.1,
    light: { color: 0xffcc66, amount: phase },
  }),
};

const parts: PartInfo[] = Array.from({ length: PARTS }, (_, index) => ({
  kind: 'run',
  index,
  count: PARTS,
  letter: letters[index % LETTERS] as LetterInfo,
  x: index,
  y: 0,
  ink: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
  at: index / PARTS,
  span: 1 / PARTS,
}));

const frame = new EffectFrame(
  planEffects(
    Array.from({ length: EFFECTS }, () => ({
      patch: flick,
      target: { kind: 'run' as const, by: 'index' as const, amount: 1 },
      stagger: 0.4,
    })),
    parts,
  ),
);

let now = 0;

describe('one frame of the mix', () => {
  bench(`${LETTERS} letters posed`, () => {
    now += 16;
    for (let i = 0; i < LETTERS; i++) {
      timeline.poseAt(now % 2400, letters[i] as LetterInfo, scratch[i]);
    }
  });

  bench(`${PARTS} parts resolved under ${EFFECTS} effects`, () => {
    now += 16;
    frame.resolve(parts, now, { pointer: null, pointerInWord: null, now });
  });
});

/**
 * The signal-driven patches, each as its own effect over the same parts, so a change to how a
 * signal keeps state or how `hinge` weighs a patch shows as its own row.
 */
const near1 = near({ radius: 3 });
const kicked = kicks({ radius: 3 });
const mains = power({ trip: { on: near1, at: 2 } });
const signalFrame = (patch: EffectPatch) =>
  new EffectFrame(
    planEffects(
      [{ patch, target: { kind: 'run' as const, by: 'index' as const, amount: 1 }, stagger: 0.4 }],
      parts,
    ),
  );
const signalFrames = {
  'hinge(dwell(near)) blend': signalFrame(hinge(dwell({ of: near1 }), flick)),
  'hinge(near) stops': signalFrame(hinge(near1, (k) => flicker({ unrest: k }))),
  'hinge(kicks) blend': signalFrame(hinge(kicked, flick)),
  'power with a trip': signalFrame(mains.patch),
};

describe('one frame of a signal-driven effect', () => {
  for (const [name, f] of Object.entries(signalFrames)) {
    bench(`${PARTS} parts under ${name}`, () => {
      now += 16;
      if (now % 320 === 0) kicked.kick({ x: (now / 16) % PARTS, y: 0 }, 1);
      const pointerInWord = { x: ((now / 16) % (PARTS * 10)) / 10, y: 0 };
      const host = { pointer: { x: 0, y: 0 }, pointerInWord, now };
      f.resolve(parts, now, host);
    });
  }
});
