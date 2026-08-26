import type { FrameCtx } from '../../src/effects/types.js';

export const NO_CTX: FrameCtx = { pointer: null, pointerInWord: null, dt: 16 };
export const AT: FrameCtx = {
  pointer: { x: 0.5, y: -0.5 },
  pointerInWord: { x: 1.2, y: 0.3 },
  dt: 16,
};
