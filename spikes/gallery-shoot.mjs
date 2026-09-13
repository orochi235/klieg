/**
 * Three frames of the tube gallery, 1.5s apart, so a cycling look can be eyed for motion:
 *
 *   node spikes/gallery-shoot.mjs ./shots
 *
 * Needs the gallery already served on :5185 (`npm run dev:tube-gallery -w klieg`). Also prints the
 * rail's own note and fault lines, and any console errors, since a cell that fails to build says
 * so there rather than on the canvas.
 */
import { chromium } from '@playwright/test';

const out = process.argv[2];
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const t0 = Date.now();
await page.goto('http://localhost:5185/', { waitUntil: 'load' });
await page.waitForSelector('canvas');
console.log(`loaded in ${Date.now() - t0}ms; building cells`);
await page.waitForTimeout(20000);

const fault = await page.locator('.rail__fault').textContent().catch(() => null);
const note = await page.locator('.rail__note').textContent().catch(() => null);
console.log('note:', note);
console.log('fault:', fault ?? 'none');

for (let i = 0; i < 3; i++) {
  if (i) await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/gallery-${i}.png` });
  console.log(`shot ${i + 1}/3`);
}
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close();
