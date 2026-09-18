# Shared Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put tube-gallery and tube-lab on labkit's published surface API and on one shared cell, so klieg stops hand-rolling tile measurement and stops keeping two near-copies of the same builder.

**Architecture:** labkit's `useTiledSurface` publishes rects, a dirty set, DPR and one rAF; klieg keeps the `WebGLRenderer` and paints scissored into the shared buffer. `LabRenderer` loses its measurement half and keeps its draw half. The two `cell.ts` files become one `lab-cell.ts` whose interface is their union. tube-gallery migrates first because it has the least to lose; tube-lab second, keeping its settle loop as an `invalidateRects()` driver.

**Tech Stack:** TypeScript, React 19, three.js 0.185, `@weasel-js/labkit` 1.4.4 (`/surface` subpath), vitest.

**Read first:** [the design](../specs/2026-09-12-shared-surface-design.md) and `~/src/weasel/packages/labkit/src/surface/AGENTS.md`. The second is the contract and is 90 lines.

---

## Constraints that bite

**Run one test file, never the suite.** This repo has ~1,700 tests and the box is usually loaded. `node_modules/.bin/vitest run <path>` — not `npm run test`, and not `npx`, which is wrapped and broken under this harness.

**Do not move `lab-view.ts`'s exports.** `packages/core/test/dev/tube-lab/fit.test.ts` imports `FILL`, `fitter` and `labCamera` from `../../../dev/shared/lab-view.js` and has six cases pinned on them. That file is the fit's only coverage; keep it green and untouched.

**Clear on a re-tile, not on every frame — and know this is staging.** The gutters lie outside every
scissor, so a moved tile strands its old picture where nothing repaints it. labkit 1.4.4 has no
`registerClear` and no `frame.retiled`, so the host detects the re-tile itself with the exported
`rectsEqual` and clears the whole buffer only then.

Clearing unconditionally would be correct and would also make `frame.dirty` worthless, because every
frame would repaint all sixteen panels forever — and it would regress tube-lab, which already has a
single-panel path (`drawOne`, `App.tsx:395-405`) that repaints one tile without clearing and relies
on `preserveDrawingBuffer` to hold the rest.

**The exit is known.** When labkit ships `registerClear` + `SurfaceFrame.retiled`, the host registers
a clear per tile and drops the rect comparison and the re-arm together. Until then this is a
deliberate stand-in, not the answer.

**The comparison alone is not enough, and partial redraw is what exposes that.** labkit measures only
when something asks it to, so a tile whose size settles while its position is still moving hands
over a mid-flight frame and then goes quiet. A full repaint from a stale rect map at least keeps
painting; a partial one freezes. Task 2's re-arm is the other half and is not optional — and it
serves `drawOne` too, which reads a cached rect and re-measures nothing.

**`toDeviceRect` returns CSS pixels.** three.js applies its own pixel ratio. Do not multiply by DPR.

**Register tiles by the bare id, and know why that is safe here.** `useSurfaceTile` registers under
`useTileId(id)`, which is `<trial>/<id>` inside a labkit trial and the bare `id` outside one. Both
these labs register outside a trial — tube-lab by `record.id`, tube-gallery by `variant.id` — so the
keys in a frame's `rects` are the ids as written. The moment a klieg lab becomes a real trial, the
second trial of an instrument takes the first one's rect *and* its painter, and the first is never
told it moved again. Neither lab in this plan is a trial; a later one must go through `useTileId`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/dev/shared/lab-surface.ts` | **new.** `useLabSurface` — owns `LabRenderer`, drives `useTiledSurface`, exposes `invalidateRects`. |
| `packages/core/dev/shared/lab-cell.ts` | **new.** One `buildCell` for both labs; the union of the two present interfaces. |
| `packages/core/dev/shared/lab-renderer.ts` | modify — delete nothing yet; it keeps `resize`/`clear`/`draw`/`dispose`. |
| `packages/core/dev/shared/lab-view.ts` | **unchanged.** Pinned by `fit.test.ts`. |
| `packages/core/dev/tube-gallery/src/cell.ts` | delete — replaced by `lab-cell.ts`. |
| `packages/core/dev/tube-gallery/src/App.tsx` | modify — drop `measure`, `rects`, its `ResizeObserver`. |
| `packages/core/dev/tube-lab/src/render/cell.ts` | delete — replaced by `lab-cell.ts`. |
| `packages/core/dev/tube-lab/src/App.tsx` | modify — drop `measure`/`rects`; keep the settle loop, repointed. |
| `packages/core/test/dev/shared/lab-cell.test.ts` | **new.** Pins the merged cell's interface. |

---

## Task 1: One cell for both labs

The two builders differ only in what they carry: tube-lab's has `key`, `pivot`, `bloomable`, `content` and `tubeMaterial`; tube-gallery's has `advance`. The merge is their union, with the extras optional.

**Files:**
- Create: `packages/core/dev/shared/lab-cell.ts`
- Test: `packages/core/test/dev/shared/lab-cell.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/dev/shared/lab-cell.test.ts
import { describe, expect, it } from 'vitest';
import { REST_TIMELINE } from '../../../dev/shared/lab-cell.js';

