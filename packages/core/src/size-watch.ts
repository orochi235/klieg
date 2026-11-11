import type { Stage } from './render/stage.js';

/**
 * A check to run once a frame, which calls `refit` when the stage's box has moved since the last
 * one it saw — once, however many resizes landed in between. A box with no area has nothing to
 * fit to, so the word keeps its last fit until the box comes back, which is a resize of its own.
 */
export function sizeWatch(stage: Stage, refit: () => void): () => void {
  let seen = stage.sizeVersion;
  return () => {
    if (stage.sizeVersion === seen) return;
    seen = stage.sizeVersion;
    const box = stage.measure();
    if (box.width > 0 && box.height > 0) refit();
  };
}
