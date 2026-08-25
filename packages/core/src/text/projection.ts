/** Where one letter's CSS box goes, in pixels from the canvas box's top-left. */
export interface LetterBox {
  char: string;
  /** Which layout line the letter is on, so a caller can break the copied text between them. */
  line: number;
  left: number;
  top: number;
}

export interface ProjectionInput {
  chars: readonly string[];
  /** Layout x per letter, in em, as `Word` holds it. */
  x: readonly number[];
  /** Layout y per letter, in em, before the block's vertical centring. */
  y: readonly number[];
  /** Layout line per letter, as `Word` holds it. */
  line: readonly number[];
  fit: { scale: number; midY: number };
  /** Vertical field of view, in degrees. */
  fov: number;
  cameraZ: number;
  /** Extrusion depth in em. */
  depth: number;
  /** The camera's own aspect, which need not match `width / height`. */
  aspect: number;
  /** The canvas CSS box, not its drawing buffer. */
  width: number;
  height: number;
  /** Box top to baseline at `line-height: 1`, as a fraction of the font size. */
  baselineRatio: number;
}

export interface Projection {
  fontSize: number;
  boxes: LetterBox[];
}

/**
 * The em-to-pixel map for a front-on, untransformed word. Every letter shares one z, so this is a
 * scale and a translate rather than a per-frame matrix.
 */
export function projectLetters(input: ProjectionInput): Projection {
  // three extrudes a shape from z = 0 to z = +depth, so the shape plane is the letter's back and
  // its flat front cap is a whole depth toward the camera.
  const faceDistance = input.cameraZ - input.depth * input.fit.scale;
  const vh = 2 * Math.tan((input.fov * Math.PI) / 360) * faceDistance;
  const pxPerWorldY = input.height / vh;
  const pxPerWorldX = input.width / (vh * input.aspect);
  const fontSize = input.fit.scale * pxPerWorldY;
  const baselineFromTop = input.baselineRatio * fontSize;

  const boxes = input.chars.map((char, i) => {
    const worldX = (input.x[i] ?? 0) * input.fit.scale;
    const worldY = ((input.y[i] ?? 0) - input.fit.midY) * input.fit.scale;
    return {
      char,
      line: input.line[i] ?? 0,
      left: input.width / 2 + worldX * pxPerWorldX,
      top: input.height / 2 - worldY * pxPerWorldY - baselineFromTop,
    };
  });

  return { fontSize, boxes };
}
