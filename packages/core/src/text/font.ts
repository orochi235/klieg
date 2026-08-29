import type { Font } from 'opentype.js';
import * as opentype from 'opentype.js';
import type { GlyphMetrics } from './layout.js';
import { collectionFaces, isFontCollection, sfntFromCollection } from './sfnt.js';

// opentype.js 2.0 publishes ESM under `module` and a UMD bundle under `main`. Only bundlers read
// `module`; Node takes the UMD one, whose named exports it cannot detect, so `import { parse }`
// throws on any server that loads this package (SSR). Reach through the interop default instead.
const ns = opentype as typeof opentype & { default?: typeof opentype };
const { parse } = 'default' in ns && ns.default ? ns.default : ns;

export interface LoadedFont {
  font: Font;
  unitsPerEm: number;
  metrics: GlyphMetrics;
  /** Identity for the caches and the CSS family: the url, or `url#face` within a collection. */
  key: string;
  /**
   * The *extracted* sfnt, kept so a CSS `FontFace` can reuse it instead of downloading again.
   * Never the fetched file for a collection: a `ttcf` container is not a font resource, and
   * `new FontFace` would decline it silently.
   */
  bytes: ArrayBuffer;
}

const warnedCollections = new Set<string>();

/** The member bytes to parse, the key that tells two faces of one file apart, and its name. */
function resolveFace(
  fetched: ArrayBuffer,
  url: string,
  face?: string,
): [ArrayBuffer, string, string | null] {
  if (!isFontCollection(fetched)) return [sfntFromCollection(fetched).bytes, url, null];

  const faces = collectionFaces(fetched);
  if (face && !faces.includes(face)) {
    throw new Error(`klieg: ${url} has no face '${face}' — it holds ${faces.join(', ')}`);
  }
  if (!face && !warnedCollections.has(url)) {
    warnedCollections.add(url);
    console.warn(
      `klieg: ${url} is a collection and no face was named — using ${faces[0]} of ${faces.join(', ')}`,
    );
  }
  const chosen = face ?? (faces[0] as string);
  return [sfntFromCollection(fetched, chosen).bytes, `${url}#${chosen}`, chosen];
}

export async function loadFont(url: string, face?: string): Promise<LoadedFont> {
  const res = await fetch(url).catch((cause) => {
    throw new Error(`klieg: could not fetch font ${url}`, { cause });
  });
  if (!res.ok) throw new Error(`klieg: failed to load font ${url} (${res.status})`);

  const fetched = await res.arrayBuffer();
  const [bytes, key, member] = resolveFace(fetched, url, face);

  let font: Font;
  try {
    font = parse(bytes);
  } catch (cause) {
    // Separating these matters: a collection member that unpacks and then fails to parse is an
    // opentype.js limit, not a broken container — Helvetica, Times, Courier and Menlo all reach
    // here, on a cmap format their old Apple TrueType tables use and opentype.js does not read.
    if (member !== null) {
      throw new Error(
        `klieg: ${url} holds ${member}, which unpacked but is not a font opentype.js can parse`,
        { cause },
      );
    }
    // A server that answers 200 with an HTML error page lands here, not on the status check.
    throw new Error(`klieg: ${url} is not a font opentype.js can parse`, { cause });
  }

  const metrics: GlyphMetrics = {
    advanceOf: (ch) => font.charToGlyph(ch).advanceWidth ?? 0,
    kernOf: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  };

  return { font, unitsPerEm: font.unitsPerEm, metrics, key, bytes };
}
