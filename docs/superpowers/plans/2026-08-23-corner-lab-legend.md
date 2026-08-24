# Corner Lab Legend Implementation Plan

> **⚠ TENTATIVE — re-review before executing.** This plan is written against the *planned* API of
> `@weasel-js/labkit@1.2.0`'s `FloatingPanel` and `Legend`, which do not exist yet, and which in turn
> depend on `windease@1.3.0`'s `floatingStrategy`, which also does not exist yet. That windease plan
> has already been revised once during review. **When labkit 1.2.0 actually publishes, diff its
> `FloatingPanel` and `Legend` props against Task 3 below before writing code.**
>
> Upstream plans:
> - `~/src/windease/docs/superpowers/plans/2026-08-23-floating-strategy.md`
> - `~/src/weasel/docs/superpowers/plans/2026-08-23-labkit-floating-legend.md`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the corner lab a draggable color key, so the eight inks it draws can be read without opening the source.

**Architecture:** The lab's ink table moves out of `instrument.tsx` into its own module, paired with legend entries derived from it. A test asserts the two can't drift apart. The instrument's `render` then returns a fragment so the panel mounts as a sibling of the measures readout rather than inside it.

**Tech Stack:** TypeScript, React 19, vitest, `@weasel-js/labkit`.

---

## Background the implementer needs

The corner lab draws eight inks and offers no key. Blue and purple are both carried runs, told apart
only by which side of a split corner they reach it from; the only way to learn that today is to read
`packages/core/dev/corner-lab/src/instrument.tsx`.

Three constraints imposed by labkit's canvas stack, **all of which fail quietly if missed**:

1. **The panel must be a direct child of the overlay.** `.lk-canvas-stack__overlay` is
   `position:absolute; inset:0` and is the containing block. Nested inside `.junction` — which is
   `width:max-content` pinned top-left — the panel positions against *that* box, landing in the
   corner of the readout instead of the canvas.
2. **Direct child again, for pointer events.** The overlay is `pointer-events:none`, with `auto`
   restored only on `> *`.
3. **The drag must not reach the camera.** The stack owns pan/zoom on the same pointer events.
   `FloatingPanel` already calls `stopPropagation` on pointerdown; this plan depends on that, and
   Task 4 verifies it in the running lab.

`.junction` occupies the top-left, so the legend excludes that corner from snapping.

---

## File Structure

- Create: `packages/core/dev/corner-lab/src/legend.ts` — the ink table and the legend entries built from it
- Create: `packages/core/test/dev/corner-lab/legend.test.ts` — the anti-drift check
- Modify: `packages/core/dev/corner-lab/src/instrument.tsx` — import `INK`, render the panel
- Modify: `packages/core/package.json` — raise the labkit floor

`INK` moves into its own module so the drift test can import it without pulling React and labkit into
a node test.

---

### Task 1: Move the ink table out, and give it a legend

**Files:**
- Create: `packages/core/dev/corner-lab/src/legend.ts`
- Test: `packages/core/test/dev/corner-lab/legend.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/dev/corner-lab/legend.test.ts
import { describe, expect, it } from 'vitest';
import { INK, LEGEND, MEASURE_ONLY } from '../../../dev/corner-lab/src/legend.js';

describe('corner lab legend', () => {
  it('has an entry for every ink the canvas draws', () => {
    const drawn = Object.keys(INK).filter((k) => !MEASURE_ONLY.includes(k));
    expect(LEGEND.map((e) => e.key).sort()).toEqual(drawn.sort());
  });

  it('never invents a colour the ink table does not hold', () => {
    const inks = new Set(Object.values(INK));
    for (const entry of LEGEND) expect(inks.has(entry.color)).toBe(true);
  });

  it('takes each entry colour from the ink of the same name', () => {
    for (const entry of LEGEND) {
      expect(entry.color).toBe(INK[entry.key as keyof typeof INK]);
    }
  });

  it('leaves out the ink that only ever colours the measures list', () => {
    expect(LEGEND.some((e) => e.key === 'bad')).toBe(false);
    expect(MEASURE_ONLY).toContain('bad');
  });

  it('labels every entry with something other than its key', () => {
    for (const entry of LEGEND) expect(entry.label.length).toBeGreaterThan(0);
  });

  it('names both sides of a split corner distinctly', () => {
    const before = LEGEND.find((e) => e.key === 'built')?.label;
    const after = LEGEND.find((e) => e.key === 'builtAfter')?.label;
    expect(before).not.toBe(after);
  });

  it('draws the non-stroke inks as the shapes they actually are', () => {
    const markOf = (k: string) => LEGEND.find((e) => e.key === k)?.mark;
    expect(markOf('floor')).toBe('dash');
    expect(markOf('authored')).toBe('dot');
    expect(markOf('replaced')).toBe('band');
    expect(markOf('contour')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/dev/corner-lab/legend.test.ts`
Expected: FAIL — cannot resolve `../../../dev/corner-lab/src/legend.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/dev/corner-lab/src/legend.ts
import type { LegendEntry } from '@weasel-js/labkit';

export const INK = {
  contour: '#7d7f86',
  built: '#4d8fe0',
  builtAfter: '#a855f7',
  authored: '#2aa87a',
  drawn: '#e08a20',
  replaced: 'rgba(255, 107, 96, 0.28)',
  floor: '#9a9ca3',
  bad: '#d1453b',
};

/** Inks that colour the readout rather than the drawing, so no legend entry names them. */
export const MEASURE_ONLY = ['bad'];

export const LEGEND: LegendEntry[] = [
  { key: 'contour', label: 'contour', color: INK.contour },
  { key: 'built', label: 'run · before', color: INK.built },
  { key: 'builtAfter', label: 'run · after', color: INK.builtAfter },
  { key: 'authored', label: 'authored', color: INK.authored, mark: 'dot' },
  { key: 'drawn', label: 'repair', color: INK.drawn },
  { key: 'replaced', label: 'replaced', color: INK.replaced, mark: 'band' },
  { key: 'floor', label: 'bend floor', color: INK.floor, mark: 'dash' },
];
```

