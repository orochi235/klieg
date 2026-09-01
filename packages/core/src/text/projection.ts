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
  fit: { scale: number; midY: number; offsetX: number };
  /** Vertical field of view, in degrees. */
  fov: number;
  cameraZ: number;
  /** Extrusion depth in em. */
  depth: number;
  /** Bevel thickness in em. three lays the bevel outside the extrusion, not inside it. */
  bevel: number;
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
  /**
   * Horizontal stretch the spans need, as px-per-world-x over px-per-world-y. `fontSize` can only
   * carry one of the two, so where the camera's aspect and the canvas box disagree the letters
   * land at the right x with the wrong width. 1 wherever they agree.
   */
  scaleX: number;
}

/** What places layout em in the frustum: the word's fit, and the camera looking at it. */
export interface PlacedWord {
  fit: { scale: number; midY: number; offsetX: number };
  fov: number;
  cameraZ: number;
  aspect: number;
  depth: number;
  bevel: number;
}

/** Visible height in world units at the letters' front face. */
function faceHeight(input: PlacedWord): number {
  // three extrudes a shape from z = -bevel to z = depth + bevel, so the front cap clears the
  // nominal depth by a bevel thickness. Measuring to `depth` puts the plane behind the face.
  const faceDistance = input.cameraZ - (input.depth + input.bevel) * input.fit.scale;
  return 2 * Math.tan((input.fov * Math.PI) / 360) * faceDistance;
}

/**
 * A -1..1 point over the canvas, back in the layout em `Word` holds — the inverse of the map
 * `projectLetters` applies. Keeping the pair in one file is the point: a lamp aimed through a
 * mapping that has drifted from the one that drew the letters lands where they are not.
 */
export function layoutFromNdc(nx: number, ny: number, input: PlacedWord): { x: number; y: number } {
  const vh = faceHeight(input);
  const scale = input.fit.scale;
  return {
    x: ((nx * vh * input.aspect) / 2 - input.fit.offsetX) / scale,
    // NDC grows downward and layout grows upward.
    y: (-ny * vh) / 2 / scale + input.fit.midY,
  };
}

/**
 * The em-to-pixel map for a front-on, untransformed word. Every letter shares one z, so this is a
 * scale and a translate rather than a per-frame matrix.
 */
export function projectLetters(input: ProjectionInput): Projection {
  const vh = faceHeight(input);
  const pxPerWorldY = input.height / vh;
  const pxPerWorldX = input.width / (vh * input.aspect);
  const fontSize = input.fit.scale * pxPerWorldY;
  const baselineFromTop = input.baselineRatio * fontSize;

  const boxes = input.chars.map((char, i) => {
    const worldX = (input.x[i] ?? 0) * input.fit.scale + input.fit.offsetX;
    const worldY = ((input.y[i] ?? 0) - input.fit.midY) * input.fit.scale;
    return {
      char,
      line: input.line[i] ?? 0,
      left: input.width / 2 + worldX * pxPerWorldX,
      top: input.height / 2 - worldY * pxPerWorldY - baselineFromTop,
    };
  });

  return { fontSize, boxes, scaleX: pxPerWorldX / pxPerWorldY };
}
