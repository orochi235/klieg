// Loads the /show/ route from a share link that holds on a click, which used to throw out of
// `fire` before the anchor could opt in. Fails loudly on any page error, then presses once and
// checks the hold actually released rather than the effect having never started.
//   URL=http://localhost:5180 node spikes/show-clickhold.mjs
import { chromium } from '@playwright/test';

const base = process.env.URL ?? 'http://localhost:5180';

const configs = [
  { name: 'top-level hold', config: { text: 'SLIDE ONE', looks: ['gold'], cycleMs: 0, hold: 'click' } },
  {
    name: 'acrostic, click to read',
    config: {
      text: 'NIGHT FALLS\nEVERY WINDOW\nONLY THE SIGN\nNOBODY READS',
      looks: ['neon'],
      cycleMs: 0,
      acronym: { caps: 0x2df0ff, read: 'click', hold: 'click' },
    },
  },
];

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
let failed = 0;

for (const [i, { name, config }] of configs.entries()) {
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    reducedMotion: 'no-preference',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`CONSOLE ${m.text().slice(0, 160)}`));

  const hash = Buffer.from(encodeURIComponent(JSON.stringify(config))).toString('base64');
  await page.goto(`${base}/show/#${hash}`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  const drew = await page.evaluate(() => !!document.querySelector('canvas'));

  // The drawing buffer is not `preserveDrawingBuffer`, so it reads back as zeros once the page
  // composites. Only a read inside rAF, after the library's own draw, sees what is on screen.
  const lit = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const c = document.querySelector('canvas');
          if (!c) return resolve(0);
          const gl = c.getContext('webgl2');
          const px = new Uint8Array(c.width * c.height * 4);
          requestAnimationFrame(() => {
            gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
            let n = 0;
            for (let k = 3; k < px.length; k += 4) if (px[k] !== 0) n++;
            resolve(n);
          });
        }),
    );

  // Well past any timed hold, so still being lit distinguishes "waiting for the press" from
  // "already finished and gone".
  await page.waitForTimeout(3000);
  const before = await lit();
  await page.mouse.click(400, 300);
  await page.waitForTimeout(2500);
  const after = await lit();

  const ok = errors.length === 0 && drew && before > 0 && after < before;
  if (!ok) failed++;
  console.log(
    `${i + 1}/${configs.length} ${name}: canvas=${drew} litWhileHeld=${before} litAfterClick=${after} ` +
      `errors=${errors.length} ${ok ? 'OK' : 'FAIL'}`,
  );
  for (const e of errors.slice(0, 4)) console.log(`     ${e}`);
  await page.close();
}

console.log(failed ? `\n${failed} failed` : '\nall clear');
await browser.close();
process.exit(failed ? 1 : 0);
