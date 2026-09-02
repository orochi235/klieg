import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { specOf } from '../../../src/render/looks.js';
import type { TubeSpec } from '../../../src/render/tube/index.js';
import { buildTubeBlueprint } from '../../../src/render/tube/index.js';
import { glyphToShapes } from '../../../src/text/glyphs.js';

const CAPITALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOOKS = ['tubing', 'piping'] as const;
const FONT_DIR = fileURLToPath(new URL('../../../../../apps/lab/public/fonts/', import.meta.url));

/**
 * A letter the cut has thrown away. Corners legitimately eat some of a contour — the tightest
 * letters here keep under a third — but a letter reduced to a stub is a gap in the word, and
 * `tubing` hides its body so nothing stands behind it.
 */
const FLOOR = 0.15;

function faceAt(file: string) {
  const buf = readFileSync(FONT_DIR + file);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function specFor(name: (typeof LOOKS)[number]): TubeSpec {
  const decoration = specOf(name).decoration;
  if (decoration?.kind !== 'tube') throw new Error(`${name} has no tube decoration`);
  return decoration;
}

function polyLength(points: { distanceTo(o: never): number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += (points[i] as { distanceTo(o: never): number }).distanceTo(points[i - 1] as never);
  }
  return total;
}

describe('the cut keeps every capital of every shipped face', () => {
  const files = readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf'));

  // One seed: what this guards is not a seeded selection but the corner stitch, which draws the
  // same strategy weights for every seed a letter is fired at.
  it.each(files)('%s', (file) => {
    const font = faceAt(file);
    const lost: string[] = [];
    for (const look of LOOKS) {
      for (const char of CAPITALS) {
        const bp = buildTubeBlueprint(glyphToShapes(font as never, char, 1), specFor(look), 0.3, 0);
        const traced = bp.paths.reduce((a, p) => a + polyLength(p.points as never), 0);
        const kept = bp.runs.reduce((a, r) => a + polyLength(r.points as never), 0);
        bp.dispose();
        if (traced > 0 && kept / traced < FLOOR) {
          lost.push(`${look} ${char} kept ${((kept / traced) * 100).toFixed(1)}%`);
        }
      }
    }
    expect(lost).toEqual([]);
  });
});
