import * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { collectionFaces, isFontCollection, sfntFromCollection } from '../../src/text/sfnt.js';
import { collectionOf, readFont as read } from './collection-fixture.js';

/** opentype 2.0 files names under the platform that carried them; these fonts are Windows-only. */
const psName = (bytes: ArrayBuffer): string =>
  (opentype.parse(bytes).names as unknown as Record<string, Record<string, Record<string, string>>>)
    .windows?.postScriptName?.en as string;

const anton = read('anton.ttf');
const cinzel = read('cinzel.ttf');
const ttc = collectionOf(anton, cinzel);

describe('isFontCollection', () => {
  it('recognizes a ttcf', () => {
    expect(isFontCollection(ttc)).toBe(true);
  });

  it('leaves a single font alone', () => {
    expect(isFontCollection(anton)).toBe(false);
  });
});

describe('collectionFaces', () => {
  it('lists the members in file order', () => {
    expect(collectionFaces(ttc)).toEqual(['Anton-Regular', 'Cinzel-Regular']);
  });

  it('is empty for a single font, which has no members', () => {
    expect(collectionFaces(anton)).toEqual([]);
  });
});

describe('sfntFromCollection', () => {
  it('extracts a member opentype can parse', () => {
    const { bytes, matched } = sfntFromCollection(ttc, 'Cinzel-Regular');
    expect(matched).toBe(true);
    expect(psName(bytes)).toBe('Cinzel-Regular');
  });

  it('preserves the glyphs, since table bytes are copied rather than re-encoded', () => {
    const direct = opentype.parse(cinzel);
    const viaTtc = opentype.parse(sfntFromCollection(ttc, 'Cinzel-Regular').bytes);
    expect(viaTtc.charToGlyph('A').advanceWidth).toBe(direct.charToGlyph('A').advanceWidth);
    expect(viaTtc.unitsPerEm).toBe(direct.unitsPerEm);
  });

  it('picks the member asked for, not merely some member', () => {
    const first = opentype.parse(sfntFromCollection(ttc, 'Anton-Regular').bytes);
    const second = opentype.parse(sfntFromCollection(ttc, 'Cinzel-Regular').bytes);
    expect(first.charToGlyph('A').advanceWidth).not.toBe(second.charToGlyph('A').advanceWidth);
  });

  it('passes a single font straight through', () => {
    expect(sfntFromCollection(anton).bytes).toBe(anton);
  });

  it('falls back to the first member and says it did not match', () => {
    const { bytes, matched } = sfntFromCollection(ttc, 'Nothing-Regular');
    expect(matched).toBe(false);
    expect(psName(bytes)).toBe('Anton-Regular');
  });
});
