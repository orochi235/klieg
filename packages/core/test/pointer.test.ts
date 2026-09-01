import { describe, expect, it } from 'vitest';
import { pointerFrame } from '../src/pointer.js';
import type { PlacedWord } from '../src/text/projection.js';

const BOX = { left: 0, top: 0, width: 100, height: 100 };
/** A 90° lens at z = 1 sees 2 world units of height, and at aspect 1, 2 of width. */
const PLACED: PlacedWord = {
  fit: { scale: 1, midY: 0, offsetX: 0 },
  fov: 90,
  cameraZ: 1,
  aspect: 1,
  depth: 0,
  bevel: 0,
};

describe('pointerFrame', () => {
  it('rests until a pointer has been seen', () => {
    expect(pointerFrame(BOX, null, PLACED)).toEqual({ pointer: null, pointerInWord: null });
  });

  it('rests when there is no canvas to measure against', () => {
    expect(pointerFrame(null, { x: 40, y: 40 }, PLACED).pointer).toBeNull();
    expect(pointerFrame(undefined, { x: 40, y: 40 }, PLACED).pointer).toBeNull();
  });

  // A display:none ancestor, or a frame before layout has run.
  it('rests against a box with no area rather than dividing by it', () => {
    expect(pointerFrame({ ...BOX, width: 0 }, { x: 40, y: 40 }, PLACED).pointer).toBeNull();
    expect(pointerFrame({ ...BOX, height: 0 }, { x: 40, y: 40 }, PLACED).pointer).toBeNull();
  });

  it('normalizes the box to -1..1, corner to corner', () => {
    expect(pointerFrame(BOX, { x: 0, y: 0 }, PLACED).pointer).toEqual({ x: -1, y: -1 });
    expect(pointerFrame(BOX, { x: 50, y: 50 }, PLACED).pointer).toEqual({ x: 0, y: 0 });
    expect(pointerFrame(BOX, { x: 100, y: 100 }, PLACED).pointer).toEqual({ x: 1, y: 1 });
  });

  it('measures from the box, not the origin', () => {
    const moved = { left: 200, top: 40, width: 100, height: 100 };

    expect(pointerFrame(moved, { x: 250, y: 90 }, PLACED).pointer).toEqual({ x: 0, y: 0 });
  });

  it('clamps a pointer outside the box, which a document-wide listener reports', () => {
    const far = pointerFrame(BOX, { x: 900, y: -400 }, PLACED).pointer;

    expect(far).toEqual({ x: 1, y: -1 });
  });

  // The bug this replaces: the canvas' -1..1 was stretched across the word's ink, so the light
  // reached the word's left edge while the cursor was still at the canvas' edge.
  it('maps the cursor through what the camera sees, not through the word', () => {
    const left = pointerFrame(BOX, { x: 0, y: 50 }, PLACED).pointerInWord;
    const right = pointerFrame(BOX, { x: 100, y: 50 }, PLACED).pointerInWord;

    expect(left?.x).toBeCloseTo(-1, 6);
    expect(right?.x).toBeCloseTo(1, 6);
  });

  it('does not move with the width of the word under it', () => {
    const wide = pointerFrame(BOX, { x: 25, y: 50 }, PLACED).pointerInWord;
    const same = pointerFrame(BOX, { x: 25, y: 50 }, { ...PLACED }).pointerInWord;

    expect(wide?.x).toBeCloseTo(-0.5, 6);
    expect(same?.x).toBeCloseTo(-0.5, 6);
  });

  it('follows the block when alignment moves it off the frustum axis', () => {
    const shifted = { ...PLACED, fit: { scale: 1, midY: 0, offsetX: 0.4 } };
    const middle = pointerFrame(BOX, { x: 50, y: 50 }, shifted).pointerInWord;

    expect(middle?.x).toBeCloseTo(-0.4, 6);
  });

  // clientY grows downward and layout y grows upward. Getting this backwards moves the light
  // pool opposite the cursor on a multi-line sign, which no single-line test can see.
  it('puts the top of the canvas at the top of the word', () => {
    const top = pointerFrame(BOX, { x: 50, y: 0 }, PLACED).pointerInWord;
    const bottom = pointerFrame(BOX, { x: 50, y: 100 }, PLACED).pointerInWord;

    expect(top?.y).toBeCloseTo(1, 6);
    expect(bottom?.y).toBeCloseTo(-1, 6);
  });

  it('keeps the canvas pointer but drops pointerInWord before the word has a fit', () => {
    const out = pointerFrame(BOX, { x: 40, y: 40 }, null);

    expect(out.pointer).not.toBeNull();
    // fromPointer reads null as rest, which beats mapping every position onto one constant.
    expect(out.pointerInWord).toBeNull();
  });

  it('drops pointerInWord for a fit that has collapsed rather than dividing by it', () => {
    const flat = { ...PLACED, fit: { scale: 0, midY: 0, offsetX: 0 } };

    expect(pointerFrame(BOX, { x: 40, y: 40 }, flat).pointerInWord).toBeNull();
  });

  it('hands back a fresh rest rather than one shared object a caller could write through', () => {
    const a = pointerFrame(BOX, null, PLACED);
    const b = pointerFrame(BOX, null, PLACED);

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
