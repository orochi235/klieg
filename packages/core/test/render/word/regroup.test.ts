import { beforeAll, describe, expect, it } from 'vitest';
import type { PartInfo } from '../../../src/effects/types.js';
import type { LetterInfo } from '../../../src/motion/types.js';
import type { PoseDelta } from '../../../src/pose.js';
import { Word } from '../../../src/render/word.js';
import type { Budget } from '../../../src/text/layout.js';
import { groups, HOST, ROOMY, registerStubFace, STEP, stubFont, timelineOf } from './harness.js';

beforeAll(registerStubFace);

describe('regroup', () => {
  const firstOfLine = (l: LetterInfo) => l.column === 0;

  it('leaves every survivor where it was under `place`', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const before: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        before.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );

    const result = word.regroup(firstOfLine, 'place');
    expect(result.kept).toEqual([0, 2, 4]);
    // Nothing moved, so nothing has anywhere to move back from.
    expect(result.delta.every(([dx, dy]) => dx === 0 && dy === 0)).toBe(true);

    const after: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        after.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    for (const i of result.kept) {
      expect(after[i]?.x, `x of ${i}`).toBeCloseTo(before[i]?.x as number);
      expect(after[i]?.y, `y of ${i}`).toBeCloseTo(before[i]?.y as number);
      expect(after[i]?.line, `line of ${i}`).toBe(before[i]?.line);
      expect(after[i]?.column, `column of ${i}`).toBe(before[i]?.column);
    }
    // Renumbered as their own group all the same, so a stagger over them is coherent.
    expect(result.kept.map((i) => after[i]?.index)).toEqual([0, 1, 2]);
    expect(after[0]?.count).toBe(3);
  });

  it('lays the survivors out as the word they spell', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const result = word.regroup(firstOfLine, 'line');
    expect(result.kept).toEqual([0, 2, 4]);
    expect(result.dropped).toEqual([1, 3, 5]);

    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    // Three survivors on one line, origins centred on the advance span.
    expect(seen[0]?.x).toBeCloseTo(-1.5 * STEP);
    expect(seen[2]?.x).toBeCloseTo(-0.5 * STEP);
    expect(seen[4]?.x).toBeCloseTo(0.5 * STEP);
  });

  it('stacks one survivor per line when asked', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'stack');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    expect(seen[0]?.line).toBe(0);
    expect(seen[2]?.line).toBe(1);
    expect(seen[0]?.x).toBeCloseTo(-STEP / 2);
  });

  it('renumbers the survivors and leaves the dropped letters their old numbering', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    expect([seen[0]?.index, seen[2]?.index]).toEqual([0, 1]);
    expect([seen[0]?.count, seen[2]?.count]).toEqual([2, 2]);
    // `column` is the canonical stage selector, so a second stage picks from the new layout.
    expect([seen[0]?.column, seen[2]?.column]).toEqual([0, 1]);
    expect([seen[0]?.line, seen[2]?.line]).toEqual([0, 0]);
    // The dropped letter keeps the numbering its exit was staggered against.
    expect(seen[1]?.index).toBe(1);
    expect(seen[1]?.count).toBe(4);
  });

  it('marks a dropped letter as leaving and a survivor as not', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    expect(seen[1]?.leaving).toBe(true);
    expect(seen[0]?.leaving).toBeFalsy();
  });

  it('reports each survivor the offset back to the line and column it left', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const { delta } = word.regroup(firstOfLine, 'line');
    // Every survivor was first on a two-glyph line and is now one of three on a single line.
    expect(delta[0]?.[0]).toBeCloseTo(0.5 * STEP, 10);
    expect(delta[0]?.[1]).toBeCloseTo(0, 10);
    expect(delta[2]?.[0]).toBeCloseTo(-0.5 * STEP, 10);
    expect(delta[2]?.[1]).toBeCloseTo(-1.1, 10);
    expect(delta[4]?.[0]).toBeCloseTo(-1.5 * STEP, 10);
    expect(delta[4]?.[1]).toBeCloseTo(-2.2, 10);
  });

  it('puts a survivor back where it was when its offset is posed onto it', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const before = groups(word).map((g) => g.position.clone());
    const { kept, delta } = word.regroup(firstOfLine, 'line');

    word.apply(
      timelineOf((_phase, letter): PoseDelta => {
        // delta is keyed by slot; a survivor's index is its new position in the group.
        if (letter.leaving) return {};
        const [dx, dy] = delta[kept[letter.index] as number] as [number, number];
        return { position: [dx, dy, 0] };
      }),
      0,
      HOST,
    );

    const after = groups(word).map((g) => g.position.clone());
    for (const i of kept) {
      expect(after[i]?.x).toBeCloseTo(before[i]?.x as number, 10);
      expect(after[i]?.y).toBeCloseTo(before[i]?.y as number, 10);
    }
  });

  it('leaves a dropped letter parked where it was', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    const before: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        before.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    word.regroup(firstOfLine, 'line');
    const after: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        after.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    expect(after[1]?.x).toBeCloseTo(before[1]?.x as number);
  });

  it("moves a survivor's parts with it, and leaves the pool's numbering alone", () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    const pool = word.partsOf('body');
    const numbered = pool.map((part) => part.index);
    word.regroup(firstOfLine, 'line');

    const survivors = word.partsOf('body').filter((_, i) => i % 2 === 0);
    const direct = new Word('NEO', stubFont(), 'gold', ROOMY).partsOf('body');
    survivors.forEach((part, n) => {
      const want = direct[n] as PartInfo;
      expect(part.x).toBeCloseTo(want.x);
      expect(part.y).toBeCloseTo(want.y);
      for (const edge of ['minX', 'maxX', 'minY', 'maxY'] as const) {
        expect(part.ink[edge]).toBeCloseTo(want.ink[edge]);
      }
    });
    // The same objects under the same indices: an effect's state is keyed on them.
    word.partsOf('body').forEach((part, i) => {
      expect(part).toBe(pool[i]);
      expect(part.index).toBe(numbered[i]);
    });
  });

  it('matches laying the survivors out directly', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    const regrouped: number[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        regrouped.push(letter.x as number);
        return {};
      }),
      0,
      HOST,
    );

    const direct = new Word('NEO', stubFont(), 'gold', ROOMY);
    const plain: number[] = [];
    direct.apply(
      timelineOf((_phase, letter) => {
        plain.push(letter.x as number);
        return {};
      }),
      0,
      HOST,
    );
    expect([regrouped[0], regrouped[2], regrouped[4]]).toEqual(plain);
  });

  it('selects from the survivors of an earlier regroup, not from every slot', () => {
    const word = new Word('NA\nEB\nOC', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'stack');
    // The survivors now stand one per line, so every one of them is a first-of-line again.
    const second = word.regroup((l) => (l.index as number) < 2, 'line');
    expect(second.kept).toEqual([0, 2]);
    expect(second.dropped).toEqual([4]);
  });

  it('takes a retired letter off screen', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    const result = word.regroup(firstOfLine, 'line');
    expect(groups(word).every((g) => g.visible)).toBe(true);
    word.retire(result.dropped);
    expect(groups(word).map((g) => g.visible)).toEqual([true, false, true, false]);
  });
});

