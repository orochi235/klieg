/**
 * Which glyphs the stitched shell can build, and what a pavé cut costs on each.
 *
 *   npx vitest run --config spikes/vitest.render.config.ts -t sweep
 *
 * Not a test — a survey, run through vitest so it can import the package's TypeScript directly.
 * `buildShell` refuses rather than guesses when two levels of a letter disagree on ring count, so
 * "which letters does it refuse" is a question about the alphabet, not about a cutter. Anything
 * shipping a `well` look has to know the answer before it picks the letters in its demo.
 *
 * `SWEEP_CHARS` overrides the alphabet, `SWEEP_CROWN=cushion:0.05:0.12` adds a crown, and
 * `SWEEP_OUT` writes the table to a file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';
import * as THREE from 'three';
import { it } from 'vitest';
import { WordCaches } from '../packages/core/src/render/caches.js';
import { cutterFor } from '../packages/core/src/render/wells/cutters.js';
import { regionOf } from '../packages/core/src/render/wells/region.js';
import { buildShell, DEFAULT_SHELL, openEdges } from '../packages/core/src/render/wells/shell.js';

const CHARS = process.env.SWEEP_CHARS ?? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function loadFont() {
  const buf = readFileSync(new URL('../apps/lab/public/font.ttf', import.meta.url));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return {
    font,
    unitsPerEm: font.unitsPerEm,
    key: '/f.ttf',
    family: 'sweep',
    metrics: { advanceOf: () => 600, kernOf: () => 0 },
    bytes: new ArrayBuffer(0),
  } as never;
}

it('sweeps the alphabet', { timeout: 1_800_000 }, () => {
  const asked = process.env.SWEEP_CROWN?.split(':');
  const inflate = asked
    ? { profile: asked[0] as 'cushion', rise: Number(asked[1]), reach: Number(asked[2]) }
    : undefined;
  const caches = new WordCaches();
  const font = loadFont();
  const rows: string[] = ['| char | pockets | body tris | shell |', '| --- | --- | --- | --- |'];
  const refused: string[] = [];

  const chars = [...CHARS];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i] as string;
    const at = `${i + 1}/${chars.length}`;
    let line: string;
    try {
      const shapes = caches.shapes(font, char);
      const spec = {
        kind: 'well',
        cutter: 'pave',
        bezel: 0.028,
        floor: 0.07,
        pitch: 0.055,
        size: 0.048,
        wall: 0.009,
        look: {},
      } as never;
      const cut = cutterFor('pave')(shapes, regionOf(shapes), spec);
      const geo = buildShell(shapes, cut, {
        ...DEFAULT_SHELL,
        depth: 0.3,
        bezel: 0.028,
        rimBevel: 0.003,
        rimDrop: 0.003,
        inflate,
      }).geometry;
      const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      const open = openEdges(pos);
      const state = open === 0 ? 'closed' : `OPEN ${open}`;
      rows.push(`| ${char} | ${cut.wells.length} | ${pos.length / 9} | ${state} |`);
      line = `${at} ${char} — ${cut.wells.length} pockets, ${pos.length / 9} tris, ${state}`;
    } catch (e) {
      const why = e instanceof Error ? e.message.replace(/^klieg: /, '') : String(e);
      rows.push(`| ${char} | — | — | refused: ${why} |`);
      refused.push(char);
      line = `${at} ${char} — REFUSED: ${why}`;
    }
    console.log(line);
  }

  console.log(
    `refused ${refused.length} of ${chars.length}${refused.length ? `: ${refused.join(' ')}` : ''}`,
  );
  const out = process.env.SWEEP_OUT;
  if (out) writeFileSync(out, `${rows.join('\n')}\n`);
});
