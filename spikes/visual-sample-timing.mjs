/**
 * Why would a visual spec read an empty drawing buffer while the page looks fine?
 *
 *   THROTTLE=10 node spikes/visual-sample-timing.mjs [url]
 *
 * Two candidate answers, and this settles which. Either the renderer skipped the frame the spec
 * sampled — the buffer is not `preserveDrawingBuffer`, so a frame nothing drew into reads back
 * cleared — or the effect had already exited, because klieg starts the hold's clock at `fire()`
 * while a spec cannot read a pixel until the canvas attaches.
 *
 * Measured answer: the renderer draws every frame while the effect is live, at every throttle
 * this can produce. It is the hold.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5180/';
const THROTTLE = Number(process.env.THROTTLE ?? 1);
const FRAMES = Number(process.env.FRAMES ?? 40);

const census = (count) =>
  new Promise((resolve, reject) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return reject(new Error('no canvas'));
    const gl = canvas.getContext('webgl2');
    if (!gl) return reject(new Error('no webgl2'));
    const { width, height } = canvas;
    const px = new Uint8Array(width * height * 4);
    let sampled = 0;
    let drawn = 0;
    let firstDrawnAt = -1;
    const step = () => {
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) lit++;
      if (lit > 0) {
        drawn++;
        if (firstDrawnAt < 0) firstDrawnAt = sampled;
      }
      sampled++;
      if (sampled < count) requestAnimationFrame(step);
      else resolve({ sampled, drawn, firstDrawnAt });
    };
    requestAnimationFrame(step);
  });

const browser = await chromium.launch();

async function open() {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  if (THROTTLE > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  }
  return { context, page };
}

async function fire(page, { still, holdMs }) {
  await page.goto(URL);
  if (still) {
    await page.locator('#enter').selectOption('none');
    await page.locator('#active').selectOption('none');
  }
  await page.locator('#hold').fill(String(holdMs));
  await page.locator('#text').fill('BIG MONEY');
  const firedAt = Date.now();
  await page.getByRole('button', { name: 'FIRE', exact: true }).click();
  await page.locator('canvas').waitFor({ state: 'attached', timeout: 30000 });
  return { firedAt, attachMs: Date.now() - firedAt };
}

// A fresh page per condition. Sampling N throttled frames of full-buffer readPixels costs seconds
// of wall clock, so a second census on the same page measures "much later in the hold" rather
// than the condition named — which is how this first reported the wrong culprit.
console.log(`draw rate per frame while the effect is live  [cpu x${THROTTLE}]`);
for (const still of [false, true]) {
  for (const settleMs of [0, 200]) {
    const { context, page } = await open();
    await fire(page, { still, holdMs: 30000 });
    if (settleMs) await page.waitForTimeout(settleMs);
    const r = await page.evaluate(census, FRAMES);
    console.log(
      `  ${still ? 'still ' : 'moving'} settle ${String(settleMs).padStart(3)}ms: ${String(r.drawn).padStart(3)}/${r.sampled} frames drew, first at frame ${r.firstDrawnAt}`,
    );
    await context.close();
  }
}

console.log(`\nis the effect still up when the spec first reads?  [cpu x${THROTTLE}]`);
for (const holdMs of [300, 4000, 30000]) {
  const { context, page } = await open();
  const { firedAt, attachMs } = await fire(page, { still: true, holdMs });
  await page.waitForTimeout(200);
  const r = await page.evaluate(census, 1);
  console.log(
    `  hold ${String(holdMs).padStart(5)}ms: attached at ${String(attachMs).padStart(5)}ms, sampled at ${String(Date.now() - firedAt).padStart(5)}ms -> ${r.drawn ? 'lit' : 'EMPTY, the effect had exited'}`,
  );
  await context.close();
}

await browser.close();
