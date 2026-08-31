import type { Font } from 'opentype.js';
import * as opentype from 'opentype.js';
import type { GlyphMetrics } from './layout.js';
import { familyFor, registerFace } from './outline-face.js';
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
   * The name this face is registered under with the layout engine. Unique per load, because that
   * registry is module-global and two instances on one page must not collide.
   */
  family: string;
  /**
   * The *extracted* sfnt, kept so a CSS `FontFace` can reuse it instead of downloading again.
   * Never the fetched file for a collection: a `ttcf` container is not a font resource, and
   * `new FontFace` would decline it silently.
   */
  bytes: ArrayBuffer;
}

/**
 * The member bytes to parse, the key that tells two faces of one file apart, and its name.
 *
 * Warns rather than latching: a registry loads each file once per instance, so this already
 * speaks once per instance — and a module-global latch would make the warning depend on which
 * instance happened to be built first.
 */
function resolveFace(
  fetched: ArrayBuffer,
  url: string,
  face?: string,
): [ArrayBuffer, string, string | null] {
  if (!isFontCollection(fetched)) {
    if (face !== undefined) {
      throw new Error(`klieg: ${url} is a single font, so face '${face}' does not apply`);
    }
    return [sfntFromCollection(fetched).bytes, url, null];
  }

  const faces = collectionFaces(fetched);
  if (face !== undefined && !faces.includes(face)) {
    throw new Error(`klieg: ${url} has no face '${face}' — it holds ${faces.join(', ')}`);
  }
  if (face === undefined) {
    // A collection whose members carry no name table cannot be addressed by one, so the key
    // falls back to the member's index rather than interpolating `undefined` into it.
    const first = faces.length > 0 ? `'${faces[0]}'` : 'its first member, which is unnamed';
    const rest = faces.length > 0 ? ` of ${faces.join(', ')}` : '';
    console.warn(`klieg: ${url} is a collection and no face was named — using ${first}${rest}`);
  }
  const chosen = face ?? faces[0];
  return [sfntFromCollection(fetched, chosen).bytes, `${url}#${chosen ?? 0}`, chosen ?? null];
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

  const loaded: LoadedFont = {
    font,
    unitsPerEm: font.unitsPerEm,
    metrics,
    key,
    bytes,
    family: familyFor(++loads, key),
  };
  // Registering here rather than at the call site: a face that reaches layout unregistered lays
  // out nothing at all, and says nothing about why.
  await registerFace(loaded.family, loaded);
  return loaded;
}

/** Counts loads, not instances: unique per face is what the module-global registry needs. */
let loads = 0;
