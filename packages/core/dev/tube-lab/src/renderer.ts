import { LabRenderer } from '@shared/lab-renderer.js';

interface Held {
  lab: LabRenderer;
  width: number;
  height: number;
}

/**
 * One renderer per surface buffer, shared by every trial painting into it: a WebGL context per trial would hit the
 * browser's cap of around a dozen. Kept as long as the canvas is, since a renderer disposed when its last trial
 * closes loses the context, and the canvas could never be drawn into again.
 */
const held = new WeakMap<HTMLCanvasElement, Held>();

export interface SharedRenderer {
  lab: LabRenderer;
  /** Sizes the renderer to the surface, once per change. True when it resized, which blanks the buffer. */
  fit(size: { width: number; height: number }): boolean;
}

export function sharedRenderer(canvas: HTMLCanvasElement): SharedRenderer {
  let entry = held.get(canvas);
  if (!entry) {
    entry = { lab: new LabRenderer(canvas), width: 0, height: 0 };
    held.set(canvas, entry);
  }
  const it = entry;
  return {
    lab: it.lab,
    fit: ({ width, height }) => {
      if (it.width === width && it.height === height) return false;
      it.width = width;
      it.height = height;
      it.lab.resize(width, height);
      return true;
    },
  };
}
