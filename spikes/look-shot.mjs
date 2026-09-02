/**
 * One look, rendered by the lab and written to a PNG, so a look change can be judged by eye.
 *
 *   node spikes/look-shot.mjs sequin out.png [text] [face]
 *
 * Drives the same controls the visual suite does and starts its own dev server on the port
 * playwright.config.ts derives for this worktree, so it never answers from another tree's server.
 */
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const [look = 'sequin', out = 'shot.png', text = 'JACKPOT!', face = 'default'] = process.argv.slice(2);

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = 5180 + ((createHash('sha1').update(root).digest()[0] ?? 0) % 64) + 1;

console.log(`starting a dev server on ${port}`);
const server = spawn(
  'npm',
  ['run', 'dev', '-w', '@klieg/lab', '--', '--port', String(port), '--strictPort'],
  { cwd: root, stdio: 'ignore' },
);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(`http://localhost:${port}/`, { timeout: 2000 });
      break;
    } catch (err) {
      if (attempt > 30) throw err;
      await page.waitForTimeout(500);
    }
  }

  await page.fill('#text', text);
  await page.fill('#hold', '8000');
  await page.fill('#blend', '0');
  await page.selectOption('#enter', 'none');
  await page.selectOption('#active', 'none');
  await page.selectOption('#exit', 'none');
  await page.selectOption('#lighting', 'static');
  await page.selectOption('#look', look);
  await page.selectOption('#font', face);
  await page.click('#fire');
  await page.waitForTimeout(900);
  await page.addStyleTag({ content: 'main, .dock { display: none; }' });
  await page.screenshot({ path: out });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
  server.kill();
}
