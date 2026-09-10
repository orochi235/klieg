/**
 * The `cycle` effect piece's handover schedule, as pure timing — no renderer, no three.
 *
 *   node spikes/cycle-handover.mjs --parts 12 --every 3000 --deadline 800 --span 30000
 *
 * A part hands over at the first frame the outgoing piece is at rest, and is forced to swap once
 * it has been overdue by `deadline`. `stagger` spreads the nominal boundaries across the pool.
 * What this is here to answer: does every piece get its turn, how late does a handover land, and
 * does a part that falls more than one step behind skip a piece outright.
 */

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const PARTS = Number(arg('parts', '12'));
const EVERY = Number(arg('every', '3000'));
const DEADLINE = Number(arg('deadline', '800'));
const SPAN = Number(arg('span', '30000'));
const STAGGER = Number(arg('stagger', '0.6'));
const DT = Number(arg('dt', '16.67'));

/**
 * Stand-in pieces. Each answers only "am I at rest on this part right now", which is the whole
 * of what the handover reads.
 */
const PIECES = [
  // Phased per part, because every real piece takes its own `stagger`: parts do not reach rest
  // together, and modelling them as if they do hides whether the wipe survives the jitter.
  { name: 'flicker', rest: (t, at) => ((t * 1000 + at * 900) % 900) > 700 },
  { name: 'hue', rest: () => false },
  { name: 'chase', rest: (t, at) => Math.abs(((t * 1000) % 1400) / 1400 - at) > 0.35 },
];

const phaseOf = (index) => (PARTS < 2 ? 0 : (index / (PARTS - 1)) * STAGGER * EVERY);

const parts = Array.from({ length: PARTS }, (_, index) => ({
  index,
  at: PARTS < 2 ? 0 : index / (PARTS - 1),
  phase: phaseOf(index),
  current: 0,
  due: null,
  log: [],
  skipped: 0,
  late: [],
}));

for (let now = 0; now <= SPAN; now += DT) {
  for (const part of parts) {
    const elapsed = now - part.phase;
    const wanted = elapsed < 0 ? 0 : Math.floor(elapsed / EVERY);
    if (wanted > part.current) {
      if (part.due === null) part.due = part.phase + wanted * EVERY;
      const piece = PIECES[part.current % PIECES.length];
      const forced = now - part.due >= DEADLINE;
      if (piece.rest(now / 1000, part.at) || forced) {
        part.skipped += wanted - part.current - 1;
        part.late.push(now - part.due);
        part.current = wanted;
        part.log.push({ now, piece: PIECES[wanted % PIECES.length].name, forced });
        part.due = null;
      }
    }
  }
}

const pad = (n, w) => String(n).padStart(w);
const f1 = (n, w) => n.toFixed(1).padStart(w);

console.log(`parts ${PARTS}  every ${EVERY}ms  deadline ${DEADLINE}ms  stagger ${STAGGER}  span ${SPAN}ms\n`);
console.log('part  swaps  forced  skipped  maxLate  meanLate  order');
for (const part of parts) {
  const forced = part.log.filter((e) => e.forced).length;
  const maxLate = part.late.length ? Math.max(...part.late) : 0;
  const meanLate = part.late.length ? part.late.reduce((a, b) => a + b, 0) / part.late.length : 0;
  const order = part.log.slice(0, 6).map((e) => e.piece[0]).join('');
  console.log(
    `${pad(part.index, 4)}  ${pad(part.log.length, 5)}  ${pad(forced, 6)}  ${pad(part.skipped, 7)}  ${f1(maxLate, 7)}  ${f1(meanLate, 8)}  ${order}`,
  );
}

const seen = new Map();
for (const part of parts) for (const e of part.log) seen.set(e.piece, (seen.get(e.piece) ?? 0) + 1);
console.log('\nturns taken per piece:');
for (const p of PIECES) console.log(`  ${p.name.padEnd(8)} ${pad(seen.get(p.name) ?? 0, 4)}`);
const totalSkipped = parts.reduce((a, p) => a + p.skipped, 0);
console.log(`\nsteps skipped outright: ${totalSkipped}`);

/**
 * Does the wipe survive? The stagger spaces neighbouring parts by `stagger * every / (parts - 1)`;
 * rest-deferral adds up to `deadline` of jitter on top. If the jitter is the larger of the two the
 * handover stops reading as a sweep across the word and reads as noise.
 */
const spacing = (STAGGER * EVERY) / Math.max(1, PARTS - 1);
console.log(`\nneighbour spacing ${spacing.toFixed(1)}ms vs deadline jitter up to ${DEADLINE}ms`);
const steps = Math.min(...parts.map((p) => p.log.length));
let inOrder = 0;
let pairs = 0;
for (let k = 0; k < steps; k++) {
  const times = parts.map((p) => p.log[k].now);
  for (let i = 0; i + 1 < times.length; i++) {
    pairs++;
    if (times[i] <= times[i + 1]) inOrder++;
  }
}
console.log(`neighbouring pairs still sweeping in index order: ${inOrder}/${pairs} (${((inOrder / pairs) * 100).toFixed(1)}%)`);
