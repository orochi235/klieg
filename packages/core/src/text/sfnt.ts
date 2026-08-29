/**
 * TrueType/OpenType **collection** unpacking.
 *
 * A `.ttc` holds every weight and style of a family in one file over a shared glyph store, and
 * its header is `ttcf` rather than an sfnt version — so opentype.js rejects it outright, along
 * with Helvetica, Times, Courier and Menlo, which is how macOS ships them. Unpacking is
 * mechanical: a collection is N table directories over one pool of tables, so pick the directory
 * whose PostScript name matches and re-emit it as a standalone sfnt with the table bytes copied
 * and the offsets rewritten. Nothing is re-encoded, so the result parses identically to a font
 * that had shipped on its own.
 *
 * Ported from `@weasel-js/font` (MIT, same author), where it runs ahead of the same parser. It
 * sits in front of parsing rather than inside it, so swapping opentype.js out later does not
 * drag it along.
 */

const SFNT_HEADER_BYTES = 12;
const TABLE_RECORD_BYTES = 16;

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Is `bytes` a font collection rather than a single font? */
export function isFontCollection(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false;
  return tagAt(new DataView(bytes), 0) === 'ttcf';
}

/** Every signature that opens a font file klieg can hand to a parser. */
const FONT_SIGNATURES: ReadonlySet<string> = new Set([
  '\x00\x01\x00\x00',
  'true',
  'typ1',
  'OTTO',
  'ttcf',
  'wOFF',
  'wOF2',
]);

const RESOURCE_HEADER_BYTES = 16;

/**
 * Is `bytes` a Datafork TrueType file (`.dfont`)?
 *
 * A `.dfont` is a bare Macintosh resource fork written to the data fork, so unlike every other
 * font format it opens with no signature — just four big-endian offsets. It is recognized by
 * those adding up, which is why the signature check has to run first: an sfnt's header bytes are
 * numbers too, and nothing stops them from coincidentally being consistent.
 *
 * Detection only. Reading the `sfnt` resources out of the map is not implemented; the point is
 * that the failure names the format rather than dying on an unrecognized signature.
 */
export function isDataForkFont(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < RESOURCE_HEADER_BYTES) return false;
  const view = new DataView(bytes);
  if (FONT_SIGNATURES.has(tagAt(view, 0))) return false;
  const dataOffset = view.getUint32(0);
  const mapOffset = view.getUint32(4);
  const dataLength = view.getUint32(8);
  const mapLength = view.getUint32(12);
  return (
    dataOffset >= RESOURCE_HEADER_BYTES &&
    dataOffset + dataLength === mapOffset &&
    mapOffset + mapLength <= bytes.byteLength
  );
}

interface TableRecord {
  tag: string;
  offset: number;
  length: number;
  checksum: number;
}

function readTableDirectory(view: DataView, dirOffset: number): TableRecord[] {
  const numTables = view.getUint16(dirOffset + 4);
  const records: TableRecord[] = [];
  for (let i = 0; i < numTables; i++) {
    const at = dirOffset + SFNT_HEADER_BYTES + i * TABLE_RECORD_BYTES;
    records.push({
      tag: tagAt(view, at),
      checksum: view.getUint32(at + 4),
      offset: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
    });
  }
  return records;
}

/**
 * PostScript name (`name` table, nameID 6) of the sub-font at `dirOffset`, or null where it
 * carries none. Deliberately minimal: identifying which member to unpack is all this needs, and
 * the real parser reads the table properly once the font is standalone. PostScript names are
 * ASCII by specification, so both the Macintosh and Windows encodings reduce to "take every byte
 * that isn't a zero pad".
 */
function postScriptNameAt(view: DataView, records: readonly TableRecord[]): string | null {
  const name = records.find((r) => r.tag === 'name');
  if (!name) return null;
  const base = name.offset;
  const count = view.getUint16(base + 2);
  const stringOffset = view.getUint16(base + 4);
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + i * 12;
    if (view.getUint16(rec + 6) !== 6) continue; // nameID 6 === PostScript name
    const length = view.getUint16(rec + 8);
    const offset = view.getUint16(rec + 10);
    let out = '';
    for (let b = 0; b < length; b++) {
      const code = view.getUint8(base + stringOffset + offset + b);
      if (code !== 0) out += String.fromCharCode(code);
    }
    if (out.length > 0) return out;
  }
  return null;
}

