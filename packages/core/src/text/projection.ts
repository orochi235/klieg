/** Where one letter's CSS box goes, in pixels from the canvas box's top-left. */
export interface LetterBox {
  char: string;
  left: number;
  top: number;
}

export interface ProjectionInput {
  chars: readonly string[];
  /** Layout x per letter, in em, as `Word` holds it. */
  x: readonly number[];
  /** Layout y per letter, in em, before the block's vertical centring. */
  y: readonly number[];
  fit: { scale: number; midY: number };
  /** Vertical field of view, in degrees. */
  fov: number;
  cameraZ: number;
  /** Extrusion depth in em. */
  depth: number;
  /** The canvas CSS box, not its drawing buffer. */
  width: number;
  height: number;
  /** Font units, from the opentype face. */
  ascender: number;
  descender: number;
  unitsPerEm: number;
}

export interface Projection {
  fontSize: number;
  boxes: LetterBox[];
}

/**
 * The em-to-pixel map for a front-on, untransformed word. Every letter shares one z, so this is a
 * uniform scale and a translate rather than a per-frame matrix.
 */
export function projectLetters(input: ProjectionInput): Projection {
  // The front face, not the word plane: a letter is extruded toward the camera by half its depth.
  const faceZ = input.cameraZ - (input.depth / 2) * input.fit.scale;
  const vh = 2 * Math.tan((input.fov * Math.PI) / 360) * faceZ;
  const pxPerWorld = input.height / vh;
  const fontSize = input.fit.scale * pxPerWorld;

  // CSS positions a box top; the layout gives a baseline. At line-height 1 the gap is the
  // half-leading plus the ascender.
  const contentHeight = ((input.ascender - input.descender) / input.unitsPerEm) * fontSize;
  const baselineFromTop =
    (fontSize - contentHeight) / 2 + (input.ascender / input.unitsPerEm) * fontSize;

  const boxes = input.chars.map((char, i) => {
    const worldX = (input.x[i] ?? 0) * input.fit.scale;
    const worldY = ((input.y[i] ?? 0) - input.fit.midY) * input.fit.scale;
    return {
      char,
      left: input.width / 2 + worldX * pxPerWorld,
      top: input.height / 2 - worldY * pxPerWorld - baselineFromTop,
    };
  });

  return { fontSize, boxes };
}
