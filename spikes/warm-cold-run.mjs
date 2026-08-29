/**
 * Runs the mount-cost lab in a browser whose GPU shader cache has never seen these programs.
 * A fresh user-data-dir per launch is the whole point: ANGLE caches linked programs to the
 * profile, so a second run in the same profile answers a different question.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5399/mount-cost/';
const RUNS = Number(process.argv[3] ?? 3);

for (let i = 1; i <= RUNS; i++) {
  const dir = mkdtempSync(join(tmpdir(), 'klieg-cold-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    args: ['--use-angle=metal', '--enable-unsafe-webgpu'],
  });
  const page = await ctx.newPage();
  await page.goto(URL);
  const rows = await page.waitForFunction(() => window.RESULT, null, { timeout: 60_000 });
  const result = await rows.jsonValue();
  console.log(`\n=== cold run ${i}/${RUNS} (fresh profile ${dir}) ===`);
  for (const [label, ms] of result) {
    if (!/warm|first render|programs/.test(label)) continue;
    console.log(`  ${label}${Number.isNaN(ms) ? '' : `: ${ms.toFixed(1)}ms`}`);
  }
  await ctx.close();
}