describe('fit tween', () => {
  const firstOfLine = (l: LetterInfo) => l.column === 0;
  const TIGHT: Budget = { width: 2, height: 2 };
  /** Tall enough to matter and wide enough not to: the fit here is decided by ink height. */
  const SHORT: Budget = { width: 100, height: 1 };

  it('holds the old fit at progress 0 and reaches the new one at 1', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    const before = word.group.scale.x;
    word.regroup(firstOfLine, 'line');

    word.setFitProgress(0);
    expect(word.group.scale.x).toBeCloseTo(before);

    word.setFitProgress(1);
    // Two letters need far less width than ten, so the fit grows.
    expect(word.group.scale.x).toBeGreaterThan(before);
  });

  it('settles on exactly the fit the survivors get as a word of their own', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const direct = new Word('NE', stubFont(), 'gold', TIGHT);

    expect(word.group.scale.x).toBe(direct.group.scale.x);
    expect(word.group.position.y).toBe(direct.group.position.y);
  });

  it('measures the new fit over the glyphs that survived, descenders included', () => {
    const font = stubFont();
    const word = new Word('gA', font, 'gold', SHORT);
    word.regroup((l) => l.column === 1, 'line');
    word.setFitProgress(1);
    const direct = new Word('A', font, 'gold', SHORT);

    // The dropped 'g' is the only glyph that reaches below the baseline; it must stop counting.
    expect(word.group.scale.x).toBe(direct.group.scale.x);
    expect(word.group.position.y).toBe(direct.group.position.y);
  });

  it('is halfway between the two at progress 0.5', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    const before = word.group.scale.x;
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const after = word.group.scale.x;
    word.setFitProgress(0.5);
    expect(word.group.scale.x).toBeCloseTo((before + after) / 2);
  });

  it('clamps a progress the caller overshoots, so a delayed clock cannot overscale', () => {
    const word = new Word('NAAAA\nEBBBB', stubFont(), 'gold', TIGHT);
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const settled = word.group.scale.x;
    word.setFitProgress(1.8);
    expect(word.group.scale.x).toBeCloseTo(settled);
  });

  it('reports y against the settled fit once the tween completes', () => {
    const word = new Word('NA\nEB', stubFont(), 'gold', ROOMY);
    word.regroup(firstOfLine, 'line');
    word.setFitProgress(1);
    const seen: LetterInfo[] = [];
    word.apply(
      timelineOf((_phase, letter) => {
        seen.push({ ...letter });
        return {};
      }),
      0,
      HOST,
    );
    // One line of survivors: its own centre.
    expect(seen[0]?.y).toBeCloseTo(-0.35);
  });
});

describe('layoutVersion', () => {
  it('changes when a regroup re-lays the letters', () => {
    const word = new Word('ABC', stubFont(), 'gold', ROOMY);
    const before = word.layoutVersion;
    word.regroup((l) => l.index < 2, 'line');

    expect(word.layoutVersion).not.toBe(before);
  });
});
