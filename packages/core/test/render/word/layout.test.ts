import type * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LetterInfo } from '../../../src/motion/types.js';
import { pointerFrame } from '../../../src/pointer.js';
import { Word } from '../../../src/render/word.js';
import { DEFAULT_GLYPH_OPTIONS } from '../../../src/text/glyphs.js';
import type { Budget } from '../../../src/text/layout.js';
import { projectLetters } from '../../../src/text/projection.js';
import {
  drawn,
  groups,
  HOST,
  meshes,
  ROOMY,
  registerStubFace,
  STEP,
  stubFont,
  timelineOf,
} from './harness.js';

beforeAll(registerStubFace);

describe('Word as a block', () => {
  it('gives every line its own row of letters', () => {
    const word = new Word('AB\nCD', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(4);
    expect(meshes(word)).toHaveLength(4);
    expect(word.lineCount).toBe(2);
  });

  it('drops each line below the one above it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const [first, second] = groups(word);

    expect((second as THREE.Group).position.y).toBeLessThan((first as THREE.Group).position.y);
  });

  it('centers each line independently', () => {
    const word = new Word('AA\nB', stubFont(), 'gold', ROOMY);
    const [a1, a2, b] = groups(word);
    const rowCenter = ((a1 as THREE.Group).position.x + (a2 as THREE.Group).position.x) / 2;

    expect((b as THREE.Group).position.x).toBeCloseTo(rowCenter, 5);
  });

  it('adds pose y onto the line baseline instead of replacing it', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const before = groups(word).map((g) => g.position.y);

    word.apply(
      timelineOf(() => ({ position: [0, 1, 0] })),
      0,
      HOST,
    );

    const after = groups(word).map((g) => g.position.y);
    expect(after[0] as number).toBeCloseTo((before[0] as number) + 1, 5);
    expect(after[1] as number).toBeCloseTo((before[1] as number) + 1, 5);
    // The lines must stay apart; a replaced baseline collapses them onto one row.
    expect(after[0] as number).not.toBeCloseTo(after[1] as number, 5);
  });

  it('reports each letter its position in the block', () => {
    const word = new Word('AB\nC', stubFont(), 'gold', ROOMY);
    const seen: LetterInfo[] = [];

    word.apply(
      timelineOf((_phase, letter) => {
        seen.push(letter);
        return {};
      }),
      0,
      HOST,
    );

    expect(seen.map((l) => l.line)).toEqual([0, 0, 1]);
    expect(seen.map((l) => l.column)).toEqual([0, 1, 0]);
    expect(seen.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(seen[0]?.lineCount).toBe(2);
    expect(seen[0]?.columnCount).toBe(2);
  });

  it('wraps only when asked', () => {
    const narrow: Budget = { width: 1.2, height: 100 };

    expect(new Word('AA BB', stubFont(), 'gold', narrow, true).lineCount).toBeGreaterThan(1);
    expect(new Word('AA BB', stubFont(), 'gold', narrow, false).lineCount).toBe(1);
  });

  it('centers the block vertically, so a two-line block straddles the origin', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    const ys = groups(word).map((g) => word.group.position.y + word.group.scale.x * g.position.y);

    expect((ys[0] as number) > 0).toBe(true);
    expect((ys[1] as number) < 0).toBe(true);
  });

  it('a newline never reaches the glyph cache, so it draws no tofu', () => {
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);

    expect(word.letterCount).toBe(2);
    expect(meshes(word)).toHaveLength(2);
  });
});

describe('LetterInfo position', () => {
  it('hands each letter its laid-out position in em', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('AB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    // Glyph origins, centred on the advance span: 'AB' puts A at -STEP and B at 0.
    expect(seen[0]?.x).toBeCloseTo(-STEP);
    expect(seen[1]?.x).toBeCloseTo(0);
  });

  it('measures y from the block centre, so a single line sits at zero', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    // The stub's 'A' spans 0..0.7em, so its centre is 0.35 below the glyph origin.
    expect(seen[0]?.y).toBeCloseTo(-0.35);
  });

  it('separates two lines by one line height', () => {
    const seen: LetterInfo[] = [];
    const word = new Word('A\nB', stubFont(), 'gold', ROOMY);
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    expect((seen[0]?.y as number) - (seen[1]?.y as number)).toBeCloseTo(1.1);
  });
});

