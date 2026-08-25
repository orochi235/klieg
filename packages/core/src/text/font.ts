import type { Font } from 'opentype.js';
import * as opentype from 'opentype.js';
import type { GlyphMetrics } from './layout.js';

// opentype.js 2.0 publishes ESM under `module` and a UMD bundle under `main`. Only bundlers read
// `module`; Node takes the UMD one, whose named exports it cannot detect, so `import { parse }`
// throws on any server that loads this package (SSR). Reach through the interop default instead.
const ns = opentype as typeof opentype & { default?: typeof opentype };
const { parse } = 'default' in ns && ns.default ? ns.default : ns;

export interface LoadedFont {
  font: Font;
  unitsPerEm: number;
  metrics: GlyphMetrics;
  /** The fetched file, kept so a CSS `FontFace` can reuse it instead of downloading again. */
  bytes: ArrayBuffer;
}

export async function loadFont(url: string): Promise<LoadedFont> {
  const res = await fetch(url).catch((cause) => {
    throw new Error(`klieg: could not fetch font ${url}`, { cause });
  });
  if (!res.ok) throw new Error(`klieg: failed to load font ${url} (${res.status})`);

  const bytes = await res.arrayBuffer();

  let font: Font;
  try {
    font = parse(bytes);
  } catch (cause) {
    // A server that answers 200 with an HTML error page lands here, not on the status check.
    throw new Error(`klieg: ${url} is not a font opentype.js can parse`, { cause });
  }

  const metrics: GlyphMetrics = {
    advanceOf: (ch) => font.charToGlyph(ch).advanceWidth ?? 0,
    kernOf: (a, b) => font.getKerningValue(font.charToGlyph(a), font.charToGlyph(b)),
  };

  return { font, unitsPerEm: font.unitsPerEm, metrics, bytes };
}
