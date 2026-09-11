/**
 * Self time by function out of a `--cpu-prof` profile, so a phase breakdown can say what inside a
 * phase is hot rather than only how big the phase is.
 *
 *   node --cpu-prof --cpu-prof-dir=/tmp/prof spikes/<something>.mjs
 *   node spikes/prof-top.mjs /tmp/prof [rows]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '/tmp/prof';
const ROWS = Number(process.argv[3] ?? 24);

const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
if (!file) throw new Error(`no .cpuprofile in ${dir}`);
const prof = JSON.parse(readFileSync(join(dir, file), 'utf8'));

const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 1; i < prof.samples.length; i++) {
  const dt = prof.timeDeltas[i] ?? 0;
  self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + dt);
}

const rows = new Map();
for (const [id, us] of self) {
  const frame = byId.get(id)?.callFrame;
  if (!frame) continue;
  const where = (frame.url ?? '').replace(/^.*\/(packages|node_modules|spikes)\//, '$1/');
  const key = `${frame.functionName || '(anonymous)'}  ${where}`;
  rows.set(key, (rows.get(key) ?? 0) + us / 1000);
}

const total = [...rows.values()].reduce((a, b) => a + b, 0);
console.log(`${total.toFixed(0)}ms sampled\n`);
console.log(`      ms   share  function`);
for (const [key, msTotal] of [...rows].sort((a, b) => b[1] - a[1]).slice(0, ROWS)) {
  console.log(`  ${msTotal.toFixed(1).padStart(7)}  ${((msTotal / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}

const byFile = new Map();
for (const [key, msTotal] of rows) {
  const where = key.split('  ').pop() || '(unknown)';
  byFile.set(where, (byFile.get(where) ?? 0) + msTotal);
}
console.log(`\n      ms   share  file`);
for (const [where, msTotal] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${msTotal.toFixed(1).padStart(7)}  ${((msTotal / total) * 100).toFixed(1).padStart(5)}%  ${where}`);
}
