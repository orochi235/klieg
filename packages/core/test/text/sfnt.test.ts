import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { collectionFaces, isFontCollection, sfntFromCollection } from '../../src/text/sfnt.js';

/** opentype 2.0 files names under the platform that carried them; these fonts are Windows-only. */
const psName = (bytes: ArrayBuffer) => opentype.parse(bytes).names.windows.postScriptName.en;

function read(name: string): ArrayBuffer {
  const buf = readFileSync(new URL(`../../../../apps/lab/public/fonts/${name}`, import.meta.url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const SFNT_HEADER = 12;
const TABLE_RECORD = 16;
const pad = (n: number) => (n + 3) & ~3;

/**
 * Packs standalone fonts into one `ttcf`: N table directories over one pool of tables, which is
 * all a collection is. Each member keeps its own tables here rather than sharing them, which a
 * real collection would — the unpacker reads directories, and does not care either way.
 */
function collectionOf(...fonts: ArrayBuffer[]): ArrayBuffer {
  const members = fonts.map((bytes) => {
    const view = new DataView(bytes);
    const count = view.getUint16(4);
    const records = Array.from({ length: count }, (_, i) => {
      const at = SFNT_HEADER + i * TABLE_RECORD;
      return {
        tag: bytes.slice(at, at + 4),
        checksum: view.getUint32(at + 4),
        offset: view.getUint32(at + 8),
        length: view.getUint32(at + 12),
      };
    });
    return { bytes, view, records };
  });

  const header = 12 + fonts.length * 4;
  const dirBytes = members.map((m) => SFNT_HEADER + m.records.length * TABLE_RECORD);
  let cursor = header + dirBytes.reduce((a, b) => a + b, 0);
  const dirOffsets: number[] = [];
  let at = header;
  for (const size of dirBytes) {
    dirOffsets.push(at);
    at += size;
  }
  const placements = members.map((m) =>
    m.records.map((r) => {
      const placed = cursor;
      cursor += pad(r.length);
      return placed;
    }),
  );

  const out = new ArrayBuffer(cursor);
  const dst = new DataView(out);
  const dstBytes = new Uint8Array(out);
  dstBytes.set(new Uint8Array([0x74, 0x74, 0x63, 0x66]), 0); // 'ttcf'
  dst.setUint32(4, 0x00010000);
  dst.setUint32(8, fonts.length);
  fonts.forEach((_, i) => {
    dst.setUint32(12 + i * 4, dirOffsets[i]);
  });

  members.forEach((m, i) => {
    const dir = dirOffsets[i];
    dst.setUint32(dir, m.view.getUint32(0));
    dst.setUint16(dir + 4, m.records.length);
    dst.setUint16(dir + 6, m.view.getUint16(6));
    dst.setUint16(dir + 8, m.view.getUint16(8));
    dst.setUint16(dir + 10, m.view.getUint16(10));
    m.records.forEach((r, j) => {
      const rec = dir + SFNT_HEADER + j * TABLE_RECORD;
      dstBytes.set(new Uint8Array(r.tag), rec);
      dst.setUint32(rec + 4, r.checksum);
      dst.setUint32(rec + 8, placements[i][j]);
      dst.setUint32(rec + 12, r.length);
      dstBytes.set(new Uint8Array(m.bytes, r.offset, r.length), placements[i][j]);
    });
  });
  return out;
}

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
