import { expect, type Page, test } from '@playwright/test';

/** Alpha census of one frame of the overlay's drawing buffer. */
interface Frame {
  lit: number;
  clear: number;
  total: number;
}

interface Reading {
  frames: number;
  drawn: number;
  best: Frame;
}

const SAMPLE_FRAMES = 24;

/**
 * Reports the busiest of `frames` consecutive frames of the overlay's own drawing buffer.
 *
 * `readPixels` after the effect settles returns zeros — the buffer is not `preserveDrawingBuffer`,
 * so it is cleared once the page composites. Reading from `requestAnimationFrame`, which runs
 * after the library's own rAF-driven draw, is the only way to see what the overlay put on screen.
 */
function readOverlay(page: Page, frames: number): Promise<Reading> {
  return page.evaluate(
    (count) =>
      new Promise<Reading>((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));

        const { width, height } = canvas;
        const px = new Uint8Array(width * height * 4);
        const total = width * height;
        let sampled = 0;
        let drawn = 0;
        let best: Frame = { lit: 0, clear: total, total };

        const step = () => {
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let lit = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) lit++;

          sampled++;
          if (lit > 0) drawn++;
          if (lit > best.lit) best = { lit, clear: total - lit, total };

          if (sampled < count) requestAnimationFrame(step);
          else resolve({ frames: sampled, drawn, best });
        };
        requestAnimationFrame(step);
      }),
    frames,
  );
}

/** Fires one long-held effect and returns once its canvas is on the page. */
async function fire(page: Page, options: { bloom: boolean }): Promise<void> {
  await page.goto('/');
  // Long enough that the sampler, slowed by a full-buffer readPixels per frame, stays inside it.
  await page.locator('#hold').fill('4000');
  if (options.bloom) await page.locator('#bloom').selectOption('on');
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
}

function expectTransparentOverlay(reading: Reading): void {
  expect(
    reading.drawn,
    `not one of ${reading.frames} sampled frames held a non-transparent pixel: either the letters never drew, or the sampler never caught a live draw and the check below proves nothing`,
  ).toBeGreaterThan(0);
  expect(
    reading.best.clear,
    `the overlay composited as an opaque rectangle: ${reading.best.lit} of ${reading.best.total} pixels are non-transparent`,
  ).toBeGreaterThan(reading.best.lit);
}

test('the direct path lights the letters and leaves the rest of the overlay transparent', async ({
  page,
}) => {
  await fire(page, { bloom: false });
  expectTransparentOverlay(await readOverlay(page, SAMPLE_FRAMES));
});

// The composite shader computes the glow's alpha as max(base.a, luma * alphaBoost), which is the
// likeliest place for the whole canvas to go opaque. The direct path never runs that shader.
test('the bloom path lights the letters and leaves the rest of the overlay transparent', async ({
  page,
}) => {
  await fire(page, { bloom: true });
  expectTransparentOverlay(await readOverlay(page, SAMPLE_FRAMES));
});

/**
 * Number of separated horizontal bands of lit rows. Counting bands rather than pixels is what
 * makes this independent of the fitted scale: a block that wraps to two lines shrinks to stay
 * inside the budget, so it does not reliably light more pixels than one line does.
 */
function litBands(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));

        const { width, height } = canvas;
        const px = new Uint8Array(width * height * 4);

        // Inside rAF, after the library's own draw: the buffer is not preserveDrawingBuffer, so
        // reading it any later returns a cleared frame and every band census comes back zero.
        requestAnimationFrame(() => {
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);

          let bands = 0;
          let inBand = false;
          for (let y = 0; y < height; y++) {
            let lit = false;
            for (let x = 0; x < width && !lit; x++) {
              if (px[(y * width + x) * 4 + 3] !== 0) lit = true;
            }
            if (lit && !inBand) bands++;
            inBand = lit;
          }
          resolve(bands);
        });
      }),
  );
}

/** Holds a still, fully-arrived word so the band census is not sampled mid-flight. */
async function fireStill(page: Page, text: string): Promise<void> {
  await page.goto('/');
  await page.locator('#enter').selectOption('none');
  await page.locator('#active').selectOption('none');
  await page.locator('#hold').fill('4000');
  await page.locator('#text').fill(text);
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
  await page.waitForTimeout(200);
}

test('a two-line block draws a second row of letters', async ({ page }) => {
  await fireStill(page, 'BIG');
  expect(await litBands(page)).toBe(1);

  await fireStill(page, 'BIG\nMONEY');
  expect(await litBands(page)).toBe(2);
});

test('wrap breaks a long line into rows, and leaves it alone unchecked', async ({ page }) => {
  await fireStill(page, 'BIG MONEY PRIZE');
  expect(await litBands(page)).toBe(1);

  await page.goto('/');
  await page.locator('#enter').selectOption('none');
  await page.locator('#active').selectOption('none');
  await page.locator('#hold').fill('4000');
  await page.locator('#wrap').check();
  await page.locator('#text').fill('BIG MONEY PRIZE');
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
  await page.waitForTimeout(200);

  expect(await litBands(page)).toBeGreaterThan(1);
});