- [ ] **Step 4: Point the instrument at it**

In `packages/core/dev/corner-lab/src/instrument.tsx`, delete the local `const INK = {…}` block and
add to the imports:

```tsx
import { INK } from './legend.js';
```

Nothing else in the file changes — every `INK.foo` reference resolves the same way.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/test/dev/corner-lab/legend.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add packages/core/dev/corner-lab/src/legend.ts packages/core/dev/corner-lab/src/instrument.tsx packages/core/test/dev/corner-lab/legend.test.ts
git commit -m "name every ink the corner lab draws, and hold the list to the drawing"
```

---

### Task 2: Raise the labkit floor

**⚠ Gate — do not start Task 3 until this passes.**

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Raise the dependency**

Change `"@weasel-js/labkit": "^1.1.0"` to `"^1.2.0"`, then:

```bash
npm install
```

- [ ] **Step 2: Confirm the surface Task 3 assumes**

```bash
npx tsx -e "import * as k from '@weasel-js/labkit'; console.log(['FloatingPanel','Legend'].filter(n => n in k))"
```

Expected: `[ 'FloatingPanel', 'Legend' ]`

Then check the props Task 3 passes actually exist — `anchor`, `snapCorners`, `inset`, `storageKey` on
`FloatingPanel`; `entries` on `Legend`; and that `LegendEntry` still has `key`, `label`, `color`,
`mark`. If any differ, fix Task 3 and Task 1's `legend.ts` before writing code.

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json package-lock.json
git commit -m "raise the labkit floor to the release carrying the legend"
```

---

### Task 3: Mount the panel

**Files:**
- Modify: `packages/core/dev/corner-lab/src/instrument.tsx`

- [ ] **Step 1: Extend the imports**

```tsx
import { defineInstrument, FloatingPanel, Legend } from '@weasel-js/labkit';
import { INK, LEGEND } from './legend.js';
```

- [ ] **Step 2: Return a fragment from `render`**

Replace the whole `render` property with:

```tsx
  render: ({ state }) => (
    <>
      <div className="junction">
        <dl className="junction__measures">
          {state.measures.map((m) => (
            <div className={m.bad ? 'measure measure--bad' : 'measure'} key={m.label}>
              <dt>{m.label}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
        </dl>
        <ul className="junction__profile">
          {state.profile.map((p) => (
            <li
              key={p.at}
              className={p.rho < state.rhoMin / state.radius ? 'tick tick--under' : 'tick'}
              title={`${p.at} from the corner: ${p.rho.toFixed(2)}r`}
            >
              {Number.isFinite(p.rho) ? p.rho.toFixed(1) : '—'}
            </li>
          ))}
        </ul>
      </div>
      <FloatingPanel
        anchor="bottom-left"
        snapCorners={['top-right', 'bottom-left', 'bottom-right']}
        storageKey="corner-lab.legend"
      >
        <Legend entries={LEGEND} />
      </FloatingPanel>
    </>
  ),
```

The fragment is the point: `FloatingPanel` must be a **sibling** of `.junction`, so both are direct
children of the canvas stack overlay. `top-left` is absent from `snapCorners` because `.junction`
already sits there.

- [ ] **Step 3: Typecheck and run the suite**

Run: `npm run check`
Expected: lint clean, typecheck clean, all tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/dev/corner-lab/src/instrument.tsx
git commit -m "show the corner lab's ink key over the canvas"
```

---

### Task 4: Confirm it in the running lab

Automated tests cannot cover this: the three failure modes are positioning, pointer routing, and
camera capture, and all three need a real layout.

- [ ] **Step 1: Open the lab**

```bash
npm run dev:corner-lab -w klieg
```

If that script does not exist, check `package.json` for the corner lab's dev script and use that.

- [ ] **Step 2: Walk the failure modes**

- [ ] The legend sits in the **bottom-left of the canvas**, not tucked under the measures readout.
      Wrong position means it is nested inside `.junction` instead of being its sibling.
- [ ] Dragging the legend moves **only the legend** — the glyph underneath stays put. If the camera
      pans too, `stopPropagation` is not reaching the canvas stack.
- [ ] Releasing it near a corner snaps it there; releasing it in open space leaves it there.
- [ ] Dragging toward the **top-left** never snaps — that corner is excluded.
- [ ] Reload the page: the legend is where you left it.
- [ ] Every swatch matches what is on the canvas — the bend floor dashed, `authored` a dot,
      `replaced` a translucent band.

- [ ] **Step 3: Capture it**

Screenshot the lab with the legend visible and open it, so the result is on screen rather than only
described.

- [ ] **Step 4: Commit anything the walkthrough turned up**

If the walkthrough needed CSS or prop changes, commit them with a message naming what was wrong.

---

## Notes for whoever picks this up

The design this implements, including why the snap threshold is measured per-axis and why nothing
collapses: `docs/superpowers/specs/2026-08-23-legend-palette-design.md`.

Blocked on `@weasel-js/labkit@1.2.0`, itself blocked on `windease@1.3.0`. Until both publish, `npm
link` both packages and expect the API to move under you.