describe('the shared lab cell', () => {
  // Word starts every material at three's default opacity of 1 until `apply` runs, which renders
  // tubing's 0.08 backing as a solid wall over its own tube. Both labs relied on this; one named
  // it REST and the other STILL.
  it('rests with no motion in any slot', () => {
    expect(REST_TIMELINE.spec.enter).toBe('none');
    expect(REST_TIMELINE.spec.active).toBe('none');
    expect(REST_TIMELINE.spec.exit).toBe('none');
    expect(REST_TIMELINE.spec.hold).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node_modules/.bin/vitest run packages/core/test/dev/shared/lab-cell.test.ts`
Expected: FAIL — `Failed to resolve import ".../dev/shared/lab-cell.js"`.

- [ ] **Step 3: Write `lab-cell.ts`**

```ts
// packages/core/dev/shared/lab-cell.ts
import type { FrameCtx } from '@core/effects/types.js';
import { Timeline } from '@core/motion/compositor.js';
import { NONE } from '@core/motion/types.js';
import type { LookSpec } from '@core/render/looks.js';
import { Word } from '@core/render/word.js';
import type { LoadedFont } from '@core/text/font.js';
import * as THREE from 'three';
import { fitter, labCamera, viewBudget } from './lab-view.js';

/**
 * The rest pose, shared. Word starts every material at three's default opacity of 1 until `apply`
 * runs, which renders tubing's 0.08 backing as a solid wall over its own tube. Exported so a test
 * can pin it: both labs carried their own copy under different names.
 */
export const REST_TIMELINE = new Timeline({
  enter: NONE,
  active: NONE,
  exit: NONE,
  hold: 0,
  blendMs: 0,
});

export interface Cell {
  /** What this cell was built from; a change to it is what makes the cell stale. */
  key: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Yawed and pitched by the pose. The camera never moves; the fit solves against `DISTANCE`. */
  pivot: THREE.Group;
  /** Sizes the letter to the panel it is about to be drawn into, `w / h`, times `zoom`. */
  fit(aspect: number, zoom?: number): void;
  /** Drives one frame of the look's own effects against a shared clock. */
  advance(elapsed: number, dt: number): void;
  /** Whether a bloom switch reaches this cell. A diagnostic's colors must not lie. */
  bloomable: boolean;
  dispose(): void;
}

export interface CellInput {
  letter: string;
  look: LookSpec;
  font: LoadedFont;
  environment: THREE.Texture;
  /** Whatever the caller wants drawn instead of a Word; `beauty` and the gallery pass nothing. */
  content?: THREE.Object3D;
  /** Replaces both tube materials, for the ramp mode. */
  tubeMaterial?: (which: 'lit' | 'dark') => THREE.Material | undefined;
}

export function buildCell(input: CellInput): Cell {
  const scene = new THREE.Scene();
  scene.environment = input.environment;
  const camera = labCamera();
  const pivot = new THREE.Group();
  scene.add(pivot);

  if (input.content) {
    pivot.add(input.content);
    return {
      key: '',
      scene,
      camera,
      pivot,
      fit: fitter(pivot),
      advance: () => {},
      bloomable: false,
      dispose() {
        pivot.clear();
      },
    };
  }

  // Word adopts an override into its own material lists and disposes it; the cell must not.
  const word = new Word(
    input.letter,
    input.font,
    input.look,
    viewBudget(),
    false,
    undefined,
    input.tubeMaterial ? { tubeMaterial: input.tubeMaterial } : undefined,
  );
  const ctx: FrameCtx = { pointer: null, pointerInWord: null, dt: 0 };
  word.apply(REST_TIMELINE, 0, ctx);
  pivot.add(word.group);

  return {
    key: '',
    scene,
    camera,
    pivot,
    fit: fitter(pivot),
    advance(elapsed, dt) {
      ctx.dt = dt;
      word.apply(REST_TIMELINE, elapsed, ctx);
    },
    // A `tubeMaterial` override clears `readsRunColor`, and the tube builder's color write returns
    // early on that — so a ramp cell neither blooms nor sweeps.
    bloomable: !input.tubeMaterial,
    dispose() {
      pivot.remove(word.group);
      word.dispose();
    },
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node_modules/.bin/vitest run packages/core/test/dev/shared/lab-cell.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Register the test project**

`packages/core/tsconfig.test.json` already references `./dev/shared`; no change needed. Confirm with:

Run: `node_modules/.bin/tsc -b packages/core/dev/shared`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add packages/core/dev/shared/lab-cell.ts packages/core/test/dev/shared/lab-cell.test.ts
git commit -m "add one lab cell both labs can build from"
```

---

## Task 2: The surface host

`useLabSurface` owns the renderer and drives labkit's frame. It replaces every line of DOM measurement in both labs.

**Files:**
- Create: `packages/core/dev/shared/lab-surface.ts`

- [ ] **Step 1: Write it**

```ts
// packages/core/dev/shared/lab-surface.ts
import {
  type Rect,
  rectsEqual,
  type SurfaceHandle,
  toDeviceRect,
  useTiledSurface,
} from '@weasel-js/labkit';
import { useCallback, useEffect, useRef } from 'react';
import { LabRenderer, type PanelDraw } from './lab-renderer.js';

/**
 * What the host draws this frame. Returning nothing skips the frame entirely. The renderer is
 * handed in rather than read back off the returned handle, so a caller cannot close over a
 * `surface` it is still in the middle of declaring.
 */
export type Compose = (
  rects: ReadonlyMap<string, Rect>,
  lab: LabRenderer,
  /** Which tiles need repainting, or `null` meaning all of them — the buffer was just cleared. */
  dirty: ReadonlySet<string> | null,
) => PanelDraw[];

export interface LabSurface {
  canvasRef: (el: HTMLCanvasElement | null) => void;
  containerRef: (el: HTMLElement | null) => void;
  registerTile: (id: string, el: HTMLElement | null) => void;
  /** Re-measure before the next frame. The escape hatch for a move the grid did not report. */
  invalidateRects: () => void;
  invalidateAll: () => void;
  renderer: () => LabRenderer | null;
}

/**
 * labkit measures the tiles and owns the clock; klieg owns the GL. `compose` runs once per frame
 * with every tile's rect — not only the dirty ones, because a scissored draw has to know where it
 * is drawing relative to a surface that may have resized under it.
 */
/** A guard against a layout that never holds still; the re-arm terminates on agreement, not here. */
const SETTLE_FRAMES = 40;

export function useLabSurface(compose: Compose): LabSurface {
  const labRef = useRef<LabRenderer | null>(null);
  const composeRef = useRef(compose);
  composeRef.current = compose;

  /** Last frame's geometry, so a re-tile can be told from an ordinary repaint. */
  const previous = useRef(new Map<string, Rect>());
  /** How many times the re-arm has fired without the rects agreeing. */
  const settling = useRef(0);
  /** The handle, so `onFrame` can re-arm the surface it belongs to. */
  const handle = useRef<SurfaceHandle | null>(null);

  const surface = useTiledSurface({
    onFrame: ({ dirty, rects, dpr, size }) => {
      const lab = labRef.current;
      if (!lab) return;
      lab.resize(size.width, size.height, dpr);

      // The gutters lie outside every scissor, so a moved tile strands its old picture where
      // nothing repaints it. Clearing unconditionally would fix that and make `dirty` worthless —
      // every frame would repaint every panel. labkit 1.4.4 has no `retiled` flag, so compare.
      let retiled = rects.size !== previous.current.size;
      if (!retiled) {
        for (const [id, rect] of rects) {
          if (rectsEqual(previous.current.get(id), rect)) continue;
          retiled = true;
          break;
        }
      }
      if (retiled) {
        lab.clear();
        previous.current = new Map(rects);
        // Ask to be measured again. labkit measures only when something sets `needsMeasure` — a
        // ResizeObserver callback or an explicit invalidateRects — and a tile whose size has
        // settled while its position is still moving fires neither, so the last frame handed over
        // is mid-flight and nothing ever corrects it. Self-terminating: the first frame whose rects
        // match the previous one takes the else branch and stops. The cap is a guard against a
        // layout that never settles, not part of the termination.
        if (settling.current < SETTLE_FRAMES) {
          settling.current += 1;
          handle.current?.invalidateRects();
        }
      } else {
        settling.current = 0;
      }

      const draws = composeRef.current(rects, lab, retiled ? null : dirty);
      if (draws.length === 0) return;
      lab.draw(
        draws.map((d) => ({ ...d, rect: toDeviceRect(d.rect, size.height, dpr) })),
      );
    },
  });

  // Assigned after the hook returns so `onFrame`, which runs later, can re-arm the surface it
  // belongs to without closing over a binding it is still being declared into.
  handle.current = surface;

  const canvasRef = useCallback((el: HTMLCanvasElement | null) => {
    if (el) {
      labRef.current = new LabRenderer(el);
      return;
    }
    labRef.current?.dispose();
    labRef.current = null;
  }, []);

  useEffect(() => () => {
    labRef.current?.dispose();
    labRef.current = null;
  }, []);

  return {
    canvasRef,
    containerRef: surface.containerRef,
    registerTile: surface.registerTile,
    invalidateRects: surface.invalidateRects,
    invalidateAll: surface.invalidateAll,
    renderer: () => labRef.current,
  };
}
```

- [ ] **Step 2: Take the y-flip out of `LabRenderer`**

`toDeviceRect` now does the flip and the snapping, so `draw` must stop doing them. In
`packages/core/dev/shared/lab-renderer.ts`, replace the body of `draw` (lines 63–93) with:

```ts
  /** Rects arrive from `toDeviceRect`: already bottom-left, already snapped to the device grid. */
  draw(panels: readonly PanelDraw[]): void {
    const r = this.renderer;
    for (const panel of panels) {
      const { x, y, w, h } = panel.rect;
      if (w < 2 || h < 2) continue;
      panel.camera.aspect = w / h;
      panel.camera.updateProjectionMatrix();

      if (panel.bloom) {
        this.bloom.render(panel.scene, panel.camera, { x, y, w, h });
        continue;
      }
      r.setRenderTarget(null);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.setScissorTest(true);
      r.clear();
      r.render(panel.scene, panel.camera);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.width, this.height);
    }
  }
```

- [ ] **Step 3: Let `resize` take the DPR labkit reports**

Replace `resize` (lines 46–52) with:

```ts
  resize(width: number, height: number, dpr: number): void {
    const ratio = Math.min(dpr, 2);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
  }
```

- [ ] **Step 4: Typecheck**

Run: `node_modules/.bin/tsc -b packages/core/dev/shared`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/dev/shared/lab-surface.ts packages/core/dev/shared/lab-renderer.ts
git commit -m "drive the lab renderer from labkit's tiled surface"
```

---

## Task 3: Migrate tube-gallery

First caller. It has no drag, no resize and no settle loop, so nothing is lost.

**Files:**
- Modify: `packages/core/dev/tube-gallery/src/App.tsx`
- Delete: `packages/core/dev/tube-gallery/src/cell.ts`

- [ ] **Step 1: Point it at the shared cell**

Replace the import on line 5 of `App.tsx`:

```ts
import { buildCell, type Cell } from '@shared/lab-cell.js';
```

and change `cells` on line 19 to `useRef(new Map<string, Cell>())`. `buildCell` now takes
`letter` where it took `letter` already — the call on lines 78–84 is unchanged apart from the
import.

- [ ] **Step 2: Delete the measurement code**

Delete from `App.tsx`: the `rects` ref (line 21), the whole `measure` callback (lines 50–65), and
the `ResizeObserver` effect (lines 93–99).

- [ ] **Step 3: Drive the frame from the surface**

Replace the `tick` effect (lines 101–128) with:

```tsx
  const surface = useLabSurface((rects) => {
    const draws: PanelDraw[] = [];
    const now = performance.now();
    const dt = last.current > 0 ? now - last.current : 0;
    last.current = now;
    if (live.current.running) elapsed.current += dt;
    for (const variant of VARIANTS) {
      const cell = cells.current.get(variant.id);
      const rect = rects.get(variant.id);
      if (!cell || !rect || rect.w < 2 || rect.h < 2) continue;
      cell.advance(elapsed.current, dt);
      cell.fit(rect.w / rect.h);
      draws.push({ rect, scene: cell.scene, camera: cell.camera, bloom: live.current.bloom });
    }
    return draws;
  });
```

and add, after the cells are built (the effect ending line 91), `surface.invalidateAll();` so a
rebuilt cell repaints.

- [ ] **Step 4: Attach the refs in the JSX**

In the render (lines 138–154), change the stage, canvas and tile refs:

```tsx
      <div className="stage" ref={surface.containerRef}>
        <canvas ref={surface.canvasRef} />
        <div className="grid">
          {VARIANTS.map((variant) => (
            <div className="tile" key={variant.id}>
              <div className="tile__bar">{variant.label}</div>
              <div
                className="tile__body"
                ref={(el) => {
                  surface.registerTile(variant.id, el);
                }}
              />
            </div>
          ))}
        </div>
      </div>
```

Note the tile registers on `.tile__body`, which is the box the old `measure` read — not on `.tile`,
which includes the label bar.

- [ ] **Step 5: Delete the old cell and typecheck**

```bash
git rm packages/core/dev/tube-gallery/src/cell.ts
node_modules/.bin/tsc -b packages/core/dev/tube-gallery
```
Expected: exit 0.

- [ ] **Step 6: Run its test file**

Run: `node_modules/.bin/vitest run packages/core/test/tube-gallery/variants.test.ts`
Expected: PASS. It tests `variants.ts`, which this task does not touch — a failure here means the
import graph broke, not the variants.

- [ ] **Step 7: Look at it**

```bash
node_modules/.bin/vite packages/core/dev/tube-gallery
```
Open `http://localhost:5185/`. Expect 24 cells, each a letter sweeping its own hue, no black tiles
and no hairline seams between them. A black tile means `preserveDrawingBuffer` was lost; a seam
means a rect is being snapped twice.

- [ ] **Step 8: Commit**

```bash
git add packages/core/dev/tube-gallery/src/App.tsx
git commit -m "put the tube gallery on labkit's tiled surface"
```

---

## Task 4: Migrate tube-lab, keeping its settle loop

Second caller. This is the one that proves the abstraction: if `App.tsx` does not get shorter, stop and say so.

**Files:**
- Modify: `packages/core/dev/tube-lab/src/App.tsx`
- Delete: `packages/core/dev/tube-lab/src/render/cell.ts`

- [ ] **Step 1: Delete the measurement machinery**

From `App.tsx`, delete: `rects` (line 236), `observer` (237), the `measure` callback (262–295), the
`ResizeObserver` effect (320–330), and the `PanelRect` import on line 6.

- [ ] **Step 2: Repoint the settle loop at `invalidateRects`**

The whole settle loop goes. Task 2 moved it into the surface host, where it serves both labs and
both draw paths — including `drawOne`, which reads a cached rect and re-measures nothing.
`scheduleMeasure` collapses to one line:

```ts
  // The grid moves tiles without resizing them, which a ResizeObserver cannot see. One ask is
  // enough: `useLabSurface` re-arms itself until two measurements agree.
  const scheduleMeasure = useCallback(() => {
    surface.invalidateRects();
  }, [surface]);
```

Delete with it: `measureFrame` (line 238), `quiet` (239), and `SETTLE_FRAMES` (line 69), which now
lives in `lab-surface.ts`.

**Do not port the old loop instead.** Its termination was `quiet.current >= 2 || frames >
SETTLE_FRAMES` — agreement *or* a 40-frame cap. A version keeping only the cap stops early on a
longer animation and leaves the canvas where the tiles were caught mid-flight, which is the exact
bug the loop exists to prevent. Termination must be agreement; the cap is only a guard against a
layout that never settles.

- [ ] **Step 3: Move the draw body into `compose`**

The effect at lines 486–557 builds `draws` and calls `lab.draw`. Keep every line of cell
construction exactly as it is; change only the three ends of it — read `rect` from the map the
surface hands in, drop `lab.resize`/`lab.clear`, and return the array instead of calling
`lab.draw`:

```tsx
  const surface = useLabSurface((rects, lab) => {
    if (!font) return [];
    const draws: PanelDraw[] = [];
    const live = new Set<string>();
    for (const record of panels) {
      const rect = rects.get(record.id);
      if (!rect) continue;
      // ...every line from `const id = record.id;` (499) through `setReport(id, '');` (534)
      // unchanged, including the whole skeleton/ramp branch...
      pose(cell, id, rect.w / rect.h);
      draws.push({ rect, scene: cell.scene, camera: cell.camera, bloom: cell.bloomable && bloom });
    }
    for (const [id, cell] of cellsRef.current) {
      if (live.has(id)) continue;
      cell.dispose();
      cellsRef.current.delete(id);
      views.current.delete(id);
      setReport(id, '');
    }
    return draws;
  });
```

`lab.environmentTexture` is still needed inside the loop; take it from `surface.renderer()` as
above.

- [ ] **Step 4: Point `mountTile` at the surface**

Replace `mountTile` (332–345) with:

```ts
  const mountTile = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      surface.registerTile(id, el);
      scheduleMeasure();
    },
    [surface, scheduleMeasure],
  );
```

and attach `surface.containerRef` to `.stage` and `surface.canvasRef` to the canvas in the render
at lines 560–563.

- [ ] **Step 5: Delete the old cell, repoint its import**

```bash
git rm packages/core/dev/tube-lab/src/render/cell.ts
```
and in `App.tsx` import `{ buildCell, type Cell }` from `@shared/lab-cell.js`. `buildCell` now takes
`letter` rather than `meta`, so the two call sites at 511 and 526 pass `letter: record.letter`
instead of `meta: record`.

- [ ] **Step 6: Typecheck and run the lab's own tests**

```bash
node_modules/.bin/tsc -b packages/core/dev/tube-lab
node_modules/.bin/vitest run packages/core/test/dev/tube-lab/
```
Expected: exit 0, and 4 files passing. `fit.test.ts` must be untouched and green — it is the fit's
only coverage.

- [ ] **Step 7: Look at it, and drag something**

```bash
node_modules/.bin/vite packages/core/dev/tube-lab
```
Open `http://localhost:5181/`. Sixteen panels draw. Then, in order: drag a seam and confirm both
panels resize with the canvas following; drag a panel to reorder it and confirm the canvas lands
where the tiles land rather than a frame behind; and confirm the gutters stay clean rather than
keeping a ghost of the old layout. That last one is the check that the full-buffer clear survived.

- [ ] **Step 8: Count the lines**

```bash
git diff --stat packages/core/dev/tube-lab/src/App.tsx
```
Expected: a net deletion. **If `App.tsx` did not get shorter, the abstraction is wrong — stop and
report that rather than continuing.** That is this plan's acceptance test, not a formality.

- [ ] **Step 9: Commit**

```bash
git add packages/core/dev/tube-lab/src/App.tsx
git commit -m "put the tube lab on labkit's tiled surface"
```

---

## Task 5: The two dead things this passes through

**Files:**
- Modify: `packages/core/dev/tube-lab/src/styles.css`
- Modify: `packages/core/dev/tube-lab/src/persist.ts`

- [ ] **Step 1: Delete the dead CSS**

`styles.css` styles `.stage .lk-trial-tile__grip` and `.stage .lk-trial-tile__body`. Neither class
exists in labkit 1.4.4 — its shipped `styles.css` emits only `lk-trial-tile`, and the trial title bar
is the drag surface. Confirm, then delete both rules:

```bash
grep -c "lk-trial-tile__grip\|lk-trial-tile__body" node_modules/@weasel-js/labkit/dist/styles.css
```
Expected: `0`.

- [ ] **Step 2: Import the type the docstring says is not exported**

`persist.ts:7` reads "labkit declares this type but does not export it, so it is read off the
component's own props." It does export it. Replace lines 7–8 with:

```ts
import type { TrialLayout } from '@weasel-js/labkit';

export type WorkspaceLayout = TrialLayout;
```

and drop the now-unused `ComponentProps` and `Workspace` imports.

- [ ] **Step 3: Typecheck**

Run: `node_modules/.bin/tsc -b packages/core/dev/tube-lab`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/core/dev/tube-lab/src/styles.css packages/core/dev/tube-lab/src/persist.ts
git commit -m "drop two rules for classes labkit does not emit, and a docstring that was wrong"
```

---

## What this plan deliberately does not do

**No front page.** It is the third caller, and it only earns its design once the kit has survived two.

**No state format.** `ShowConfig` has one caller. Generalizing it now repeats the mistake it exists to fix.

**No `registerClear`, no per-tile painting.** Both wait on a labkit release. The full-buffer clear stands in, and Task 2 says so in the code.

**No kliegsminister and no composition-lab.** kliegsminister is 2D and already inside labkit's shell; composition-lab renders through `createKlieg` into a DOM element and owns no tiles. Neither is a surface tenant.
