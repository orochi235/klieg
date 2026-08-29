import { describe, expect, it } from 'vitest';
import { type ProjectionInput, projectLetters } from '../../src/text/projection.js';

/** A 90° lens at z = 1 sees exactly 2 world units of height, so px-per-world is height / 2. */
function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    chars: ['A'],
    x: [0],
    y: [0],
    line: [0],
    fit: { scale: 1, midY: 0, offsetX: 0 },
    fov: 90,
    cameraZ: 1,
    depth: 0,
    bevel: 0,
    aspect: 2,
    width: 800,
    height: 400,
    baselineRatio: 0.8,
    ...over,
  };
}

describe('projectLetters', () => {
  it('scales one em to the pixels one world unit covers', () => {
    // vh = 2 * tan(45°) * 1 = 2; pxPerWorld = 400 / 2 = 200. One em is fit.scale world units.
    expect(projectLetters(input()).fontSize).toBeCloseTo(200, 6);
    expect(
      projectLetters(input({ fit: { scale: 0.5, midY: 0, offsetX: 0 } })).fontSize,
    ).toBeCloseTo(100, 6);
  });

  it('puts a letter at the layout origin on the canvas centre line', () => {
    const box = projectLetters(input()).boxes[0];
    expect(box?.left).toBeCloseTo(400, 6);
  });

  it('carries the layout x across, scaled by the fit', () => {
    const boxes = projectLetters(input({ chars: ['A', 'B'], x: [0, 0.5], y: [0, 0] })).boxes;
    // 0.5 em * fit.scale 1 = 0.5 world units = 100px right of centre.
    expect(boxes[1]?.left).toBeCloseTo(500, 6);
  });

  it('takes x from the camera aspect, and leaves y out of it', () => {
    const over = { chars: ['A', 'B'], x: [0, 0.5], y: [0, -1], line: [0, 1] };
    // The lens still sees 2 world units of height; a square one sees 2 across, a 2:1 one sees 4.
    const square = projectLetters(input({ ...over, aspect: 1 })).boxes[1];
    const wide = projectLetters(input({ ...over, aspect: 2 })).boxes[1];

    expect(square?.left).toBeCloseTo(600, 6);
    expect(wide?.left).toBeCloseTo(500, 6);
    expect(square?.top).toBeCloseTo(wide?.top ?? 0, 6);
  });

  it('flips the y axis: a lower layout row lands further down the page', () => {
    const boxes = projectLetters(input({ chars: ['A', 'B'], x: [0, 0], y: [0, -1] })).boxes;
    expect((boxes[1]?.top ?? 0) - (boxes[0]?.top ?? 0)).toBeCloseTo(200, 6);
  });

  it('centres the block vertically through fit.midY, as applyFit does', () => {
    const centred = projectLetters(input({ y: [0.5], fit: { scale: 1, midY: 0.5, offsetX: 0 } }))
      .boxes[0];
    const origin = projectLetters(input()).boxes[0];
    expect(centred?.top).toBeCloseTo(origin?.top ?? 0, 6);
  });

  it('places the box top a baseline above, not at, the letter position', () => {
    // fontSize 200, so a 0.8 ratio puts the baseline 160px below the box top.
    const box = projectLetters(input()).boxes[0];
    expect(box?.top).toBeCloseTo(200 - 160, 6);
  });

  it('scales the baseline offset with the font size', () => {
    // Half the fit is half the font size, so the same ratio is an 80px drop.
    const box = projectLetters(input({ fit: { scale: 0.5, midY: 0, offsetX: 0 } })).boxes[0];
    expect(box?.top).toBeCloseTo(200 - 80, 6);
  });

  it('projects at the extruded front cap, not the word plane', () => {
    // depth 0.3 em at fit.scale 1 puts the front cap 0.3 nearer: vh = 2 * 0.7 = 1.4.
    const near = projectLetters(input({ depth: 0.3 }));
    expect(near.fontSize).toBeCloseTo(400 / 1.4, 6);
    expect(near.fontSize).toBeGreaterThan(projectLetters(input()).fontSize);
  });

  it('counts the bevel, which three lays outside the extrusion rather than inside it', () => {
    // The cap sits at depth + bevel = 0.355, so vh = 2 * 0.645, not the 2 * 0.7 depth alone gives.
    const capped = projectLetters(input({ depth: 0.3, bevel: 0.055 }));
    expect(capped.fontSize).toBeCloseTo(400 / 1.29, 6);
    expect(capped.fontSize).toBeGreaterThan(projectLetters(input({ depth: 0.3 })).fontSize);
  });

  it('leaves the spans unstretched while the camera and the canvas box agree', () => {
    // The fixture's aspect 2 is exactly its 800x400 box, which is the case in every real overlay.
    expect(projectLetters(input()).scaleX).toBeCloseTo(1, 12);
  });

  it('stretches the spans by however far the camera aspect has left the canvas box', () => {
    // px-per-world-x = 800 / (vh * 4), px-per-world-y = 400 / vh, so the spans want half the width
    // the font size alone would give them.
    expect(projectLetters(input({ aspect: 4 })).scaleX).toBeCloseTo(0.5, 12);
    expect(projectLetters(input({ aspect: 1 })).scaleX).toBeCloseTo(2, 12);
  });

  it('keeps the char and its line alongside each box', () => {
    const boxes = projectLetters(
      input({ chars: ['Q', 'R'], x: [0, 0], y: [0, -1], line: [0, 1] }),
    ).boxes;
    expect(boxes[0]?.char).toBe('Q');
    expect([boxes[0]?.line, boxes[1]?.line]).toEqual([0, 1]);
  });
});

describe('a word the framing has aligned', () => {
  it('shifts every box by the fit offset, in the pixels one world unit covers', () => {
    // pxPerWorldX is 800 / (2 * 2) = 200, so half a world unit is 100px.
    const boxes = projectLetters(
      input({
        chars: ['A', 'B'],
        x: [0, 0.5],
        y: [0, 0],
        fit: { scale: 1, midY: 0, offsetX: 0.5 },
      }),
    ).boxes;

    expect(boxes[0]?.left).toBeCloseTo(500, 6);
    expect(boxes[1]?.left).toBeCloseTo(600, 6);
  });

  it('leaves an unaligned word where it was', () => {
    expect(projectLetters(input()).boxes[0]?.left).toBeCloseTo(400, 6);
  });
});
