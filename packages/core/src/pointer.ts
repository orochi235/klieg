import { layoutFromNdc, type PlacedWord } from './text/projection.js';

export interface PointerFrame {
  pointer: { x: number; y: number } | null;
  pointerInWord: { x: number; y: number } | null;
}

/**
 * Places the cursor for one frame: normalized over the canvas box, and again in the word's own
 * layout space. `box` is the canvas' client rect and `client` the last pointer position seen,
 * both in CSS pixels; `placed` is the fit and camera that put the word on screen, or null before
 * it has one.
 */
export function pointerFrame(
  box: { left: number; top: number; width: number; height: number } | null | undefined,
  client: { x: number; y: number } | null,
  placed: PlacedWord | null,
): PointerFrame {
  if (!client || !box || box.width <= 0 || box.height <= 0) {
    return { pointer: null, pointerInWord: null };
  }

  const nx = ((client.x - box.left) / box.width) * 2 - 1;
  const ny = ((client.y - box.top) / box.height) * 2 - 1;
  // FrameCtx promises -1..1, and the listener is document-wide: a pointer beside a small
  // anchored canvas would otherwise aim past every range that scales it.
  const pointer = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };

  // A collapsed fit divides every position by zero; null is `fromPointer`'s rest.
  if (!placed || placed.fit.scale <= 0) return { pointer, pointerInWord: null };

  return { pointer, pointerInWord: layoutFromNdc(pointer.x, pointer.y, placed) };
}
