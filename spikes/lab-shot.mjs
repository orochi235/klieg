// Screenshots a running lab and reports any console or page errors, which is the fastest way to
// tell a lab that renders from one that only loads. Needs the lab's dev server already up.
//   URL=http://localhost:5183/ OUT=/tmp/lab.png WAIT=6000 node spikes/lab-shot.mjs
import { chromium } from '@playwright/test';

const url = process.env.URL ?? 'http://localhost:5183/';
const out = process.env.OUT ?? '/tmp/lab.png';
const wait = Number(process.env.WAIT ?? 4000);

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
  viewport: { width: 1280, height: 1180 },
  deviceScaleFactor: 2,
  // Left to the OS, headless chromium can report `reduce`, and klieg then holds every piece
  // still — a blank-looking lab that is in fact working exactly as asked.
  reducedMotion: 'no-preference',
});

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`CONSOLE ${m.text().slice(0, 200)}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);
await page.screenshot({ path: out, fullPage: true });

console.log(errors.length ? errors.slice(0, 8).join('\n') : 'clean, no console errors');
console.log(`wrote ${out}`);
await browser.close();
process.exit(0);