test('an effect held until click stays up, and the click dismisses it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#holdClick').check();
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();

  // Far past the 1200ms default hold: a held effect has no timeout to reach.
  await page.waitForTimeout(3000);
  expect((await readOverlay(page, 4)).drawn).toBeGreaterThan(0);
  await expect(page.locator('#log')).not.toContainText('done');

  await page.mouse.click(400, 500);
  await expect(page.locator('#log')).toContainText('done');
});

test('the dismissing click still reaches the page when the hold is not modal', async ({ page }) => {
  await page.goto('/');
  await page.locator('#holdClick').check();
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
  await page.waitForTimeout(500);

  // One click on FIRE: it dismisses the held effect and presses the button underneath.
  await page.getByRole('button', { name: 'FIRE', exact: true }).click({ timeout: 5000 });

  await expect(page.locator('#log')).toContainText('done');
  expect((await page.locator('#log').innerText()).match(/fire /g)?.length).toBe(2);
});

test('the overlay does not intercept clicks meant for the page beneath it', async ({ page }) => {
  await fire(page, { bloom: false });
  // The canvas covers the panel at z-index 2147483000, so this second click only reaches the
  // button if pointer-events:none holds; without it Playwright times out on the action itself.
  await page.locator('#text').fill('SECOND');
  await page.getByRole('button', { name: 'FIRE', exact: true }).click({ timeout: 5000 });
  await expect(page.locator('#log')).toContainText('fire "SECOND"');
});

/** A serialisable box: Playwright's evaluate serialiser does not carry a `DOMRect` across. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const width = (box: Box) => box.right - box.left;
const height = (box: Box) => box.bottom - box.top;
const midX = (box: Box) => (box.left + box.right) / 2;
const midY = (box: Box) => (box.top + box.bottom) / 2;

// The first fire in a fresh page compiles the overlay's shaders, which stalls the main thread for
// seconds under a software GPU — so nothing below sleeps for the layer, and the hold outlasts it.
const SELECTABLE_HOLD_MS = 20000;
// Under the 30s test timeout, so a layer that never arrives reports the poll's own message.
const LAYER_TIMEOUT_MS = 15000;

/** Fires one still, long-held word under a chosen `selectable` mode. */
async function fireSelectable(page: Page, mode: string, text = 'BIG'): Promise<void> {
  await page.goto('/');
  await page.locator('#enter').selectOption('none');
  await page.locator('#active').selectOption('none');
  await page.locator('#hold').fill(String(SELECTABLE_HOLD_MS));
  await page.locator('#text').fill(text);
  await page.locator('#selectable').selectOption(mode);
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(page.locator('canvas')).toBeAttached();
}

/**
 * Boxes of the layer's spans in DOM order, empty where no layer was built. They are found by the
 * transparent colour only they carry: the library gives its nodes no class or attribute to match.
 */
function layerBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('span')]
      .filter((s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)')
      .map((s) => {
        const r = s.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }),
  );
}

/** The clipped tier-1 node, with the text a copy or a find-in-page would actually reach. */
function hiddenNode(page: Page): Promise<{ text: string; rendered: string } | null> {
  return page.evaluate(() => {
    const node = [...document.querySelectorAll('span')].find(
      (s) => getComputedStyle(s).clipPath === 'inset(50%)',
    );
    return node ? { text: node.textContent ?? '', rendered: node.innerText } : null;
  });
}

/** Waits for the built layer and returns its spans' boxes. */
async function settledLayer(page: Page): Promise<Box[]> {
  await expect
    .poll(async () => (await layerBoxes(page)).length, {
      message: 'the layer never built a single span',
      timeout: LAYER_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);
  return layerBoxes(page);
}

/**
 * Waits until the overlay has drawn a lit frame. An absence check that skips this proves nothing:
 * the DOM is empty before the first fire reaches the screen whatever the mode was.
 */
async function waitForDraw(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readOverlay(page, 2)).drawn, {
      message: 'the overlay never drew a lit frame',
      timeout: LAYER_TIMEOUT_MS,
    })
    .toBeGreaterThan(0);
}

/** Bounding box of every non-transparent pixel the overlay drew, in the canvas's CSS coordinates. */
function inkBox(page: Page): Promise<Box | null> {
  return page.evaluate(
    () =>
      new Promise<Box | null>((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));

        const { width: w, height: h } = canvas;
        const px = new Uint8Array(w * h * 4);
        // Inside rAF, after the library's own draw: the buffer is not preserveDrawingBuffer.
        requestAnimationFrame(() => {
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let left = w;
          let right = -1;
          let low = h;
          let high = -1;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (px[(y * w + x) * 4 + 3] === 0) continue;
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < low) low = y;
              if (y > high) high = y;
            }
          }
          if (right < 0) return resolve(null);
          const rect = canvas.getBoundingClientRect();
          const scale = rect.height / h;
          // readPixels counts rows from the bottom; the DOM counts them from the top.
          resolve({
            left: rect.left + left * (rect.width / w),
            right: rect.left + right * (rect.width / w),
            top: rect.top + (h - 1 - high) * scale,
            bottom: rect.top + (h - 1 - low) * scale,
          });
        });
      }),
  );
}

