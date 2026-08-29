import fontUrl from '../../apps/lab/public/font.ttf?url';
import { EFFECTS } from '../../packages/core/src/effects/pieces.js';
import { createKlieg, ManualClock, roving } from '../../packages/core/src/index.js';

const host = document.getElementById('host') as HTMLDivElement;
const log: string[] = [];

/** Non-transparent pixels, read in the SAME synchronous turn as the advance that drew them:
 * three.js does not preserve the drawing buffer, so a read one task later is all zeros. */
function sample(c: HTMLCanvasElement): { ink: number; digest: string } {
  const g = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
  if (!g) return { ink: -1, digest: 'NO-GL' };
  const px = new Uint8Array(c.width * c.height * 4);
  g.readPixels(0, 0, c.width, c.height, g.RGBA, g.UNSIGNED_BYTE, px);
  let ink = 0;
  let h = 2166136261;
  for (let i = 0; i < px.length; i += 4) {
    if ((px[i + 3] as number) > 8) ink++;
    h = Math.imul(h ^ ((px[i] as number) + (px[i + 1] as number) * 3 + (px[i + 2] as number) * 7), 16777619);
  }
  return { ink, digest: (h >>> 0).toString(16) };
}

async function run(target: number, step: number): Promise<string> {
  host.innerHTML = '';
  const clock = new ManualClock();
  const k = createKlieg({ target: host, clock, fontUrl });
  const fired = k.fire('ACRONYM', {
    look: 'tubing',
    hold: 8000,
    enter: 'slam',
    effects: [
      {
        piece: roving(EFFECTS.flicker(), { dwell: 3200, seed: 1 }),
        target: { kind: 'run', amount: 1 },
        seed: 1,
      },
    ],
  });
  void fired.catch(() => {});

  // Wait for the canvas AND for it to carry ink, rather than for a fixed delay: the font load
  // and the first tube build are what gate this, and neither has a fixed cost.
  let canvas: HTMLCanvasElement | null = null;
  for (let i = 0; i < 400; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    canvas = host.querySelector('canvas');
    if (canvas) {
      clock.advance(16.7);
      if (sample(canvas).ink > 0) break;
    }
  }
  if (!canvas) return 'NO-CANVAS';

  let t = 0;
  let out = { ink: 0, digest: 'never-advanced' };
  while (t < target) {
    const d = Math.min(step, target - t);
    clock.advance(d);
    t += d;
    // Sample only on the last step, and in that same synchronous turn. Sampling every step
    // costs a full readPixels per frame and does not change the answer.
    if (t >= target) out = sample(canvas);
    else await new Promise((r) => requestAnimationFrame(r));
  }
  k.destroy();
  return `${out.digest}/ink:${out.ink}`;
}

(async () => {
  // Does the composition actually move the image? If every seek returns one digest, the effect
  // is not reaching the render and "seek is exact" is a claim about a still picture.
  const seen = new Map<string, number[]>();
  for (let target = 1000; target <= 7500; target += 500) {
    const d = await run(target, target);
    if (!seen.has(d)) seen.set(d, []);
    (seen.get(d) as number[]).push(target);
  }
  log.push(`distinct frames across 14 seeks: ${seen.size}`);
  for (const [d, ts] of seen) log.push(`  ${d.padEnd(22)} at ${ts.join(', ')}ms`);
  log.push('');
  for (const target of [1200, 4000, 9000]) {
    const stepped = await run(target, 16.7);
    const jumped = await run(target, target);
    const coarse = await run(target, 250);
    log.push(
      `t=${String(target).padStart(5)}ms  fine ${stepped.padEnd(22)} jump ${jumped.padEnd(22)} coarse ${coarse.padEnd(22)}` +
        `  jump==fine ${String(jumped === stepped).padEnd(5)} coarse==fine ${coarse === stepped}`,
    );
  }
  (globalThis as unknown as { SEEK_RESULT: string }).SEEK_RESULT = log.join('\n');
  document.title = 'done';
})();
