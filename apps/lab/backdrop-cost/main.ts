/**
 * What a backdrop costs per frame, which is the cost the build measurement cannot see.
 *
 * `spikes/fire-build-cost.mjs` answers what the rows cost to build. This answers the other half:
 * every row is another copy of the part pool, and the effect compositor walks every part of it
 * every frame. Driven through `createKlieg` on a `ManualClock`, so each `advance` is one real
 * frame — pose write, effect layer, material writes and the draw — and nothing is modelled.
 */
import { createKlieg, fromEuler, type LookName, ManualClock } from 'klieg';

/** The spec's own measurement length, so the two numbers describe about the same sign. */
const TEXT = 'JACKPOT JACKPOT';
/** A body-part look is cheap enough to sweep far; a tube look is many runs per letter. */
const ROWS: Record<string, number[]> = {
  gold: [1, 2, 4, 7, 10, 16],
  tubing: [1, 2, 3, 4, 5, 6, 7, 8],
};
const FRAMES = 90;
/** Frames thrown away before timing: the first few carry the shader link and the first upload. */
const WARMUP = 20;
/** What a 60Hz frame has to spend before it drops one. */
const BUDGET_MS = 16.7;

interface Row {
  look: LookName;
  rows: number;
  median: number;
  p95: number;
  worst: number;
}

const results: Row[] = [];

function quantile(sorted: number[], q: number): number {
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at] as number;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function measure(look: LookName, rows: number): Promise<Row> {
  const clock = new ManualClock();
  const target = document.createElement('div');
  document.body.appendChild(target);
  const klieg = createKlieg({ fonts: { display: '/font.ttf' }, clock, target });

  const done = klieg.fire(TEXT, {
    look,
    enter: 'none',
    active: 'none',
    exit: 'none',
    hold: 'forever',
    lighting: 'static',
    backdrop: {
      rows,
      scale: 1.6,
      dim: 0.35,
      effects: [
        { piece: 'chase', target: { kind: 'run', by: 'index' }, stagger: { from: 'line' } },
      ],
    },
  });

  // The fire is async — font load, mount, first build — so give it real frames to reach the screen.
  for (let i = 0; i < 5; i++) await frame();

  const samples: number[] = [];
  for (let i = 0; i < WARMUP + FRAMES; i++) {
    const t = performance.now();
    clock.advance(16);
    const ms = performance.now() - t;
    if (i >= WARMUP) samples.push(ms);
  }

  klieg.destroy();
  await done;
  target.remove();

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    look,
    rows,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    worst: sorted[sorted.length - 1] as number,
  };
}

function render(): void {
  const head =
    '<tr><th>look</th><th>rows</th><th>median ms</th><th>p95 ms</th><th>worst ms</th></tr>';
  const body = results
    .map(
      (r) =>
        `<tr><td>${r.look}</td><td>${r.rows}</td>` +
        `<td>${r.median.toFixed(2)}</td><td>${r.p95.toFixed(2)}</td>` +
        `<td class="${r.worst > BUDGET_MS ? 'over' : ''}">${r.worst.toFixed(2)}</td></tr>`,
    )
    .join('');
  (document.getElementById('out') as HTMLElement).innerHTML = head + body;
}

async function main(): Promise<void> {
  const plan: [LookName, number][] = Object.entries(ROWS).flatMap(([look, rows]) =>
    rows.map((n) => [look as LookName, n] as [LookName, number]),
  );

  for (let i = 0; i < plan.length; i++) {
    const [look, rows] = plan[i] as [LookName, number];
    const row = await measure(look, rows);
    results.push(row);
    console.log(
      `${i + 1}/${plan.length}  ${look.padEnd(7)} rows=${String(rows).padStart(2)}  ` +
        `median ${row.median.toFixed(2)}ms  p95 ${row.p95.toFixed(2)}ms  worst ${row.worst.toFixed(2)}ms`,
    );
    render();
  }

  (document.getElementById('note') as HTMLElement).textContent =
    `${TEXT.length} letters, ${FRAMES} timed frames after ${WARMUP} warm-up, the backdrop running a ` +
    `chase staggered by line. A 60Hz frame has ${BUDGET_MS}ms before it drops one.`;
  (globalThis as unknown as { RESULT: Row[] }).RESULT = results;
}

/**
 * `#demo` fires one backdrop and holds it instead of measuring, so the same page is where you look
 * at the thing as well as where you time it. `#demo=tubing,7` names the look and the row count.
 */
async function demo(): Promise<void> {
  const [look = 'tubing', rows = '7'] = decodeURIComponent(location.hash.slice(6)).split(',');
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#0a0a0a;height:100vh';
  await createKlieg({ fonts: { display: '/font.ttf' } }).fire(TEXT, {
    look: look as LookName,
    enter: 'none',
    active: 'none',
    exit: 'none',
    hold: 'forever',
    lighting: 'static',
    backdrop: {
      rows: Number(rows),
      scale: 1.6,
      dim: 0.35,
      transform: fromEuler(0, 0, -12 * (Math.PI / 180)),
      effects: [
        { piece: 'chase', target: { kind: 'run', by: 'index' }, stagger: { from: 'line' } },
      ],
    },
  });
}

void (location.hash.startsWith('#demo') ? demo() : main());