/**
 * The whole chain, end to end: a cursor over a letter on screen has to reach that letter's ink.
 * The unit tests either side of the mapping can both pass while the pair disagrees.
 */
describe('a cursor lands on the letter it is over', () => {
  const CANVAS = { left: 0, top: 0, width: 800, height: 400 };
  const CAMERA = { fov: 90, cameraZ: 4, aspect: 2, depth: 0, bevel: 0 };

  it.each([0, 1, 2, 3])('letter %i', (i) => {
    const word = new Word('HELLO', stubFont(), 'gold', { width: 6, height: 2 });
    const readout = word.readout();
    const projected = projectLetters({
      ...readout,
      ...CAMERA,
      width: CANVAS.width,
      height: CANVAS.height,
      baselineRatio: 0,
    });
    const box = projected.boxes[i] as { left: number; top: number };

    const frame = pointerFrame(
      CANVAS,
      { x: box.left, y: box.top },
      { fit: word.placement, ...CAMERA },
    );
    const aimed = frame.pointerInWord as { x: number; y: number };

    // The nearest part to where the cursor mapped is the one drawn under it.
    const parts = word.partsOf('body');
    const distances = parts.map((p) =>
      Math.hypot((p.ink.minX + p.ink.maxX) / 2 - aimed.x, (p.ink.minY + p.ink.maxY) / 2 - aimed.y),
    );
    const nearest = distances.indexOf(Math.min(...distances));

    expect(nearest).toBe(i);
  });
});

describe("a run's size", () => {
  /** Halves the second letter, the way a `size: 0.5` run does. */
  const half = (slot: number) => (slot === 1 ? 0.5 : 1);

  function sizedWord(): Word {
    return new Word(
      'AB',
      stubFont(),
      'gold',
      ROOMY,
      false,
      undefined,
      undefined,
      null,
      undefined,
      half,
    );
  }

  it('scales a run below the cell the pose writes', () => {
    const cell = groups(sizedWord())[1] as THREE.Group;

    expect(cell.scale.x).toBe(1);
    expect(drawn(cell).scale.x).toBeCloseTo(0.5);
  });

  it('keeps a sized letter at rest, so the selectable layer still aligns', () => {
    const word = sizedWord();
    word.apply(
      timelineOf(() => ({})),
      50,
      HOST,
    );

    expect(word.atRest()).toBe(true);
  });

  it('survives a pose, which writes the cell scale every frame', () => {
    const word = sizedWord();
    word.apply(
      timelineOf(() => ({})),
      50,
      HOST,
    );

    expect(drawn(groups(word)[1] as THREE.Group).scale.x).toBeCloseTo(0.5);
  });
});

