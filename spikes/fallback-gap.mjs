// Measures the neon's painted ink against the DOM fallback it replaces, under an element placement.
// The question the handoff asks: is the neon smaller by a consistent ratio — a fit bug to fix — or
// by one that drifts with the text and the box, which is a knob the caller needs?
//
//   node spikes/fallback-gap.mjs
//
// Two things the instrument has to get right, both of which read backwards if missed:
//
// Both sides are measured as INK. A fallback's client rect carries its line-height's leading, so
// comparing rects reports a gap no viewer can see.
//
// Ink is alpha >= 128, not alpha > 0. A lit tube lays a wide faint glow over the whole anchor —
// measured 13,477 pixels under alpha 32 against 3,200 over 224 — so counting every non-transparent
// pixel measures the light and reports the word as tall as its box. The fixture fires with
// `bloom: false` as well; the threshold is what covers the look's own emission.
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5213);
const INK_ALPHA = 128;

/** The reporter's own case is the middle one; the other two bracket it. */
const FRAMINGS = [
  { name: 'default 0.62×0.30', width: 0.62, height: 0.3 },
  { name: 'reporter 0.78×0.55', width: 0.78, height: 0.55 },
  { name: 'strip lab 0.94×0.66', width: 0.94, height: 0.66 },
];
const CASES = [
  { text: 'klieg', boxWidth: 439, boxHeight: 86, fontSize: 28 },
  { text: 'MICHAEL BAKER', boxWidth: 439, boxHeight: 86, fontSize: 28 },
  { text: 'ABC', boxWidth: 880, boxHeight: 120, fontSize: 28 },
  { text: 'MICHAEL BAKER', boxWidth: 880, boxHeight: 120, fontSize: 40 },
];