/** Drags from inside the first letter to inside the last, and reports what got selected. */
async function dragAcrossLayer(page: Page, boxes: Box[]): Promise<string> {
  const from = boxes[0];
  const to = boxes[boxes.length - 1];
  if (!from || !to) throw new Error('the layer built no spans to drag across');
  await page.mouse.move(from.left + 2, midY(from));
  await page.mouse.down();
  await page.mouse.move(to.right - 2, midY(to), { steps: 10 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

/** Box of the layer's whitespace span: carried so a copy keeps the gap, but not clickable. */
function gapBox(page: Page): Promise<Box | null> {
  return page.evaluate(() => {
    const gap = [...document.querySelectorAll('span')].find(
      (s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)' && s.textContent?.trim() === '',
    );
    if (!gap) return null;
    const r = gap.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
}

/** The element a click at this point would land on, as its tag and the letter it carries. */
function hitAt(page: Page, x: number, y: number): Promise<{ tag: string; text: string } | null> {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? { tag: el.tagName, text: el.textContent ?? '' } : null;
    },
    { x, y },
  );
}

test('the hidden node puts the word in the DOM without a layer', async ({ page }) => {
  await fireSelectable(page, 'hidden');
  await waitForDraw(page);
  // `rendered` is the difference between find-in-page reaching the word and not: a node clipped
  // to nothing still carries its text, one taken out of the layout with `display:none` does not.
  expect(await hiddenNode(page)).toEqual({ text: 'BIG', rendered: 'BIG' });
  expect(await layerBoxes(page)).toHaveLength(0);
});

test('none puts no klieg text in the page at all', async ({ page }) => {
  await fireSelectable(page, 'none');
  await waitForDraw(page);
  // Not `document.body.innerText`: the lab's own #log echoes every fired string, so it holds
  // 'BIG' whatever the mode did, and a body-wide check would pass with the feature ripped out.
  expect(await hiddenNode(page)).toBeNull();
  expect(await layerBoxes(page)).toHaveLength(0);
});

test('a drag across the layer selects the word', async ({ page }) => {
  await fireSelectable(page, 'layer');
  expect((await dragAcrossLayer(page, await settledLayer(page))).trim()).toBe('BIG');
});

test('the layer sits over the glyphs it names', async ({ page }) => {
  await fireSelectable(page, 'layer');
  const boxes = await settledLayer(page);
  const span = {
    left: Math.min(...boxes.map((b) => b.left)),
    right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
  const ink = await inkBox(page);
  expect(ink, 'the overlay drew nothing to compare the layer against').not.toBeNull();
  if (!ink) return;

  // The em boxes contain the ink, bar a few pixels the extrusion pushes past the front face.
  const SLACK = 8;
  expect(ink.left).toBeGreaterThan(span.left - SLACK);
  expect(ink.right).toBeLessThan(span.right + SLACK);
  expect(ink.top).toBeGreaterThan(span.top - SLACK);
  expect(ink.bottom).toBeLessThan(span.bottom + SLACK);

  // Containment alone would let the layer be any size at all around the word.
  expect(width(span)).toBeLessThan(width(ink) * 1.15);
  expect(height(span)).toBeLessThan(height(ink) * 1.5);
  expect(Math.abs(midX(span) - midX(ink))).toBeLessThan(10);
  expect(Math.abs(midY(span) - midY(ink))).toBeLessThan(10);
});

test('a letter in the layer takes the click the page would otherwise get', async ({ page }) => {
  await fireSelectable(page, 'layer');
  const box = (await settledLayer(page))[0];
  if (!box) throw new Error('the layer built no spans');
  expect(await hitAt(page, midX(box), midY(box))).toEqual({ tag: 'SPAN', text: 'B' });
});

test('a two-line word copies with the break between its lines', async ({ page }) => {
  await fireSelectable(page, 'layer', 'BIG\nMONEY');
  expect((await dragAcrossLayer(page, await settledLayer(page))).trim()).toBe('BIG\nMONEY');
});

test('a space is carried for the copy but does not take a click', async ({ page }) => {
  await fireSelectable(page, 'layer', 'BIG WIN');
  const boxes = await settledLayer(page);
  expect((await dragAcrossLayer(page, boxes)).trim()).toBe('BIG WIN');

  // The gap between the words is a span like any other, and the only one a click falls through.
  const gap = await gapBox(page);
  expect(gap, 'the layer built no whitespace span').not.toBeNull();
  if (!gap) return;
  expect((await hitAt(page, midX(gap), midY(gap)))?.tag).not.toBe('SPAN');
});
