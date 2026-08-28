// Does one press do two things? klieg dismisses a `'click'` hold from a capture-phase listener on
// window, so a press that also lands on a host control drives both: the held effect advances and
// the host fires a new one. Runs the lab's acrostic, then clicks FIRE, and reports what is on
// screen and what the lab logged.
//   URL=http://localhost:5180/ OUT=/tmp/double.png node spikes/double-dispatch.mjs
import { chromium } from '@playwright/test';

const url = process.env.URL ?? 'http://localhost:5180/';
const out = process.env.OUT ?? '/tmp/double-dispatch.png';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
});
await page.goto(url, { waitUntil: 'load' });

const readLog = () =>
  page.evaluate(() => {
    const el = document.querySelector('#log') ?? document.querySelector('[id*="log"]');
    return el ? el.textContent.trim().split('\n').slice(-8).join('\n') : '(no #log found)';
  });

console.log(`policy: ${await page.locator('#policy').inputValue()}`);
await page.getByRole('button', { name: 'acrostic', exact: true }).click();
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(4000);
console.log(`\n--- after acrostic fired ---\n${await readLog()}`);

// The press that should do one thing: it lands on FIRE, and klieg is listening on window.
await page.getByRole('button', { name: 'FIRE', exact: true }).click();
await page.waitForTimeout(2500);
console.log(`\n--- after one press on FIRE ---\n${await readLog()}`);

await page.screenshot({ path: out });
console.log(`\nwrote ${out}`);
await browser.close();
process.exit(0);