const server = spawn(
  'npx',
  ['vite', '--config', 'spikes/fallback-gap/vite.config.ts', '--port', String(PORT), '--strictPort'],
  { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' },
);
process.on('exit', () => server.kill());

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
  viewport: { width: 1100, height: 400 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
});
page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`));

let up = false;
for (let attempt = 0; attempt < 60 && !up; attempt++) {
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 2000 });
    up = true;
  } catch {
    await page.waitForTimeout(1000);
  }
}
if (!up) {
  console.log('the fixture server never came up');
  process.exit(1);
}

/**
 * The fallback's ink, from the heading's own computed style. `measureText`'s actual bounding box is
 * the painted extent rather than the advance, which is what the drawing buffer reports for the
 * neon — the two are comparable only because neither counts leading or side bearing.
 */
const fallbackInk = () =>
  page.evaluate(() => {
    const heading = document.getElementById('heading');
    const cs = getComputedStyle(heading);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    // The heading sets letter-spacing and uppercases; without both the fallback measures narrower
    // than it paints.
    ctx.letterSpacing = cs.letterSpacing;
    const shown =
      cs.textTransform === 'uppercase' ? heading.textContent.toUpperCase() : heading.textContent;
    const m = ctx.measureText(shown);
    return {
      width: m.actualBoundingBoxRight + m.actualBoundingBoxLeft,
      height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    };
  });

/** Bounding box of every pixel the overlay painted at or over the ink threshold, in CSS pixels. */
const neonInk = (threshold) =>
  page.evaluate(
    (min) =>
      new Promise((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));
        const { width: w, height: h } = canvas;
        const px = new Uint8Array(w * h * 4);
        requestAnimationFrame(() => {
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let left = w;
          let right = -1;
          let low = h;
          let high = -1;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (px[(y * w + x) * 4 + 3] < min) continue;
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < low) low = y;
              if (y > high) high = y;
            }
          }
          if (right < 0) return resolve(null);
          const rect = canvas.getBoundingClientRect();
          resolve({
            width: (right - left) * (rect.width / w),
            height: (high - low) * (rect.height / h),
          });
        });
      }),
    threshold,
  );

const rows = [];
const total = FRAMINGS.length * CASES.length;
let done = 0;

for (const framing of FRAMINGS) {
  for (const c of CASES) {
    done++;
    const label = `${c.text} ${c.boxWidth}×${c.boxHeight} @${c.fontSize}px`;
    await page.evaluate(
      (args) => window.setCase(args),
      { ...c, framing: { width: framing.width, height: framing.height } },
    );
    const fallback = await fallbackInk();
    await page.evaluate(() => window.fireCase());

    let neon = null;
    for (let frame = 0; frame < 30 && !neon; frame++) {
      neon = await neonInk(INK_ALPHA);
      if (!neon) await page.waitForTimeout(200);
    }
    await page.evaluate(() => window.teardown());

    if (!neon) {
      console.log(`${done}/${total}  ${framing.name}  ${label} — NEON NEVER DREW`);
      continue;
    }

    const ratio = neon.height / fallback.height;
    rows.push({ framing: framing.name, ...c, ratio, fallback, neon });
    console.log(
      `${done}/${total}  ${framing.name}  ${label.padEnd(34)} ` +
        `ink h ${fallback.height.toFixed(1)} → ${neon.height.toFixed(1)}  ×${ratio.toFixed(3)}`,
    );
  }
}

if (rows.length === 0) {
  await browser.close();
  server.kill();
  console.log('\nnothing measured');
  process.exit(1);
}

console.log('');
for (const framing of FRAMINGS) {
  const mine = rows.filter((r) => r.framing === framing.name).map((r) => r.ratio);
  if (mine.length === 0) continue;
  const lo = Math.min(...mine);
  const hi = Math.max(...mine);
  const mean = mine.reduce((a, b) => a + b, 0) / mine.length;
  const spread = (hi - lo) / mean;
  const verdict = mean < 1 ? 'SMALLER than the fallback' : 'LARGER than the fallback';
  console.log(
    `${framing.name.padEnd(20)} mean ×${mean.toFixed(3)}  ` +
      `spread ${(spread * 100).toFixed(1)}%  — ${verdict}`,
  );
}

const all = rows.map((r) => r.ratio);
const spreadAll = (Math.max(...all) - Math.min(...all)) / (all.reduce((a, b) => a + b) / all.length);
console.log(
  `\nacross every framing the ratio spreads ${(spreadAll * 100).toFixed(1)}%, so no single` +
    ' scale correction closes it.',
);

// The mechanism, isolated: one box, one fallback size, a name that grows a word at a time. The
// fallback holds its CSS size; a width-bound fit gives the neon less per letter added.
console.log('\nthe same anchor, a longer name each time — reporter framing, 28px fallback:\n');
const NAMES = ['MB', 'M BAKER', 'MICHAEL BAKER', 'MICHAEL S BAKER', 'MICHAEL SEBASTIAN BAKER'];
const sweep = [];
for (let i = 0; i < NAMES.length; i++) {
  const text = NAMES[i];
  await page.evaluate((args) => window.setCase(args), {
    text,
    boxWidth: 439,
    boxHeight: 86,
    fontSize: 28,
    framing: { width: 0.78, height: 0.55 },
  });
  const fallback = await fallbackInk();
  await page.evaluate(() => window.fireCase());
  let neon = null;
  for (let frame = 0; frame < 30 && !neon; frame++) {
    neon = await neonInk(INK_ALPHA);
    if (!neon) await page.waitForTimeout(200);
  }
  await page.evaluate(() => window.teardown());
  if (!neon) {
    console.log(`  ${String(i + 1).padStart(2)}/${NAMES.length}  ${text} — NEON NEVER DREW`);
    continue;
  }
  const ratio = neon.height / fallback.height;
  sweep.push({ text, ratio, neon: neon.height, fallback: fallback.height });
  console.log(
    `  ${String(i + 1).padStart(2)}/${NAMES.length}  ${text.padEnd(24)} ` +
      `fallback ${fallback.height.toFixed(1)}  neon ${neon.height.toFixed(1)}  ` +
      `×${ratio.toFixed(3)}${ratio < 1 ? '  <- SMALLER' : ''}`,
  );
}

const shrinking = sweep.every((r, i) => i === 0 || r.neon <= sweep[i - 1].neon);
const crossover = sweep.find((r) => r.ratio < 1);
console.log(
  `\nthe neon ${shrinking ? 'falls monotonically' : 'does NOT fall monotonically'} as the name` +
    ' grows, while the fallback holds its CSS size.',
);
console.log(
  crossover
    ? `it passes under the fallback at "${crossover.text}" — so whether the neon looks small is a\nfunction of the string, not a constant the fit is missing.`
    : 'it never passes under the fallback across this range; a longer name or a larger fallback\nis what the report needs to be reproduced.',
);
await browser.close();
server.kill();
process.exit(0);
