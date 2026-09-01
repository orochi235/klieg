import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { specOf } from '../../../src/render/looks.js';
import type { TubeSpec } from '../../../src/render/tube/index.js';
import { buildTubeBlueprint } from '../../../src/render/tube/index.js';
import { CUT_REPAIR_IDS, type CutRepairId } from '../../../src/render/tube/repairs.js';
import { glyphToShapes } from '../../../src/text/glyphs.js';

const LETTERS = 'ABDEGMNQRSW8';
const LOOKS = ['tubing', 'piping'] as const;

const FONT_PATH = fileURLToPath(
  new URL('../../../../../apps/lab/public/font.ttf', import.meta.url),
);

/** `opentype.parse` wants an ArrayBuffer, and a Node Buffer is a view into a pooled one. */
function labFont() {
  const buf = readFileSync(FONT_PATH);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function specFor(name: (typeof LOOKS)[number]): TubeSpec {
  const decoration = specOf(name).decoration;
  if (decoration?.kind !== 'tube') throw new Error(`${name} has no tube decoration`);
  return decoration;
}

describe('every repair reports across the alphabet', () => {
  const font = labFont();
  const shapesOf = (letter: string) => glyphToShapes(font as never, letter, 1);

  it('reports every id at least once', () => {
    const seen = new Set<CutRepairId>();
    for (const look of LOOKS) {
      for (const letter of LETTERS) {
        const bp = buildTubeBlueprint(shapesOf(letter), specFor(look), 0.35, 0, {
          onRepair: (id) => seen.add(id),
        });
        bp.dispose();
      }
    }
    // No shipped look weights `hairpin`, so the alphabet alone can never produce one — it needs a
    // spec that asks for it. Measured: without this, `hairpin` is the only id missing.
    const hairpinSpec: TubeSpec = {
      ...specFor('tubing'),
      corners: { break: 0, connect: 0, hairpin: 1 },
    };
    for (const letter of LETTERS) {
      const bp = buildTubeBlueprint(shapesOf(letter), hairpinSpec, 0.35, 0, {
        onRepair: (id) => seen.add(id),
      });
      bp.dispose();
    }
    expect([...seen].sort()).toEqual([...CUT_REPAIR_IDS].sort());
  });

  // A site with no `points` and no `removed` cannot be drawn: kliegsminister filters it out, so a
  // repair that reports one is invisible in the lab however loudly it fires. The exit-side setback
  // reported nothing but a cursor index, against the entry side's 145 of 148.
  it('gives both sides of a setback the vertices they removed', () => {
    const ran = { entry: 0, exit: 0 };
    const placeable = { entry: 0, exit: 0 };
    for (const look of LOOKS) {
      for (const letter of LETTERS) {
        const bp = buildTubeBlueprint(shapesOf(letter), specFor(look), 0.35, 0, {
          onRepair: (id, site, didRun) => {
            if (id !== 'setback' || !site || !didRun) return;
            const side = site.side === 'exit' ? 'exit' : 'entry';
            ran[side]++;
            if (site.points.length + site.removed.length > 0) placeable[side]++;
          },
        });
        bp.dispose();
      }
    }

    // Both sides fire once per corner, but they do not place identically: a turn whose setback is
    // shorter than one sample step removes nothing, and the two sides sample differently -- 145 of
    // 148 on the entry, 141 on the exit. A ratio rather than those numbers, so a geometry change
    // moves the counts without failing here; zero is the regression this guards.
    expect(ran.exit).toBe(ran.entry);
    expect(placeable.entry / ran.entry).toBeGreaterThan(0.9);
    expect(placeable.exit / ran.exit).toBeGreaterThan(0.9);
  });

  it('reports both sides of every corner repair', () => {
    const bySide = new Map<string, number>();
    for (const letter of LETTERS) {
      const bp = buildTubeBlueprint(shapesOf(letter), specFor('tubing'), 0.35, 0, {
        onRepair: (id, site) => {
          if (!site?.side) return;
          const key = `${id}:${site.side}`;
          bySide.set(key, (bySide.get(key) ?? 0) + 1);
        },
      });
      bp.dispose();
    }
    // `setback` and `resume` are the two ids wholly inside `mergeArc`, and both fire on both ends.
    // Before slice 3 `resume` reported entry-only, at exactly half `setback`'s count.
    expect(bySide.get('setback:entry')).toBeGreaterThan(0);
    expect(bySide.get('setback:exit')).toBe(bySide.get('setback:entry'));
    expect(bySide.get('resume:entry')).toBeGreaterThan(0);
    expect(bySide.get('resume:exit')).toBe(bySide.get('resume:entry'));
  });

  it('builds identically with every repair on as with repairs absent', () => {
    const all = new Set<CutRepairId>(CUT_REPAIR_IDS);
    for (const look of LOOKS) {
      for (const letter of LETTERS) {
        const bare = buildTubeBlueprint(shapesOf(letter), specFor(look), 0.35, 0);
        const full = buildTubeBlueprint(shapesOf(letter), specFor(look), 0.35, 0, {
          repairs: all,
        });
        expect(full.runs.length).toBe(bare.runs.length);
        expect(full.runs.map((r) => r.points.length)).toEqual(
          bare.runs.map((r) => r.points.length),
        );
        full.runs.forEach((run, i) => {
          const was = bare.runs[i]?.points ?? [];
          run.points.forEach((p, j) => {
            expect(p.x).toBe(was[j]?.x);
            expect(p.y).toBe(was[j]?.y);
            expect(p.z).toBe(was[j]?.z);
          });
        });
        bare.dispose();
        full.dispose();
      }
    }
  });
});
