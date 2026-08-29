import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadFont } = vi.hoisted(() => ({ loadFont: vi.fn() }));
vi.mock('../../src/text/font.js', () => ({ loadFont }));

import { FontRegistry } from '../../src/text/font-registry.js';

beforeEach(() => {
  loadFont.mockReset();
  loadFont.mockImplementation(async (url: string, face?: string) => ({
    key: face ? `${url}#${face}` : url,
  }));
});

describe('FontRegistry', () => {
  it('takes the first entry when no default is named', async () => {
    const registry = new FontRegistry({ display: '/d.ttf', body: '/b.ttf' });
    expect((await registry.load()).key).toBe('/d.ttf');
  });

  it('honours an explicit default', async () => {
    const registry = new FontRegistry({ display: '/d.ttf', body: '/b.ttf' }, 'body');
    expect((await registry.load()).key).toBe('/b.ttf');
  });

  it('passes the face of a collection entry through', async () => {
    const registry = new FontRegistry({ helv: { url: '/h.ttc', face: 'Helvetica-Bold' } });
    expect((await registry.load()).key).toBe('/h.ttc#Helvetica-Bold');
    expect(loadFont).toHaveBeenCalledWith('/h.ttc', 'Helvetica-Bold');
  });

  it('separates two faces of one file, which would otherwise share a memo', async () => {
    const registry = new FontRegistry({
      regular: { url: '/h.ttc', face: 'Helvetica' },
      bold: { url: '/h.ttc', face: 'Helvetica-Bold' },
    });
    expect(await registry.load('regular')).not.toBe(await registry.load('bold'));
    expect(loadFont).toHaveBeenCalledTimes(2);
  });

  it('loads one file once, however many names point at it', async () => {
    const registry = new FontRegistry({ a: '/one.ttf', b: '/one.ttf' });
    expect(await registry.load('a')).toBe(await registry.load('b'));
    expect(loadFont).toHaveBeenCalledTimes(1);
  });

  it('gives one object to two names that spell one face differently', async () => {
    // `loadFont` resolves an omitted face to the collection's first member, so these two
    // requests differ only until the load returns. Two objects would mean two glyph caches.
    loadFont.mockImplementation(async () => ({ key: '/sys.ttc#First' }));
    const registry = new FontRegistry({
      implicit: '/sys.ttc',
      explicit: { url: '/sys.ttc', face: 'First' },
    });

    expect(await registry.load('implicit')).toBe(await registry.load('explicit'));
  });

  it('names the registered fonts when asked for one it has not got', () => {
    const registry = new FontRegistry({ display: '/d.ttf', body: '/b.ttf' });
    expect(() => registry.load('bdy')).toThrow(
      "klieg: no font named 'bdy' — registered: display, body",
    );
  });

  it('throws rather than rejecting, so the stack points at the fire', () => {
    const registry = new FontRegistry({ display: '/d.ttf' });
    // A rejected promise here would surface at an await, with the call site already unwound.
    expect(() => registry.load('nope')).toThrow();
  });

  it('retries a failed load instead of making one bad fetch permanent', async () => {
    loadFont.mockRejectedValueOnce(new Error('404'));
    const registry = new FontRegistry({ display: '/d.ttf' });
    await expect(registry.load()).rejects.toThrow('404');
    expect((await registry.load()).key).toBe('/d.ttf');
    expect(loadFont).toHaveBeenCalledTimes(2);
  });

  it('does not refetch one that resolved', async () => {
    const registry = new FontRegistry({ display: '/d.ttf' });
    await registry.load();
    await registry.load();
    expect(loadFont).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty map, which has no font to fire in', () => {
    expect(() => new FontRegistry({})).toThrow('klieg: fonts is empty');
  });

  it('refuses a default naming nothing', () => {
    expect(() => new FontRegistry({ a: '/a.ttf' }, 'b')).toThrow(
      "klieg: defaultFont 'b' is not one of: a",
    );
  });
});
