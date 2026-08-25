import { describe, expect, it } from 'vitest';
import { type ProjectionInput, projectLetters } from '../../src/text/projection.js';

const UPEM = 1000;

/** A 90° lens at z = 1 sees exactly 2 world units of height, so px-per-world is height / 2. */
function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    chars: ['A'],
    x: [0],
    y: [0],
    fit: { scale: 1, midY: 0 },
    fov: 90,
    cameraZ: 1,
    depth: 0,
    width: 800,
    height: 400,
    ascender: 800,
    descender: -200,
    unitsPerEm: UPEM,
    ...over,
  };
}

describe('projectLetters', () => {
  it('scales one em to the pixels one world unit covers', () => {
    // vh = 2 * tan(45°) * 1 = 2; pxPerWorld = 400 / 2 = 200. One em is fit.scale world units.
    expect(projectLetters(input()).fontSize).toBeCloseTo(200, 6);
    expect(projectLetters(input({ fit: { scale: 0.5, midY: 0 } })).fontSize).toBeCloseTo(100, 6);
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

  it('flips the y axis: a lower layout row lands further down the page', () => {
    const boxes = projectLetters(input({ chars: ['A', 'B'], x: [0, 0], y: [0, -1] })).boxes;
    expect((boxes[1]?.top ?? 0) - (boxes[0]?.top ?? 0)).toBeCloseTo(200, 6);
  });

  it('centres the block vertically through fit.midY, as applyFit does', () => {
    const centred = projectLetters(input({ y: [0.5], fit: { scale: 1, midY: 0.5 } })).boxes[0];
    const origin = projectLetters(input()).boxes[0];
    expect(centred?.top).toBeCloseTo(origin?.top ?? 0, 6);
  });

  it('places the box top a baseline above, not at, the letter position', () => {
    // fontSize 200; content height = (800 + 200)/1000 * 200 = 200, so halfLeading = 0.
    // Baseline sits ascender/upem * fontSize = 160px below the box top.
    const box = projectLetters(input()).boxes[0];
    expect(box?.top).toBeCloseTo(200 - 160, 6);
  });

  it('adds half-leading when the font does not fill its em box', () => {
    // content height = (800 + 0)/1000 * 200 = 160, so halfLeading = (200 - 160)/2 = 20.
    const box = projectLetters(input({ descender: 0 })).boxes[0];
    expect(box?.top).toBeCloseTo(200 - 20 - 160, 6);
  });

  it('projects at the extruded front face, not the word plane', () => {
    // depth 0.3 em at fit.scale 1 puts the front face 0.15 nearer: vh = 2 * 0.85 = 1.7.
    const near = projectLetters(input({ depth: 0.3 }));
    expect(near.fontSize).toBeCloseTo(400 / 1.7, 6);
    expect(near.fontSize).toBeGreaterThan(projectLetters(input()).fontSize);
  });

  it('keeps the char alongside each box', () => {
    expect(projectLetters(input({ chars: ['Q'] })).boxes[0]?.char).toBe('Q');
  });
});