function memberOffsets(view: DataView): number[] {
  const numFonts = view.getUint32(8);
  if (numFonts === 0) throw new Error('klieg: font collection contains no fonts');
  return Array.from({ length: numFonts }, (_, i) => view.getUint32(12 + i * 4));
}

/** PostScript names of every member, in file order. Empty for a single font. */
export function collectionFaces(bytes: ArrayBuffer): string[] {
  if (!isFontCollection(bytes)) return [];
  const view = new DataView(bytes);
  return memberOffsets(view)
    .map((dirOffset) => postScriptNameAt(view, readTableDirectory(view, dirOffset)))
    .filter((name): name is string => name !== null);
}

/** Re-emit the table directory at `dirOffset` as a standalone sfnt buffer. */
function extractFont(source: ArrayBuffer, view: DataView, dirOffset: number): ArrayBuffer {
  const records = readTableDirectory(view, dirOffset);
  // Tables are copied 4-byte aligned, which the format requires and which every checksum in the
  // directory was computed over.
  const padded = (n: number): number => (n + 3) & ~3;
  let total = SFNT_HEADER_BYTES + records.length * TABLE_RECORD_BYTES;
  for (const r of records) total += padded(r.length);

  const out = new ArrayBuffer(total);
  const dst = new DataView(out);
  const dstBytes = new Uint8Array(out);
  const srcBytes = new Uint8Array(source);

  dst.setUint32(0, view.getUint32(dirOffset)); // sfntVersion
  dst.setUint16(4, records.length);
  // searchRange / entrySelector / rangeShift are a binary-search hint over the table records.
  // Recomputed rather than copied: the member directory's values describe its own table count,
  // and a wrong hint is a parser walking off the end of the directory.
  const entrySelector = Math.floor(Math.log2(records.length));
  const searchRange = 2 ** entrySelector * 16;
  dst.setUint16(6, searchRange);
  dst.setUint16(8, entrySelector);
  dst.setUint16(10, records.length * 16 - searchRange);

  let cursor = SFNT_HEADER_BYTES + records.length * TABLE_RECORD_BYTES;
  records.forEach((r, i) => {
    const at = SFNT_HEADER_BYTES + i * TABLE_RECORD_BYTES;
    for (let b = 0; b < 4; b++) dst.setUint8(at + b, r.tag.charCodeAt(b));
    dst.setUint32(at + 4, r.checksum);
    dst.setUint32(at + 8, cursor);
    dst.setUint32(at + 12, r.length);
    dstBytes.set(srcBytes.subarray(r.offset, r.offset + r.length), cursor);
    cursor += padded(r.length);
  });
  return out;
}

/**
 * Standalone font bytes for one member of a collection.
 *
 * `postScriptName` selects the member. Naming one that no member carries returns the first with
 * `matched: false`, so a caller can say it substituted; naming none is not a failed match and
 * returns `true`. Passing a single font through is a no-op, so this is safe to call on any bytes.
 */
export function sfntFromCollection(
  bytes: ArrayBuffer,
  postScriptName?: string,
): { bytes: ArrayBuffer; matched: boolean } {
  if (isDataForkFont(bytes)) {
    throw new Error(
      'klieg: Datafork TrueType (.dfont) is not supported — klieg reads sfnt tables and a ' +
        '.dfont holds them inside a Macintosh resource map',
    );
  }
  if (!isFontCollection(bytes)) return { bytes, matched: true };

  const view = new DataView(bytes);
  const offsets = memberOffsets(view);

  if (postScriptName) {
    for (const dirOffset of offsets) {
      const records = readTableDirectory(view, dirOffset);
      if (postScriptNameAt(view, records) === postScriptName) {
        return { bytes: extractFont(bytes, view, dirOffset), matched: true };
      }
    }
  }
  return {
    bytes: extractFont(bytes, view, offsets[0] as number),
    matched: !postScriptName,
  };
}
