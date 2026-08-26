/** The ink bounding box of a word's part pool, in its own layout space. `Word.partExtent`
 * returns this; it lives here so the mapping below has no render dependency. */
export interface WordExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PointerFrame {
  pointer: { x: number; y: number } | null;
  pointerInWord: { x: number; y: number } | null;
}

/**
 * Places the cursor for one frame: normalized over the canvas box, and again in the word's own
 * layout space. `box` is the canvas' client rect and `client` the last pointer position seen,
 * both in CSS pixels; `extent` is the word's ink box, or null before any part exists.
 */
export function pointerFrame(
  box: { left: number; top: number; width: number; height: number } | null | undefined,
  client: { x: number; y: number } | null,
  extent: WordExtent | null,
): PointerFrame {
  if (!client || !box || box.width <= 0 || box.height <= 0) {
    return { pointer: null, pointerInWord: null };
  }

  const nx = ((client.x - box.left) / box.width) * 2 - 1;
  const ny = ((client.y - box.top) / box.height) * 2 - 1;
  // FrameCtx promises -1..1, and the listener is document-wide: a pointer beside a small
  // anchored canvas would otherwise aim past every range that scales it.
  const pointer = { x: Math.max(-1, Math.min(1, nx)), y: Math.max(-1, Math.min(1, ny)) };

  // A degenerate extent maps every pointer position onto one constant, which reads as tracking
  // and is not; null is `fromPointer`'s rest.
  if (!extent || extent.maxX <= extent.minX || extent.maxY <= extent.minY) {
    return { pointer, pointerInWord: null };
  }

  return {
    pointer,
    pointerInWord: {
      // The word is not centred on zero, so map into its real extent rather than scaling.
      x: extent.minX + ((pointer.x + 1) / 2) * (extent.maxX - extent.minX),
      // clientY grows downward and layout y grows upward, so the axis flips on the way in.
      y: extent.maxY - ((pointer.y + 1) / 2) * (extent.maxY - extent.minY),
    },
  };
}
