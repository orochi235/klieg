import type { Font, Glyph } from 'opentype.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('opentype.js', () => ({ parse }));

import { loadFont } from '../../src/text/font.js';
import { isFontCollection } from '../../src/text/sfnt.js';
import { collectionOf, readFont } from './collection-fixture.js';

const TTC = collectionOf(readFont('anton.ttf'), readFont('cinzel.ttf'));

function stubFont(glyphs: Record<string, Partial<Glyph>>, kern = 0): Font {
  return {
    unitsPerEm: 1000,
    charToGlyph: (ch: string) => glyphs[ch] ?? {},
    getKerningValue: vi.fn(() => kern),
  } as unknown as Font;
}

function stubFetch(res: Partial<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => res as Response),
  );
}

beforeEach(() => {
  parse.mockReset();
  stubFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
});

describe('loadFont', () => {
  it('names the url and status when the response is not ok', async () => {
    stubFetch({ ok: false, status: 404 });

    await expect(loadFont('/fonts/x.ttf')).rejects.toThrow(
      'klieg: failed to load font /fonts/x.ttf (404)',
    );
  });

  it('names the url when the network call itself rejects', async () => {
    const cause = new TypeError('fetch failed');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(cause)),
    );

    await expect(loadFont('/fonts/x.ttf')).rejects.toMatchObject({
      message: 'klieg: could not fetch font /fonts/x.ttf',
      cause,
    });
  });

  it('does not blame the font file when the body read fails', async () => {
    stubFetch({
      ok: true,
      arrayBuffer: () => Promise.reject(new TypeError('terminated')),
    });

    await expect(loadFont('/fonts/x.ttf')).rejects.toThrow('terminated');
  });

  it('names the url when the bytes are not a parseable font', async () => {
    const cause = new Error('Unsupported OpenType signature 0x3c21444f');
    parse.mockImplementation(() => {
      throw cause;
    });

    await expect(loadFont('/fonts/x.ttf')).rejects.toMatchObject({
      message: 'klieg: /fonts/x.ttf is not a font opentype.js can parse',
      cause,
    });
  });

  it('exposes the parsed font and its em size', async () => {
    const font = stubFont({});
    parse.mockReturnValue(font);

    const loaded = await loadFont('/fonts/x.ttf');
    expect(loaded.font).toBe(font);
    expect(loaded.unitsPerEm).toBe(1000);
  });

  it('reads advances in font units off the glyph', async () => {
    parse.mockReturnValue(stubFont({ A: { advanceWidth: 722 } }));

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.advanceOf('A')).toBe(722);
  });

  it('treats a glyph with no advance as zero width', async () => {
    parse.mockReturnValue(stubFont({ A: {} }));

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.advanceOf('A')).toBe(0);
  });

  it('kerns by glyph, since opentype takes glyphs rather than characters', async () => {
    const font = stubFont({ A: { index: 1 }, V: { index: 2 } }, -80);
    parse.mockReturnValue(font);

    const { metrics } = await loadFont('/fonts/x.ttf');
    expect(metrics.kernOf('A', 'V')).toBe(-80);
    expect(font.getKerningValue).toHaveBeenCalledWith({ index: 1 }, { index: 2 });
  });
});

describe('loadFont, on a collection', () => {
  beforeEach(() => {
    parse.mockReturnValue(stubFont({}));
    stubFetch({ ok: true, arrayBuffer: async () => TTC });
  });

  it('keys a plain font by its url', async () => {
    stubFetch({ ok: true, arrayBuffer: async () => readFont('anton.ttf') });
    expect((await loadFont('/fonts/x.ttf')).key).toBe('/fonts/x.ttf');
  });

  it('keys a face by url and face, so two faces of one file do not collide', async () => {
    expect((await loadFont('/f.ttc', 'Cinzel-Regular')).key).toBe('/f.ttc#Cinzel-Regular');
  });

  it('parses the extracted sfnt rather than the container', async () => {
    await loadFont('/f.ttc', 'Cinzel-Regular');
    expect(isFontCollection(parse.mock.calls[0]?.[0] as ArrayBuffer)).toBe(false);
  });

  it('keeps the extracted sfnt as its bytes, which is what new FontFace is handed', async () => {
    const { bytes } = await loadFont('/f.ttc', 'Cinzel-Regular');
    expect(isFontCollection(bytes)).toBe(false);
  });

  it('names the members when the face is not one of them', async () => {
    await expect(loadFont('/f.ttc', 'Nope')).rejects.toThrow(
      "klieg: /f.ttc has no face 'Nope' — it holds Anton-Regular, Cinzel-Regular",
    );
  });

  it('warns once per url and takes the first member when no face is named', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await loadFont('/unnamed.ttc')).key).toBe('/unnamed.ttc#Anton-Regular');
    await loadFont('/unnamed.ttc');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'klieg: /unnamed.ttc is a collection and no face was named — using Anton-Regular of Anton-Regular, Cinzel-Regular',
    );
    warn.mockRestore();
  });
});
