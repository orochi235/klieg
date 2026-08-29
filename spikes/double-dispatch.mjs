// Does one press do two things? klieg dismisses a `'click'` hold from a capture-phase listener on
// window, so a press that also lands on a host control drives both: the held effect is dismissed
// and the host acts. Holds an effect in the lab, then presses FIRE once, and counts what the lab
// logged for that one press.
//   npm run dev -w apps/lab           # serves http://localhost:5180/
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
page.on('pageerror', (e) => console.log(`page error: ${e.message}`));
await page.goto(url, { waitUntil: 'load' });

/** The lab's own log, one line per fire and per completion, timestamps stripped. */
const readLog = () =>
  page.$eval('#log', (el) =>
    el.textContent
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/^\S+\s(?:AM|PM)?\s?/, '')),
  );

const count = (lines, verb) => lines.filter((l) => l.startsWith(verb)).length;

console.log(`policy: ${await page.locator('#policy').inputValue()}`);

// A held effect is the whole premise: without one there is nothing for the press to dismiss.
await page.locator('#holdClick').check();
await page.locator('#fire').click();
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(3000);

const before = await readLog();
console.log(`\n--- one effect fired, holding on click ---\n${before.join('\n')}`);
if (count(before, 'done') > 0) {
  console.log('\nNOT HOLDING — the effect already finished; nothing to dismiss. Check #holdClick.');
  await browser.close();
  process.exit(1);
}

// The press that should do one thing. It lands on FIRE, and klieg is listening on window.
await page.locator('#fire').click();
await page.waitForTimeout(3000);

const after = await readLog();
console.log(`\n--- after ONE press on FIRE ---\n${after.join('\n')}`);

const fires = count(after, 'fire') - count(before, 'fire');
const dones = count(after, 'done') - count(before, 'done');
console.log(`\none press produced: ${fires} new fire(s), ${dones} completion(s)`);
console.log(
  fires === 1 && dones === 1
    ? 'DOUBLE DISPATCH REPRODUCED — the press both dismissed the held effect and fired a new one.'
    : 'NOT REPRODUCED — one press did one thing.',
);

await page.screenshot({ path: out });
console.log(`\nwrote ${out}`);
await browser.close();
process.exit(fires === 1 && dones === 1 ? 0 : 2);