describe('framing alignment', () => {
  /** 'AA' spans 1.2 em of advance; a 1.2-wide budget scales it by 1 and its outline ends at 0.5. */
  const START: Budget = { width: 1.2, height: 100, extent: 4, edge: 'left' };
  const END: Budget = { width: 1.2, height: 100, extent: 4, edge: 'right' };
  /**
   * Cap-bound, so the word is narrower than its budget. A width-bound fit lands the paint on
   * `-width / 2` whatever the letters are, which would leave a regroup nothing to move.
   */
  const LOOSE: Budget = { width: 100, height: 100, extent: 4, edge: 'left' };
  /** The bevel is lit geometry, so the paint runs this much wider than the glyph outline. */
  const BEVEL = DEFAULT_GLYPH_OPTIONS.bevelSize;

  it('leaves a centred word on the origin', () => {
    expect(new Word('AA', stubFont(), 'gold', ROOMY).group.position.x).toBe(0);
  });

  it('puts the leftmost paint on the box edge', () => {
    const word = new Word('AA', stubFont(), 'gold', START);

    expect(word.group.position.x + (-STEP - BEVEL) * word.group.scale.x).toBeCloseTo(-2, 6);
  });

  it('puts the rightmost paint on the box edge', () => {
    const word = new Word('AA', stubFont(), 'gold', END);

    expect(word.group.position.x + (0.5 + BEVEL) * word.group.scale.x).toBeCloseTo(2, 6);
  });

  it('meets the edge with the bevel, not with the outline it swells past', () => {
    const word = new Word('AA', stubFont(), 'gold', START);

    // Aligning the outline alone would leave the lit edge of the sign hanging over the box.
    expect(word.group.position.x + -STEP * word.group.scale.x).toBeGreaterThan(-2);
  });

  it('moves the alignment with the fit across a regroup', () => {
    const word = new Word('AA', stubFont(), 'gold', LOOSE);
    const before = word.group.position.x;
    expect(before + (-STEP - BEVEL) * word.group.scale.x).toBeCloseTo(-2, 6);

    word.regroup((letter) => letter.index === 0);
    word.setFitProgress(0);
    expect(word.group.position.x).toBeCloseTo(before, 6);

    word.setFitProgress(1);
    const after = word.group.position.x;
    // One letter re-centres, so its paint starts half an advance nearer the origin.
    expect(after + (-STEP / 2 - BEVEL) * word.group.scale.x).toBeCloseTo(-2, 6);
    expect(after).not.toBeCloseTo(before, 6);

    word.setFitProgress(0.5);
    expect(word.group.position.x).toBeCloseTo((before + after) / 2, 6);
  });

  it('is not at rest until the alignment has landed', () => {
    const word = new Word('AA', stubFont(), 'gold', LOOSE);
    word.regroup((letter) => letter.index === 0);
    // The survivor onto its new layout position, the way a finished timeline leaves it.
    word.apply(
      timelineOf(() => ({})),
      0,
      HOST,
    );

    word.setFitProgress(0.5);
    expect(word.atRest()).toBe(false);

    word.setFitProgress(1);
    expect(word.atRest()).toBe(true);
  });

  it('reports the offset in the readout the text layer projects from', () => {
    const word = new Word('AA', stubFont(), 'gold', START);

    expect(word.readout().fit.offsetX).toBe(word.group.position.x);
  });
});

describe('a fitted scale override', () => {
  function forced(text: string, budget: Budget, fitScale: number): Word {
    // biome-ignore format: the trailing options are easier to read against the positional tail
    return new Word(text, stubFont(), 'gold', budget, false, undefined, undefined, null, undefined, undefined, undefined, { fitScale });
  }

  it('takes the scale it is given instead of the one the budget would fit', () => {
    const fitted = new Word('AA', stubFont(), 'gold', ROOMY);
    const word = forced('AA', ROOMY, fitted.placement.scale * 1.6);

    expect(word.placement.scale).toBeCloseTo(fitted.placement.scale * 1.6, 10);
    expect(word.group.scale.x).toBeCloseTo(fitted.placement.scale * 1.6, 10);
  });

  it('centres on its own block, so the override changes the size and not the placing', () => {
    const rows = 'AA\nAA\nAA';
    const fitted = new Word(rows, stubFont(), 'gold', ROOMY);
    const word = forced(rows, ROOMY, 0.5);

    expect(word.placement.midY).toBe(fitted.placement.midY);
    expect(word.group.position.y).toBeCloseTo(-fitted.placement.midY * 0.5, 10);
  });

  it('places the aligned edge at the forced scale, not the fitted one', () => {
    const LEFT: Budget = { width: 100, height: 100, extent: 200, edge: 'left' };
    const fitted = new Word('AA', stubFont(), 'gold', LEFT);

    // The painted left edge meets the box either way, so a different scale needs a different offset.
    expect(forced('AA', LEFT, fitted.placement.scale / 2).placement.offsetX).not.toBeCloseTo(
      fitted.placement.offsetX,
      6,
    );
  });
});
