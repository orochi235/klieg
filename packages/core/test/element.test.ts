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
  // The head outlives the body reset, and a stylesheet left there short-circuits the install
  // guard — every stylesheet test would then assert against a leftover rather than a fresh one.
  document.head.innerHTML = '';
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
    // One at a time: two concurrent dynamic imports of a mocked module leave the second pending
    // forever under vitest 4.1, and the dropped promise outlives the test environment.
    await mount('<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<klieg-sign font="/f.ttf"><h1>B</h1></klieg-sign>',
    );
    await settled();

    // Both have to have connected for the count of one to mean anything.
    expect(sign).toHaveBeenCalledTimes(2);

    const styles = document.head.querySelectorAll('style[data-klieg-sign]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain('@layer klieg');
  });

  it('installs one stylesheet for two elements connecting together', async () => {
    // `installStyle` runs above the `readyState` branch, so both elements connect in one task
    // with no dynamic import ever starting.
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      document.body.innerHTML =
        '<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>' +
        '<klieg-sign font="/f.ttf"><h1>B</h1></klieg-sign>';
      await settled();

      expect(sign).not.toHaveBeenCalled();
      expect(document.head.querySelectorAll('style[data-klieg-sign]')).toHaveLength(1);
    } finally {
      Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    }
  });

  it('marks every child the page supplied, a canvas of its own included', async () => {
    const el = await mount(
      '<klieg-sign font="/f.ttf"><h1>A Name</h1><canvas></canvas></klieg-sign>',
    );

    expect(el.querySelector('h1')?.hasAttribute('data-klieg-fallback')).toBe(true);
    expect(el.querySelector('canvas')?.hasAttribute('data-klieg-fallback')).toBe(true);
  });

  it('leaves what klieg appends after connect unmarked', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');
    el.appendChild(document.createElement('canvas'));

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

  it('never touches an element removed before the parser finishes', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    try {
      document.body.innerHTML = '<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>';
      const el = document.querySelector('klieg-sign') as HTMLElement;
      el.remove();

      document.dispatchEvent(new Event('DOMContentLoaded'));
      await settled();

      expect(sign).not.toHaveBeenCalled();
      expect(el.querySelector('h1')?.hasAttribute('data-klieg-fallback')).toBe(false);
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

  it('reads every attribute it observes', async () => {
    await mount(
      '<klieg-sign font="/f.ttf" text="Sign" look="tubing" tint="currentColor" ' +
        'framing-width="0.94" framing-height="0.66" align="center" lighting="static" bloom>' +
        '<h1>A Name</h1></klieg-sign>',
    );

    expect(sign.mock.calls[0]?.[1]).toMatchObject({
      font: '/f.ttf',
      text: 'Sign',
      look: 'tubing',
      tint: 'currentColor',
      framing: { width: 0.94, height: 0.66, align: 'center' },
      lighting: 'static',
      bloom: true,
    });
  });

  it('omits what the page did not say, so the library defaults stand', async () => {
    await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');

    const opts = sign.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts.framing).toBeUndefined();
    expect(opts.look).toBeUndefined();
    expect(opts.bloom).toBeUndefined();
    expect(opts.text).toBeUndefined();
  });

  it('reads a bare bloom as on and an explicit false as off', async () => {
    await mount('<klieg-sign font="/f.ttf" bloom="false"><h1>A</h1></klieg-sign>');
    const opts = sign.mock.calls[0]?.[1] as { bloom?: boolean };
    expect(opts.bloom).toBe(false);
  });

  it('ignores a framing number that is not one', async () => {
    await mount('<klieg-sign font="/f.ttf" framing-width="wide"><h1>A</h1></klieg-sign>');
    const opts = sign.mock.calls[0]?.[1] as { framing?: unknown };
    expect(opts.framing).toBeUndefined();
  });

  it('ignores an empty framing attribute rather than reading it as a zero', async () => {
    await mount('<klieg-sign font="/f.ttf" framing-width=""><h1>A</h1></klieg-sign>');
    const opts = sign.mock.calls[0]?.[1] as { framing?: unknown };
    expect(opts.framing).toBeUndefined();
  });

  it('prefers the properties over the attributes for what an attribute cannot carry', async () => {
    document.body.innerHTML = '<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>';
    const el = document.querySelector('klieg-sign') as HTMLElement & {
      effects?: unknown;
      options?: unknown;
    };
    el.effects = [{ piece: 'flicker' }];
    el.options = { blendMs: 40 };
    await settled();

    expect(sign.mock.calls[0]?.[1]).toMatchObject({
      effects: [{ piece: 'flicker' }],
      fire: { blendMs: 40 },
    });
  });

  it('ignores an align it does not know rather than aligning to an edge', async () => {
    await mount('<klieg-sign font="/f.ttf" align="banana"><h1>A</h1></klieg-sign>');
    const opts = sign.mock.calls[0]?.[1] as { framing?: unknown };
    expect(opts.framing).toBeUndefined();
  });

  it('re-fires through update when an observed attribute changes', async () => {
    const el = await mount('<klieg-sign font="/f.ttf" look="gold"><h1>A</h1></klieg-sign>');

    el.setAttribute('look', 'tubing');
    await settled();

    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]?.[0]).toMatchObject({ look: 'tubing' });
  });

  it('folds a burst of attribute changes into one re-fire', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>');

    el.setAttribute('look', 'gold');
    el.setAttribute('tint', 'red');
    el.setAttribute('align', 'center');
    await settled();

    // Each `update()` builds a WebGL context and refetches the font, so three would be three.
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      look: 'gold',
      tint: 'red',
      framing: { align: 'center' },
    });
  });

  it('never re-fires a sign the element destroyed before the update landed', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>');

    el.setAttribute('look', 'gold');
    el.remove();
    await settled();

    expect(update).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
