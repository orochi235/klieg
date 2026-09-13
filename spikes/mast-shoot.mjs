import { readFileSync } from 'node:fs';
import playwright from '@playwright/test';

// Screenshot harness for the masthead proofs. Two departures from the original _mast-tmp.mjs:
// `lt` is no longer hard-coded (hash parsing takes the first duplicate key, so an appended
// override would silently lose), and a `bg=` token injects a page background so haze treatments
// can be tried without editing the show page out from under a running dev server.
const [, , combosFile, outDir, text, only] = process.argv;
const combos = JSON.parse(readFileSync(combosFile, 'utf8'));
const heavy = new Set(['ice', 'sequin', 'tubing', 'piping', 'glitter', 'flake']);

// `html body` rather than !important: the page sets its own background on `body`.
const BG = {
  haze: '#07080c radial-gradient(70% 55% at 50% 45%, #232a38 0%, #0b0d13 55%, #07080c 78%)',
  blue: '#05060a radial-gradient(62% 52% at 48% 44%, #1d2c52 0%, #121a33 38%, #07080c 72%)',
  warm: '#0a0708 radial-gradient(64% 54% at 50% 46%, #46243a 0%, #21131f 40%, #0a0708 74%)',
  deep: '#05060a radial-gradient(80% 62% at 50% 42%, #2b3358 0%, #151a2e 32%, #080a11 66%, #05060a 100%)',
};

const browser = await playwright.chromium.launch();
const jobs = combos.map((c, i) => ({ c, i })).filter(({ i }) => !only || only.split(',').includes(String(i + 1)));
let done = 0;
async function shoot({ c: [font, look, ...rest], i }) {
  const cased = rest.includes('up') ? text.toUpperCase() : rest.includes('low') ? text.toLowerCase() : text;
  const extra = rest.filter((e) => e !== 'up' && e !== 'low');
  const page = await browser.newPage({ viewport: { width: 1500, height: 420 } });
  const bg = extra.find((e) => e.startsWith('bg='))?.slice(3);
  const q = [
    `t=${encodeURIComponent(cased)}`,
    `lk=${look}`,
    `fn=${font}`,
    ...(extra.some((e) => e.startsWith('lt=')) ? [] : ['lt=static']),
    'ch=0',
    'wr=0',
    'en=none',
    'ac=none',
    ...extra.filter((e) => !e.startsWith('bg=')),
  ].join('&');
  await page.goto(`http://localhost:5195/show/#${q}`);
  if (bg && BG[bg]) await page.addStyleTag({ content: `html body { background: ${BG[bg]}; }` });
  await page.waitForTimeout(heavy.has(look) ? 11000 : 6000);
  const n = String(i + 1).padStart(2, '0');
  await page.screenshot({ path: `${outDir}/${n}.png` });
  await page.close();
  console.log(`${String(++done).padStart(2)}/${jobs.length}  #${n}  ${font} ${look} ${rest.join(' ')}`);
}
const queue = [...jobs];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) await shoot(queue.shift()); }));
await browser.close();
