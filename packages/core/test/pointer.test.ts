import { describe, expect, it } from 'vitest';
import { pointerFrame, type WordExtent } from '../src/pointer.js';

const BOX = { left: 0, top: 0, width: 100, height: 100 };
/** Two lines of a wide word: wider than the box's -1..1 and with real vertical extent. */
const WORD: WordExtent = { minX: -3, maxX: 3, minY: -1.4, maxY: 0.7 };

describe('pointerFrame', () => {
  it('rests until a pointer has been seen', () => {
    expect(pointerFrame(BOX, null, WORD)).toEqual({ pointer: null, pointerInWord: null });
  });

  it('rests when there is no canvas to measure against', () => {
    expect(pointerFrame(null, { x: 40, y: 40 }, WORD).pointer).toBeNull();
    expect(pointerFrame(undefined, { x: 40, y: 40 }, WORD).pointer).toBeNull();
  });

  // A display:none ancestor, or a frame before layout has run.
  it('rests against a box with no area rather than dividing by it', () => {
    expect(pointerFrame({ ...BOX, width: 0 }, { x: 40, y: 40 }, WORD).pointer).toBeNull();
    expect(pointerFrame({ ...BOX, height: 0 }, { x: 40, y: 40 }, WORD).pointer).toBeNull();
  });

  it('normalizes the box to -1..1, corner to corner', () => {
    expect(pointerFrame(BOX, { x: 0, y: 0 }, WORD).pointer).toEqual({ x: -1, y: -1 });
    expect(pointerFrame(BOX, { x: 50, y: 50 }, WORD).pointer).toEqual({ x: 0, y: 0 });
    expect(pointerFrame(BOX, { x: 100, y: 100 }, WORD).pointer).toEqual({ x: 1, y: 1 });
  });

  it('measures from the box, not the origin', () => {
    const moved = { left: 200, top: 40, width: 100, height: 100 };

    expect(pointerFrame(moved, { x: 250, y: 90 }, WORD).pointer).toEqual({ x: 0, y: 0 });
  });

  it('clamps a pointer outside the box, which a document-wide listener reports', () => {
    const far = pointerFrame(BOX, { x: 900, y: -400 }, WORD).pointer;

    expect(far).toEqual({ x: 1, y: -1 });
  });

  it('spreads the pointer across the word rather than over -1..1', () => {
    const left = pointerFrame(BOX, { x: 0, y: 50 }, WORD).pointerInWord;
    const right = pointerFrame(BOX, { x: 100, y: 50 }, WORD).pointerInWord;

    expect(left?.x).toBeCloseTo(WORD.minX, 6);
    expect(right?.x).toBeCloseTo(WORD.maxX, 6);
  });

  // clientY grows downward and layout y grows upward. Getting this backwards moves the light
  // pool opposite the cursor on a multi-line sign, which no single-line test can see.
  it('puts the top of the canvas at the top of the word', () => {
    const top = pointerFrame(BOX, { x: 50, y: 0 }, WORD).pointerInWord;
    const bottom = pointerFrame(BOX, { x: 50, y: 100 }, WORD).pointerInWord;

    expect(top?.y).toBeCloseTo(WORD.maxY, 6);
    expect(bottom?.y).toBeCloseTo(WORD.minY, 6);
  });

  it('keeps the canvas pointer but drops pointerInWord for a pool with no parts', () => {
    const out = pointerFrame(BOX, { x: 40, y: 40 }, null);

    expect(out.pointer).not.toBeNull();
    // fromPointer reads null as rest, which beats mapping every position onto one constant.
    expect(out.pointerInWord).toBeNull();
  });

  it('drops pointerInWord for an extent with no area on either axis', () => {
    const flat = { minX: 0, maxX: 0, minY: -1, maxY: 1 };
    const thin = { minX: -1, maxX: 1, minY: 0.5, maxY: 0.5 };

    expect(pointerFrame(BOX, { x: 40, y: 40 }, flat).pointerInWord).toBeNull();
    expect(pointerFrame(BOX, { x: 40, y: 40 }, thin).pointerInWord).toBeNull();
  });

  it('hands back a fresh rest rather than one shared object a caller could write through', () => {
    const a = pointerFrame(BOX, null, WORD);
    const b = pointerFrame(BOX, null, WORD);

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
