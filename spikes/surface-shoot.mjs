import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

/**
 * Shoots every linkable surface in the inventory into `<out>/<id>.png`, plus a manifest:
 *
 *   node spikes/surface-shoot.mjs ./shots [id,id]
 *
 * Serially, rather than in parallel: most of these hold a WebGL context, and several at once
 * contend for the same software rasterizer and produce black frames that look like a render bug.
 *
 * Nothing here starts a server. The ports are whatever each lab was serving on when this was
 * written, so a lab moved since needs its entry edited; a target with nothing behind it fails its
 * own row and the rest carry on.
 */

const OUT = process.argv[2] ?? './shots';
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;

/** Off this file's own location, so the harness runs from any checkout. */
const file = (p) => new URL(`../${p}`, import.meta.url).href;

const TARGETS = [
  // apps/lab, tier one
  { id: 'lab', url: 'http://localhost:5195/', click: '#fire', wait: 9000 },
  { id: 'show', url: 'http://localhost:5195/show/', wait: 10000 },
  { id: 'strip', url: 'http://localhost:5195/strip/', click: '#fire', wait: 9000 },
  { id: 'sign', url: 'http://localhost:5195/sign/', wait: 11000 },

  // apps/lab, tier two — dev only
  { id: 'pave-compare', url: 'http://localhost:5195/pave-compare/', wait: 26000 },
  // Both were shot too early the first time: pave-spin came back pure black, and backdrop-cost
  // caught its table two rows in, still printing "measuring…". SwiftShader is the reason — these
  // waits are for a software rasterizer, not for the page.
  { id: 'pave-spin', url: 'http://localhost:5195/pave-spin/', wait: 75000 },
  { id: 'backdrop-cost', url: 'http://localhost:5195/backdrop-cost/', wait: 75000 },
  { id: 'mount-cost', url: 'http://localhost:5195/mount-cost/', wait: 16000 },

  // the React labs
  { id: 'tube-lab', url: 'http://localhost:5181/', wait: 22000 },
  { id: 'kliegsminister', url: 'http://localhost:5182/', wait: 13000 },
  { id: 'composition-lab', url: 'http://localhost:5184/', wait: 20000 },
  { id: 'tube-gallery', url: 'http://localhost:5185/', wait: 26000 },

  // spike labs
  // 5199 was held by an unrelated project with --strictPort when this ran. The repo-root vite
  // has no port of its own, so it gets one that is free here rather than the one the docs name.
  // `load` never fires here: the page builds tube geometry from art.svg before it settles, so a
  // goto waiting on load times out and leaves whatever was on disk under this name.
  { id: 'svg-tube', url: 'http://localhost:5196/spikes/svg-tube/', until: 'domcontentloaded', wait: 30000 },
  { id: 'seek-rebuild', url: 'http://localhost:5196/spikes/seek-rebuild/', wait: 12000 },
  { id: 'composition-readout', url: file('spikes/composition-readout.html'), wait: 3500 },
  { id: 'material-and-composite', url: file('spikes/material-and-composite.html'), wait: 11000 },
];

const jobs = TARGETS.filter((t) => !only || only.has(t.id));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const results = [];

for (const [i, target] of jobs.entries()) {
  const at = `${String(i + 1).padStart(2)}/${jobs.length}`;
  const started = Date.now();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

  let status = 'ok';
  try {
    await page.goto(target.url, { waitUntil: target.until ?? 'load', timeout: 25000 });
    if (target.click) {
      await page
        .locator(target.click)
        .click({ timeout: 4000 })
        .catch(() => {});
    }
    await page.waitForTimeout(target.wait);
    await page.screenshot({ path: `${OUT}/${target.id}.png` });
  } catch (err) {
    status = `FAILED ${String(err.message ?? err).split('\n')[0].slice(0, 90)}`;
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  results.push({ id: target.id, status, errors: errors.slice(0, 2) });
  console.log(
    `${at}  ${target.id.padEnd(23)} ${String(secs).padStart(5)}s  ${status}` +
      (errors.length ? `  [${errors.length} page error${errors.length > 1 ? 's' : ''}]` : ''),
  );
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(results, null, 2)}\n`);
const bad = results.filter((r) => r.status !== 'ok');
console.log(`\ndone — ${results.length - bad.length}/${results.length} shot`);
if (bad.length) console.log('failed:', bad.map((r) => r.id).join(', '));
