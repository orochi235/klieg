// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sign, update, destroy } = vi.hoisted(() => ({
  sign: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../src/sign/index.js', () => ({ sign }));

await import('../src/element.js');

/** The custom element upgrade and the dynamic import of `sign` are both async. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let onLit: (lit: boolean) => void;

beforeEach(() => {
  // Clearing the DOM first: emptying the body disconnects the previous test's element, and that
  // disconnect calls `destroy` — after `clearAllMocks` it would be counted against this test.
  document.body.innerHTML = '';
  vi.clearAllMocks();
  sign.mockImplementation((_anchor: HTMLElement, opts: { onLit?: (l: boolean) => void }) => {
    onLit = opts.onLit ?? (() => {});
    return { lit: false, update, destroy };
  });
});

async function mount(html: string): Promise<HTMLElement> {
  document.body.innerHTML = html;
  await settled();
  return document.querySelector('klieg-sign') as HTMLElement;
}

describe('<klieg-sign>', () => {
  it('registers itself once the module is imported', () => {
    expect(customElements.get('klieg-sign')).toBeDefined();
  });

  it('installs exactly one stylesheet however many elements connect', async () => {
    await mount(
      '<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>' +
        '<klieg-sign font="/f.ttf"><h1>B</h1></klieg-sign>',
    );

    // Both have to have connected for the count of one to mean anything, and the fallback mark is
    // the observable each connect leaves. (Not `sign`: only the first of two concurrent dynamic
    // imports of a mocked module ever settles under vitest 4.1.)
    const marks = document.querySelectorAll('klieg-sign > [data-klieg-fallback]');
    expect(marks).toHaveLength(2);

    const styles = document.head.querySelectorAll('style[data-klieg-sign]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain('@layer klieg');
  });

  it('marks the fallback the page supplied, and not the canvas klieg appends', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');
    el.appendChild(document.createElement('canvas'));

    expect(el.querySelector('h1')?.hasAttribute('data-klieg-fallback')).toBe(true);
    expect(el.querySelector('canvas')?.hasAttribute('data-klieg-fallback')).toBe(false);
  });

  it('anchors the sign to itself, not to the heading', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');

    expect(sign).toHaveBeenCalledOnce();
    expect(sign.mock.calls[0]?.[0]).toBe(el);
  });

  it('carries the lit state as an attribute the stylesheet can see', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');
    expect(el.hasAttribute('lit')).toBe(false);

    onLit(true);
    expect(el.hasAttribute('lit')).toBe(true);

    onLit(false);
    expect(el.hasAttribute('lit')).toBe(false);
  });

  it('destroys the sign and drops lit when it leaves the document', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');
    onLit(true);

    el.remove();

    expect(destroy).toHaveBeenCalledOnce();
    expect(el.hasAttribute('lit')).toBe(false);
  });

  it('waits for the parser to reach its children before reading them', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      document.body.innerHTML = '<klieg-sign font="/f.ttf"></klieg-sign>';
      const el = document.querySelector('klieg-sign') as HTMLElement;
      // The parser has not reached the heading yet, so neither has the element.
      el.innerHTML = '<h1>A Name</h1>';
      await settled();
      expect(sign).not.toHaveBeenCalled();

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await settled();
      expect(sign).toHaveBeenCalledOnce();
      expect(el.querySelector('h1')?.hasAttribute('data-klieg-fallback')).toBe(true);
    } finally {
      Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    }
  });

  it('never starts a sign for an element removed before the import lands', async () => {
    document.body.innerHTML = '<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>';
    document.querySelector('klieg-sign')?.remove();
    await settled();

    expect(sign).not.toHaveBeenCalled();
  });
});
