// Compares the layer's letter pitch against the render's. The even bevel rim cancels out of
// centre-to-centre spacing, but the extrusion does not: in perspective a letter's silhouette is
// its front cap unioned with the body receding behind it, which for a letter off the centre line
// extends its ink run inward and drags the measured centre toward the middle of the screen.
// So read the per-pair ratios, never the mean. Equal ratios are a real scale error; ratios that
// sag toward the ends of the word are that inward bias, and say nothing about the layer.
//   URL=http://localhost:5199/ TEXT=HHHHH node spikes/layer-pitch.mjs
import { chromium } from '@playwright/test';

const url = process.env.URL ?? 'http://localhost:5199/';
const text = process.env.TEXT ?? 'HHHHH';

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
  viewport: { width: 800, height: 600 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
});

await page.goto(url, { waitUntil: 'load' });
await page.locator('#enter').selectOption('none');
await page.locator('#active').selectOption('none');
await page.locator('#hold').fill('20000');
await page.locator('#text').fill(text);
await page.locator('#selectable').selectOption('layer');
await page.getByRole('button', { name: 'FIRE', exact: true }).click();
await page.waitForSelector('canvas', { timeout: 15000 });
await page.waitForTimeout(2500);

// Where the browser would actually ink each span's glyph, from the same face at the same size.
const dom = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span')].filter(
    (s) => getComputedStyle(s).color === 'rgba(0, 0, 0, 0)' && s.textContent?.trim(),
  );
  const c = document.createElement('canvas').getContext('2d');
  return spans.map((s) => {
    const cs = getComputedStyle(s);
    const r = s.getBoundingClientRect();
    c.font = `${cs.fontSize} ${cs.fontFamily}`;
    const m = c.measureText(s.textContent);
    return {
      char: s.textContent,
      boxLeft: r.left,
      inkLeft: r.left - m.actualBoundingBoxLeft,
      inkRight: r.left + m.actualBoundingBoxRight,
    };
  });
});

// Where the render actually put ink, per letter, segmented by the clear columns between glyphs.
const ink = await page.evaluate(
  () =>
    new Promise((resolve, reject) => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return reject(new Error('no canvas'));
      const gl = canvas.getContext('webgl2');
      if (!gl) return reject(new Error('no webgl2'));
      const { width: w, height: h } = canvas;
      const px = new Uint8Array(w * h * 4);
      requestAnimationFrame(() => {
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width / w;
        const col = new Array(w).fill(false);
        for (let x = 0; x < w; x++)
          for (let y = 0; y < h; y++)
            if (px[(y * w + x) * 4 + 3] !== 0) {
              col[x] = true;
              break;
            }
        const runs = [];
        let start = -1;
        for (let x = 0; x <= w; x++) {
          if (x < w && col[x]) {
            if (start < 0) start = x;
          } else if (start >= 0) {
            runs.push({ left: rect.left + start * sx, right: rect.left + x * sx });
            start = -1;
          }
        }
        resolve(runs);
      });
    }),
);

console.log(`text=${JSON.stringify(text)}  spans=${dom.length}  ink runs=${ink.length}`);
if (dom.length !== ink.length) {
  console.log('!! counts differ - letters are touching; use a text whose glyphs stay apart');
  await browser.close();
  process.exit(1);
}

const mid = (b) => (b.inkLeft !== undefined ? (b.inkLeft + b.inkRight) / 2 : (b.left + b.right) / 2);
const domPitch = [];
const inkPitch = [];
for (let i = 1; i < dom.length; i++) {
  const d = mid(dom[i]) - mid(dom[i - 1]);
  const k = mid(ink[i]) - mid(ink[i - 1]);
  domPitch.push(d);
  inkPitch.push(k);
  console.log(
    `${i}/${dom.length - 1} '${dom[i - 1].char}'->'${dom[i].char}'  ` +
      `dom pitch=${d.toFixed(2)}px  render pitch=${k.toFixed(2)}px  ratio=${(k / d).toFixed(4)}`,
  );
}

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const ratio = avg(inkPitch) / avg(domPitch);
console.log(
  `\nmean dom pitch=${avg(domPitch).toFixed(2)}px  mean render pitch=${avg(inkPitch).toFixed(2)}px`,
);
console.log(`PITCH RATIO render/dom = ${ratio.toFixed(5)}   (1.0 = no scale error)`);
console.log(`drift across the word = ${((ratio - 1) * avg(domPitch) * (dom.length - 1)).toFixed(2)}px`);

await browser.close();
process.exit(0);
