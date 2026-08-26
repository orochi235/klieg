import { expect, type Page, test } from '@playwright/test';

const SIGNS = ['plain', 'varTint', 'currentTint'] as const;
const WORDS = { plain: 'klieg', varTint: 'varsign', currentTint: 'huesign' } as const;

/** Measured: one sign's canvas attaches ~100ms after it connects, but headless Chrome serializes
 * WebGL context creation, so the third of three costs ~10s alone and ~20s under three workers. */
const LIGHTING_MS = 30_000;

test.describe.configure({ timeout: 60_000 });

/** Loads `/sign/` and returns once all three signs have a canvas of their own. */
async function lightAll(page: Page): Promise<void> {
  await page.goto('/sign/');
  for (const id of SIGNS) {
    await expect(page.locator(`#${id}`), `#${id} never reported itself lit`).toHaveAttribute(
      'lit',
      '',
      { timeout: LIGHTING_MS },
    );
    await expect(page.locator(`#${id} canvas`)).toBeAttached({ timeout: LIGHTING_MS });
  }
}

interface Mean {
  lit: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Mean color of the non-transparent pixels in one sign's own drawing buffer. Read from inside
 * `requestAnimationFrame`: the buffer is not `preserveDrawingBuffer`, so a read after the page
 * composites returns zeros and every channel would compare equal.
 */
function meanColor(page: Page, id: string): Promise<Mean> {
  return page.evaluate(
    (id) =>
      new Promise<Mean>((resolve, reject) => {
        const canvas = document.querySelector<HTMLCanvasElement>(`#${id} canvas`);
        if (!canvas) return reject(new Error(`#${id} has no canvas`));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error(`#${id}'s canvas has no webgl2 context`));

        const { width, height } = canvas;
        const px = new Uint8Array(width * height * 4);
        requestAnimationFrame(() => {
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let r = 0;
          let g = 0;
          let b = 0;
          let lit = 0;
          for (let i = 0; i < px.length; i += 4) {
            // Bevels fade to nothing at the silhouette's edge; only solidly drawn pixels carry
            // the look's color.
            if ((px[i + 3] ?? 0) < 40) continue;
            lit++;
            r += px[i] ?? 0;
            g += px[i + 1] ?? 0;
            b += px[i + 2] ?? 0;
          }
          resolve(
            lit === 0
              ? { lit, r: 0, g: 0, b: 0 }
              : { lit, r: Math.round(r / lit), g: Math.round(g / lit), b: Math.round(b / lit) },
          );
        });
      }),
    id,
  );
}

/** Counts the live global `pointermove` listeners by wrapping the pair before any page code runs. */
async function countPointerListeners(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let live = 0;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (this === window && type === 'pointermove') live++;
      return add.call(this, type, ...rest);
    };
    EventTarget.prototype.removeEventListener = function (type, ...rest) {
      if (this === window && type === 'pointermove') live--;
      return remove.call(this, type, ...rest);
    };
    Object.defineProperty(window, '__pointerListeners', { get: () => live });
  });
}

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('every heading is readable and nothing lights', async ({ page }) => {
    await page.goto('/sign/');

    for (const id of SIGNS) {
      const heading = page.getByRole('heading', { name: WORDS[id], exact: true });
      await expect(heading).toBeVisible();
      await expect(heading).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
      await expect(page.locator(`#${id}`)).not.toHaveAttribute('lit', '');
    }
    await expect(page.locator('canvas')).toHaveCount(0);
  });
});

test('every sign lights, and its heading goes transparent rather than hidden', async ({ page }) => {
  await lightAll(page);

  await expect(page.locator('#plain canvas')).toBeAttached();
  const heading = page.locator('#plain h1');
  await expect(heading).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  // Transparent, never hidden: the name has to stay in selection, find-in-page and the a11y tree.
  await expect(heading).toBeVisible();
  await expect(page.getByRole('heading', { name: 'klieg', exact: true })).toBeVisible();

  expect(await page.locator('body').ariaSnapshot()).toContain('heading "klieg" [level=1]');
});

test('the word the anchor supplied is never copied into a second node', async ({ page }) => {
  await lightAll(page);

  for (const id of SIGNS) {
    await expect(page.getByRole('heading', { name: WORDS[id], exact: true })).toHaveCount(1);
  }

  // `selectable` derives to `'none'` where the anchor supplied the text, so the host klieg appends
  // holds no letters of its own — the rendered text of the whole sign is the heading and nothing else.
  const rendered = await page.evaluate(
    (ids) => ids.map((id) => document.getElementById(id)?.innerText ?? ''),
    [...SIGNS],
  );
  expect(rendered).toEqual(['KLIEG', 'VARSIGN', 'HUESIGN']);
});

test('var() and currentColor reach the render as the two colors the page declared', async ({
  page,
}) => {
  await lightAll(page);

  const cyan = await meanColor(page, 'varTint');
  const gold = await meanColor(page, 'currentTint');
  expect(cyan.lit, 'the var()-tinted sign drew nothing to read a color from').toBeGreaterThan(0);
  expect(gold.lit, 'the currentColor sign drew nothing to read a color from').toBeGreaterThan(0);

  // `--accent` is #22d3ee: blue over green, and green far over red. Untinted, `tubing` reads
  // magenta — red over blue over green — so neither ordering below can pass on a dropped tint.
  expect(cyan.b, `var(--accent) rendered as rgb(${cyan.r}, ${cyan.g}, ${cyan.b})`).toBeGreaterThan(
    cyan.g,
  );
  expect(cyan.g).toBeGreaterThan(cyan.r * 2);

  // The third frame's inherited color is #d8b25f: red over green over blue.
  expect(gold.r, `currentColor rendered as rgb(${gold.r}, ${gold.g}, ${gold.b})`).toBeGreaterThan(
    gold.g,
  );
  expect(gold.g).toBeGreaterThan(gold.b);
});

test('removing a sign takes its canvas and its pointer listener with it', async ({ page }) => {
  await countPointerListeners(page);
  await lightAll(page);

  const live = () =>
    page.evaluate(() => (window as never as { __pointerListeners: number }).__pointerListeners);
  expect(await live(), 'each standing sign holds one global pointermove listener').toBe(3);

  await page.evaluate(() => document.getElementById('plain')?.remove());

  await expect(page.locator('#plain')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'klieg', exact: true })).toHaveCount(0);
  // A sign holds forever, so its listener lives as long as it does; nothing but disconnect frees it.
  expect(await live(), 'the removed sign never released its pointermove listener').toBe(2);

  for (const id of ['varTint', 'currentTint'] as const) {
    await expect(page.locator(`#${id} canvas`)).toBeAttached();
    await expect(page.locator(`#${id}`)).toHaveAttribute('lit', '');
  }
  await expect(page.locator('canvas')).toHaveCount(2);
});

test('three elements install one stylesheet between them', async ({ page }) => {
  await lightAll(page);
  await expect(page.locator('head style[data-klieg-sign]')).toHaveCount(1);
});
