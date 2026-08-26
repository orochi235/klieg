import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import { specOf } from '../packages/core/dist/render/looks.js';
import { minBendRadius } from '../packages/core/dist/render/tube/bend.js';
import { generatePaths } from '../packages/core/dist/render/tube/generators.js';
import { cutIntoRuns } from '../packages/core/dist/render/tube/runs.js';
import { surfacesOf } from '../packages/core/dist/render/tube/surfaces.js';
import { glyphToShapes } from '../packages/core/dist/text/glyphs.js';
const buf = readFileSync('/Users/mike/src/klieg/apps/lab/public/font.ttf');
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const spec = { ...specOf('tubing').decoration, pathSource: 'field' };
const rhoMin = minBendRadius(spec.radius, spec.bend);
for (const ch of (process.argv[2] ?? 'WtN')) {
  const shapes = glyphToShapes(font, ch, 1);
  const paths = generatePaths(surfacesOf(shapes, 0.3), spec.surfaces, {
    level: spec.level, spacing: spec.spacing, wallDepth: 0.5, resolution: 256, pad: 0.35, source: 'field',
  });
  const cut = cutIntoRuns(paths, { runs: spec.runs, minRun: spec.minRun, corners: { break: 0, connect: 1 },
    radius: spec.radius, bend: spec.bend, spacing: spec.spacing, blockout: 0, seed: 0 });
  console.log(ch, 'rhoMin', rhoMin.toFixed(4));
  for (const c of cut.corners) {
    const deg = (c.turn * 180) / Math.PI;
    const setback = rhoMin * Math.tan(Math.min(c.turn, Math.PI * 0.98) / 2);
    console.log(`  turn ${deg.toFixed(0).padStart(3)}deg  interior ${(180-deg).toFixed(0).padStart(3)}  setback ${setback.toFixed(3)}  ${c.strategy}`);
  }
}
