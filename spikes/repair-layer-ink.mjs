/**
 * Does a kliegsminister layer put ink on the canvas? Toggles it and compares the canvas by md5.
 *
 * A legend row appears when the layer's *source* has geometry, which is not the same claim as the
 * layer having stroked it — the `repair` layer carried a row and drew nothing for as long as
 * `drawn` was hardcoded null. Only the md5 answers the second question.
 *
 *   node spikes/repair-layer-ink.mjs [layer] [url]
 */
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const LAYER = process.argv[2] ?? 'repair';
const URL = process.argv[3] ?? 'http://localhost:5182/';
const OUT = process.env.OUT ?? '.';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(URL);
await page.waitForSelector('canvas');
await page.waitForTimeout(1500);

const toggle = page.getByLabel(`Toggle ${LAYER}`);
if ((await toggle.count()) !== 1) throw new Error(`no toggle for layer '${LAYER}'`);

const legend = () => page.locator('.legend__item').allTextContents();
const shot = async (tag) => {
  await page.waitForTimeout(400);
  const buf = await page.locator('canvas').first().screenshot({ path: `${OUT}/${LAYER}-${tag}.png` });
  const md5 = createHash('md5').update(buf).digest('hex');
  console.log(`${LAYER} ${tag}: ${md5}\n  legend: ${(await legend()).join(' | ')}`);
  return md5;
};

if (!(await toggle.isChecked())) await toggle.check();
const on = await shot('on');
await toggle.uncheck();
const off = await shot('off');

console.log(on === off ? `NO INK — '${LAYER}' draws nothing` : `INK — '${LAYER}' changes the canvas`);
await browser.close();
