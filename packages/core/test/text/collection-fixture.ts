import { readFileSync } from 'node:fs';

/** Fonts the lab serves, read off disk: vitest does not resolve the lab's `?url` imports. */
export function readFont(name: string): ArrayBuffer {
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
export function collectionOf(...fonts: ArrayBuffer[]): ArrayBuffer {
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
  const dirAt = (i: number): number => dirOffsets[i] as number;
  const placedAt = (i: number, j: number): number => (placements[i] as number[])[j] as number;
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
    dst.setUint32(12 + i * 4, dirAt(i));
  });

  members.forEach((m, i) => {
    const dir = dirAt(i);
    dst.setUint32(dir, m.view.getUint32(0));
    dst.setUint16(dir + 4, m.records.length);
    dst.setUint16(dir + 6, m.view.getUint16(6));
    dst.setUint16(dir + 8, m.view.getUint16(8));
    dst.setUint16(dir + 10, m.view.getUint16(10));
    m.records.forEach((r, j) => {
      const rec = dir + SFNT_HEADER + j * TABLE_RECORD;
      dstBytes.set(new Uint8Array(r.tag), rec);
      dst.setUint32(rec + 4, r.checksum);
      dst.setUint32(rec + 8, placedAt(i, j));
      dst.setUint32(rec + 12, r.length);
      dstBytes.set(new Uint8Array(m.bytes, r.offset, r.length), placedAt(i, j));
    });
  });
  return out;
}
