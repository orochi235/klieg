import type { PartInfo, PartKind } from '@core/effects/types.js';
import { hash01 } from '@core/motion/types.js';
import type { LookName } from '@core/render/looks.js';
import { Word } from '@core/render/word.js';
import type { LoadedFont } from '@core/text/font.js';

/**
 * A pool with deliberately uneven `at`/`span`. Real run lengths are uneven, and `chase` and `hue`
 * read `part.at` — an evenly spaced pool would flatter every spread.
 */
export function syntheticPool(runs: number, letters: number): PartInfo[] {
  const parts: PartInfo[] = [];
  for (let i = 0; i < letters; i++) {
    parts.push({
      kind: 'body',
      index: i,
      count: letters,
      letter: { index: i, count: letters },
      x: i - (letters - 1) / 2,
      y: 0,
      ink: {
        minX: i - (letters - 1) / 2 - 0.25,
        maxX: i - (letters - 1) / 2 + 0.25,
        minY: 0,
        maxY: 0.7,
      },
      line: 0,
      column: i,
      lineCount: 1,
      columnCount: letters,
      at: i / letters,
      span: 1 / letters,
    });
  }

  const lengths = Array.from({ length: runs }, (_, i) => 0.4 + hash01(i * 5.9 + 2.3) * 1.6);
  const total = lengths.reduce((a, b) => a + b, 0);
  let walked = 0;
  for (let i = 0; i < runs; i++) {
    const span = (lengths[i] as number) / total;
    const letter = Math.min(letters - 1, Math.floor((i / runs) * letters));
    parts.push({
      kind: 'run',
      index: i,
      count: runs,
      letter: { index: letter, count: letters },
      x: letter - (letters - 1) / 2,
      y: 0,
      ink: {
        minX: letter - (letters - 1) / 2 - 0.25,
        maxX: letter - (letters - 1) / 2 + 0.25,
        minY: 0,
        maxY: 0.7,
      },
      line: 0,
      column: letter,
      lineCount: 1,
      columnCount: letters,
      at: walked,
      span,
    });
    walked += span;
  }
  return parts;
}

/**
 * The pool a real word builds. `Word` needs no GL context — it builds geometry and meshes, and
 * nothing touches a renderer until something draws it — so this costs a layout, not a frame.
 */
export function realPool(text: string, font: LoadedFont, look: LookName): PartInfo[] {
  const word = new Word(text, font, look, { width: 6, height: 2 });
  return [...word.partsOf('body'), ...word.partsOf('run')];
}

/** How many parts of each kind the pool holds. Zero is the silent no-op a layer needs warning about. */
export function poolCounts(parts: readonly PartInfo[]): Record<PartKind, number> {
  return {
    run: parts.filter((p) => p.kind === 'run').length,
    body: parts.filter((p) => p.kind === 'body').length,
  };
}
