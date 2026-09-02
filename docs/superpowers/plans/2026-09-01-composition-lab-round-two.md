# Composition lab, round two — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the composition lab's panels describe the pool the preview actually renders, bring
its piece roster back in step with core, and add the swatch grid, the tenure/jump readout and the
param sweep.

**Architecture:** The lab's pure modules (`sample.ts`, `pool.ts`, `composition.ts`, `pieces.ts`,
`emit.ts`, and two new files `tenure.ts` and `sweep.ts`) hold everything with behaviour and are
covered by vitest under `packages/core/test/composition-lab/`. The React shell (`App.tsx`,
`Rail.tsx`, and the panel components) is not tested, matching round one. Nothing in the lab
re-derives targeting, staggering or merging: it drives core's own `planEffects` and `EffectFrame`.

**Tech Stack:** TypeScript, React 19, vite, vitest, biome. The lab resolves core through the
`@core/*` path alias.

**Design:** [`specs/2026-09-01-composition-lab-round-two-design.md`](../specs/2026-09-01-composition-lab-round-two-design.md)

**Run the lab:** `npm --prefix packages/core run dev:composition-lab` — vite on port 5183.

**Run the tests:** `npx vitest run packages/core/test/composition-lab/` from the repo root.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `dev/composition-lab/src/sample.ts` | Sample one pass into a part × sample grid. Gains `light` and `moved`. | 1 |
| `dev/composition-lab/src/Plot.tsx` | One part's channel over one pass. Gains `light` and a `color` strip. | 2 |
| `dev/composition-lab/src/pieces.ts` | Piece kinds, their params, and how a layer builds one. Gains `lamp`. | 3 |
| `dev/composition-lab/src/composition.ts` | The composition model and the `fire()` it describes. Gains `intermittent`, `lampSource`, `pool`. | 4 |
| `dev/composition-lab/src/Rail.tsx` | Every control. Gains the pool source, the lamp source, the `intermittent` wrapper. | 5 |
| `dev/composition-lab/src/emit.ts` | The pasteable `fire()` call. Learns `lamp` and `intermittent`. | 6 |
| `dev/composition-lab/src/App.tsx` | State, clock, pool, and the panel deck. | 7, 12 |
| `dev/composition-lab/src/Raster.tsx` | part × time. Learns to say an empty pool is empty. | 7 |
| `dev/composition-lab/src/tenure.ts` | **New.** Tenure and jump, off the sampled frame. | 8 |
| `dev/composition-lab/src/Tenure.tsx` | **New.** The readout. | 9 |
| `dev/composition-lab/src/Swatch.tsx` | **New.** One cell per part at its em position. | 10 |
| `dev/composition-lab/src/sweep.ts` | **New.** Resample a pass per value of one param. | 11 |
| `dev/composition-lab/src/Sweep.tsx` | **New.** The table, with flat columns marked. | 12 |
| `dev/composition-lab/src/styles.css` | The two-column deck. | 12 |

---

### Task 1: `light` and `moved` in the sampler

A lamp writes only `PartOffset.light`. `PassSamples` carries no light channel, so a lamp layer
would flip `touched` and leave every plotted channel flat — indistinguishable from a broken piece.
`moved` is the per-sample record Task 8 reads run-lengths out of.

**Files:**
- Modify: `packages/core/dev/composition-lab/src/sample.ts`
- Test: `packages/core/test/composition-lab/sample.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/composition-lab/sample.test.ts`, inside the existing
`describe('samplePass', ...)` block:

```ts
  it('samples light, so a lamp layer plots as something rather than as a flat gain', () => {
    const parts = pool(2);
    const LAMP: EffectPiece = {
      duration: 1000,
      at: (_t, part) => (part.index === 0 ? { light: { color: 0xffffff, amount: 1 } } : {}),
    };
    const frame = new EffectFrame(
      planEffects([{ piece: LAMP, target: { kind: 'run', by: 'index', amount: 1 } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 4, NO_CTX);
    expect(s.light[0]?.every((v) => v > 0)).toBe(true);
    expect(s.light[1]?.every((v) => v === 0)).toBe(true);
  });

  it('records moved per sample, not just per pass, so a tenure has an end', () => {
    const parts = pool(1);
    const HALF: EffectPiece = { duration: 1000, at: (t) => (t < 0.5 ? { gain: 0.2 } : {}) };
    const frame = new EffectFrame(
      planEffects([{ piece: HALF, target: { kind: 'run', by: 'index', amount: 1 } }], parts),
    );
    const s = samplePass(frame, parts, 1000, 4, NO_CTX);
    expect(s.moved[0]).toEqual([true, true, false, false]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/core/test/composition-lab/sample.test.ts`
Expected: FAIL — `s.light` and `s.moved` are undefined.

- [ ] **Step 3: Widen `PassSamples`**

In `packages/core/dev/composition-lab/src/sample.ts`, replace the `PassSamples` interface:

```ts
/** One pass sampled on a grid: a row per part, a column per sample. */
export interface PassSamples {
  samples: number;
  /** Multiplicative channels rest at 1; an untouched part is all-1, not all-0. */
  gain: number[][];
  scale: number[][];
  dark: number[][];
  crawl: number[][];
  /** Length of the merged lamp vector. A lamp writes nothing else, so without this a lamp layer
   * reads on every other channel exactly as a piece that does nothing does. */
  light: number[][];
  /** Packed 0xRRGGBB, or -1 where no layer wrote a colour. */
  color: number[][];
  /** Whether any layer ever MOVED this part across the whole pass. Being targeted is not enough:
   * a piece like `roving` addresses the whole pool and afflicts one part of it, and counting the
   * pool would make this blind to exactly the fault it exists to show. */
  touched: boolean[];
  /** The same question per sample. Tenure is a run of trues; a handover is where the set changes. */
  moved: boolean[][];
}
```

- [ ] **Step 4: Fill the two new grids**

In the same file, replace the body of `samplePass` from the `grid` helper through the return:

```ts
  const grid = (fill: number) =>
    Array.from({ length: parts.length }, () => new Array<number>(samples).fill(fill));
  const flags = () =>
    Array.from({ length: parts.length }, () => new Array<boolean>(samples).fill(false));

  const out: PassSamples = {
    samples,
    gain: grid(1),
    scale: grid(1),
    dark: grid(0),
    crawl: grid(0),
    light: grid(0),
    color: grid(-1),
    touched: new Array<boolean>(parts.length).fill(false),
    moved: flags(),
  };

  for (let s = 0; s < samples; s++) {
    const resolved = frame.resolve(parts, (s / samples) * duration, ctx);
    for (const [index, o] of resolved) {
      const active = moved(o);
      if (active) out.touched[index] = true;
      (out.moved[index] as boolean[])[s] = active;
      (out.gain[index] as number[])[s] = o.gain;
      (out.scale[index] as number[])[s] = o.scale;
      (out.dark[index] as number[])[s] = o.dark;
      (out.crawl[index] as number[])[s] = o.crawl;
      (out.light[index] as number[])[s] = Math.hypot(o.light[0], o.light[1], o.light[2]);
      (out.color[index] as number[])[s] = o.color ?? -1;
    }
  }
  return out;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/sample.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/dev/composition-lab/src/sample.ts \
        packages/core/test/composition-lab/sample.test.ts
git commit -m "sample a lamp's light, and record which sample moved a part"
```

---

### Task 2: `light` and `color` reach the plot

`CHANNELS` is `gain | scale | dark | crawl`, so the channel the previous task started sampling has
nowhere to be read. A packed colour has no meaningful vertical position, so it draws as a strip.

**Files:**
- Modify: `packages/core/dev/composition-lab/src/Plot.tsx`

- [ ] **Step 1: Widen the channel list**

In `packages/core/dev/composition-lab/src/Plot.tsx`, replace lines 4–6:

```ts
export type Channel = 'gain' | 'scale' | 'dark' | 'crawl' | 'light' | 'color';

export const CHANNELS: Channel[] = ['gain', 'scale', 'dark', 'crawl', 'light', 'color'];
```

- [ ] **Step 2: Draw a colour channel as a strip**

In the same file, inside the `useEffect`, immediately after the `g.clearRect(0, 0, w, h);` line,
insert:

```ts
    // A packed colour has no vertical position to plot. -1 is "no layer wrote one", drawn as a gap
    // rather than as black, which is a colour a layer can genuinely write.
    if (channel === 'color') {
      const cw = Math.max(1, w / row.length);
      for (let s = 0; s < row.length; s++) {
        const packed = row[s] as number;
        if (packed < 0) continue;
        g.fillStyle = `#${packed.toString(16).padStart(6, '0')}`;
        g.fillRect((s / row.length) * w, 8, cw, h - 16);
      }
      g.strokeStyle = '#5aa9e6';
      g.beginPath();
      g.moveTo(at * w, 0);
      g.lineTo(at * w, h);
      g.stroke();
      return;
    }
```

- [ ] **Step 3: Add `channel` to the effect's dependencies**

Still in `Plot.tsx`, the `useEffect` closes with `}, [row, at]);`. The strip branch reads `channel`,
so replace that line with:

```ts
  }, [row, at, channel]);
```

- [ ] **Step 4: Verify by eye**

Run: `npm --prefix packages/core run dev:composition-lab`
Open `http://localhost:5183/`, add a `hue` layer, and pick `color` in the channel select.
Expected: a colour band sweeping through the wheel, with the playhead over it. Pick `light`.
Expected: a flat line at 0 — nothing writes light yet, which Task 3 fixes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/dev/composition-lab/src/Plot.tsx
git commit -m "plot light as a line and colour as a strip"
```

---

### Task 3: `lamp` joins the piece roster

`lamp()` is an ordinary `EffectPiece`, so it needs no new layer machinery — but its `source` is a
function rather than a number, which is the one thing `PARAMS` cannot express.

Only `fixed` and `orbit` are offered. `fromPointer`, the shipped default, needs `ctx.pointerInWord`,
which needs a `PlacedWord` that lives inside the running fire; the design says why that is out of
scope.

**Files:**
- Modify: `packages/core/dev/composition-lab/src/pieces.ts`
- Test: `packages/core/test/composition-lab/pieces.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/composition-lab/pieces.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPiece, defaultParams } from '../../dev/composition-lab/src/pieces.js';
import type { PartInfo } from '../../src/effects/types.js';
import { NO_CTX } from '../effects/ctx.js';

function part(x: number): PartInfo {
  return {
    kind: 'run',
    index: 0,
    count: 1,
    letter: { index: 0, count: 1 },
    x,
    y: 0,
    ink: { minX: x, maxX: x, minY: 0, maxY: 0 },
    at: 0,
    span: 1,
  };
}

describe('buildPiece for lamp', () => {
  it('lights a part under the lamp and leaves one outside its radius alone', () => {
    const piece = buildPiece('lamp', { ...defaultParams('lamp'), x: 0, radius: 0.5 });
    expect(piece?.at(0, part(0), NO_CTX).light?.amount).toBeGreaterThan(0);
    expect(piece?.at(0, part(4), NO_CTX).light).toBeUndefined();
  });

  it('ignores the clock under a fixed source and follows it under an orbit', () => {
    const params = { ...defaultParams('lamp'), x: 0, y: 0, sweep: 0.4, radius: 0.5 };
    const still = buildPiece('lamp', params, { lampSource: 'fixed' });
    const moving = buildPiece('lamp', params, { lampSource: 'orbit' });
    const at = (p: typeof still, t: number) => p?.at(t, part(0.4), NO_CTX).light?.amount ?? 0;
    expect(at(still, 0)).toBeCloseTo(at(still, 0.5));
    expect(at(moving, 0)).not.toBeCloseTo(at(moving, 0.5));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/composition-lab/pieces.test.ts`
Expected: FAIL — `buildPiece` rejects `'lamp'` as a `PieceKind`, and takes three positional
arguments rather than an options object.

- [ ] **Step 3: Add the kind, its params and its source**

In `packages/core/dev/composition-lab/src/pieces.ts`, replace the import line and the `PieceKind`
declaration (lines 1–6):

```ts
import { fixed, lamp, orbit } from '@core/effects/lamp.js';
import { chase, flicker, hue } from '@core/effects/pieces.js';
import type { EffectPiece } from '@core/effects/types.js';
import { type Look, specOf } from '@core/render/looks.js';
import { compileDraft } from './draft.js';

export type PieceKind = 'flicker' | 'hue' | 'chase' | 'lamp' | 'draft';

/** Which `LightSource` a lamp walks. `fromPointer`, the shipped default, needs a placed word the
 * lab cannot reach; see the design. */
export type LampSourceKind = 'fixed' | 'orbit';
```

Then add a `lamp` entry to `PARAMS`, immediately after the `chase` block and before the closing
`};` on line 129:

```ts
  lamp: [
    {
      key: 'duration',
      min: 200,
      max: 20000,
      step: 100,
      value: 4000,
      hint: 'One orbit. A fixed source ignores the clock, so this is inert under it.',
    },
    {
      key: 'radius',
      min: 0.05,
      max: 2,
      step: 0.05,
      value: 0.5,
      hint: 'How far the light reaches, in em of layout space. Measured to a part’s ink centre.',
    },
    {
      key: 'strength',
      min: 0,
      max: 8,
      step: 0.1,
      value: 2,
      hint: 'Light at the centre, falling to zero at the radius.',
    },
    {
      key: 'x',
      min: -3,
      max: 3,
      step: 0.05,
      value: 0,
      hint: 'Lamp position under a fixed source, and the orbit centre under an orbit.',
    },
    {
      key: 'y',
      min: -1.5,
      max: 1.5,
      step: 0.05,
      value: 0,
      hint: 'Same axis as the swatch grid, +y up. A single-line sign sits near 0.35.',
    },
    {
      key: 'sweep',
      min: 0,
      max: 2,
      step: 0.05,
      value: 0.3,
      hint: 'Radius of the circle an orbit walks. Inert under a fixed source.',
    },
  ],
```

- [ ] **Step 4: Build it**

Still in `pieces.ts`, replace `buildPiece` (lines 143–153) with:

```ts
export interface BuildOptions {
  /** A draft's hand-authored body. */
  source?: string;
  lampSource?: LampSourceKind;
}

/** A persisted layer can predate a param, so every read carries the default it was authored with. */
function num(params: Record<string, number>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Null when a draft's source has not compiled; every built-in always builds. */
export function buildPiece(
  kind: PieceKind,
  params: Record<string, number>,
  opts: BuildOptions = {},
): EffectPiece | null {
  if (kind === 'draft') return opts.source ? compileDraft(opts.source) : null;
  if (kind === 'flicker') return flicker(params);
  if (kind === 'hue') return hue(params);
  if (kind === 'chase') return chase(params);

  const x = num(params, 'x', 0);
  const y = num(params, 'y', 0);
  return lamp({
    source:
      opts.lampSource === 'orbit' ? orbit({ radius: num(params, 'sweep', 0.3), x, y }) : fixed(x, y),
    duration: num(params, 'duration', 4000),
    radius: num(params, 'radius', 0.5),
    strength: num(params, 'strength', 2),
  });
}
```

- [ ] **Step 5: Point the one existing caller at the options object**

`composition.ts:50` still calls `buildPiece(layer.kind, layer.params, layer.source)`. Task 4
rewrites that function; to keep the tree compiling in the meantime, in
`packages/core/dev/composition-lab/src/composition.ts` replace line 50:

```ts
  const inner = buildPiece(layer.kind, layer.params, { source: layer.source });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/dev/composition-lab/src/pieces.ts \
        packages/core/dev/composition-lab/src/composition.ts \
        packages/core/test/composition-lab/pieces.test.ts
git commit -m "give the composition lab a lamp layer, on a fixed or orbiting source"
```

---

### Task 4: `intermittent`, and the two constraints the wrappers impose

`intermittent` shipped after round one and the lab has never offered it. Two behaviours have to be
carried rather than discovered: `roving` substitutes a part's `index` while leaving its `x`/`y`
alone, so a position-dependent inner reads the wrong place — its docstring names `lamp`; and
`intermittent` throws when `spell` cannot cover one inner pass.

**Files:**
- Modify: `packages/core/dev/composition-lab/src/composition.ts`
- Test: `packages/core/test/composition-lab/composition.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/composition-lab/composition.test.ts`, at the end of the file:

```ts
describe('layerPiece wrappers', () => {
  const base = {
    id: 'a',
    kind: 'flicker' as const,
    enabled: true,
    params: { duration: 1000 },
    target: 'run' as const,
    amount: 1,
    seed: 0,
  };

  it('lengthens a pass to whole bouts under intermittent', () => {
    const plain = layerPiece(base);
    const gated = layerPiece({ ...base, intermittent: { spell: 2000, calm: 1000, bouts: 3 } });
    expect(gated?.duration).toBeGreaterThan(plain?.duration as number);
  });

  it('will not build a layer whose spell cannot cover one inner pass', () => {
    expect(layerPiece({ ...base, intermittent: { spell: 100, calm: 1000, bouts: 3 } })).toBeNull();
  });

  // roving calls its inner with the caller's x/y and a substituted index, so a lamp under it
  // lights the wrong place. The rail hides the pairing; a composition persisted before it did
  // still has to build something honest.
  it('drops a roving wrapper from a lamp rather than lighting the wrong part', () => {
    const layer = { ...base, kind: 'lamp' as const, params: {}, roving: { dwell: 3200, seed: 0, epochs: 96 } };
    const piece = layerPiece(layer);
    expect(piece).not.toBeNull();
    expect(piece?.duration).toBe(4000);
  });
});
```

Add `layerPiece` to the existing import from `../../dev/composition-lab/src/composition.js` at the
top of that file if it is not already there.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/core/test/composition-lab/composition.test.ts`
Expected: FAIL — `intermittent` is not a property of `EffectLayer`.

- [ ] **Step 3: Widen the model**

In `packages/core/dev/composition-lab/src/composition.ts`, replace the imports (lines 1–5) and the
`RovingWrap`/`EffectLayer` declarations (lines 7–26):

```ts
import { intermittent } from '@core/effects/intermittent.js';
import { roving } from '@core/effects/roving.js';
import type { EffectPiece, EffectSpec, PartKind } from '@core/effects/types.js';
import type { ActiveName, EnterName, ExitName } from '@core/motion/types.js';
import type { LookName } from '@core/render/looks.js';
import { buildPiece, type LampSourceKind, type PieceKind } from './pieces.js';

export interface RovingWrap {
  dwell: number;
  seed: number;
  epochs: number;
}

export interface IntermittentWrap {
  spell: number;
  calm: number;
  bouts: number;
}

/** Which pool the panels describe. Lab-only: `toFireOptions` and `emit` both ignore it. */
export type PoolSource = 'real' | 'synthetic';

export interface EffectLayer {
  id: string;
  kind: PieceKind;
  enabled: boolean;
  params: Record<string, number>;
  target: PartKind;
  /** `SelectSpec.amount`: a share of the pool, so 1 is all of it. */
  amount: number;
  seed: number;
  stagger?: number;
  roving?: RovingWrap;
  intermittent?: IntermittentWrap;
  /** Set only when `kind` is `'lamp'`. */
  lampSource?: LampSourceKind;
  /** Source for a hand-authored piece; set only when `kind` is `'draft'`. */
  source?: string;
}
```

- [ ] **Step 4: Add the pool source to the composition**

Still in `composition.ts`, replace the `Composition` interface and `DEFAULT_COMPOSITION`
(lines 28–46 of the original file):

```ts
export interface Composition {
  text: string;
  look: LookName;
  hold: number;
  enter: EnterName;
  active: ActiveName;
  exit: ExitName;
  effects: EffectLayer[];
  pool: PoolSource;
}

export const DEFAULT_COMPOSITION: Composition = {
  text: 'ACRONYM',
  look: 'tubing',
  hold: 6000,
  enter: 'slam',
  active: 'none',
  exit: 'none',
  effects: [],
  pool: 'real',
};
```

- [ ] **Step 5: Wrap, in order, and refuse what cannot hold**

Still in `composition.ts`, replace `layerPiece`:

```ts
/** The piece a layer contributes, wrappers included. Null when it will not build. */
export function layerPiece(layer: EffectLayer): EffectPiece | null {
  const inner = buildPiece(layer.kind, layer.params, {
    source: layer.source,
    lampSource: layer.lampSource,
  });
  if (!inner) return null;

  // roving substitutes a part's index and leaves its x/y alone, so a position-dependent inner
  // lights the part it is standing on rather than the one holding the fault.
  const roved = layer.roving && layer.kind !== 'lamp' ? roving(inner, layer.roving) : inner;
  if (!layer.intermittent) return roved;
  try {
    return intermittent(roved, layer.intermittent);
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/dev/composition-lab/src/composition.ts \
        packages/core/test/composition-lab/composition.test.ts
git commit -m "wrap a composition layer in intermittent, and refuse roving over a lamp"
```

---

### Task 5: The rail learns the pool source, the lamp source and the second wrapper

**Files:**
- Modify: `packages/core/dev/composition-lab/src/Rail.tsx`

- [ ] **Step 1: Import what the new controls need**

In `packages/core/dev/composition-lab/src/Rail.tsx`, replace lines 1–14:

```tsx
import type { PartKind } from '@core/effects/types.js';
import { LOOK_NAMES } from '@core/index.js';
import type { LookName } from '@core/render/looks.js';
import type {
  Composition,
  EffectLayer,
  IntermittentWrap,
  PoolSource,
  RovingWrap,
} from './composition.js';
import { emit } from './emit.js';
import {
  defaultParams,
  hasGradient,
  type LampSourceKind,
  PARAMS,
  type PieceKind,
} from './pieces.js';

export interface RailProps {
  composition: Composition;
  onChange: (next: Composition) => void;
  counts: Record<PartKind, number>;
}

const KINDS: PieceKind[] = ['flicker', 'hue', 'chase', 'lamp'];
```

- [ ] **Step 2: Add the setter for the second wrapper**

Still in `Rail.tsx`, immediately after the `setRoving` declaration, insert:

```tsx
  const setBouts = (layer: EffectLayer, patch: Partial<IntermittentWrap>) =>
    setLayer(layer.id, { intermittent: { ...(layer.intermittent as IntermittentWrap), ...patch } });
```

- [ ] **Step 3: Give a new layer its lamp source**

Still in `Rail.tsx`, in the object literal inside `add`, after the `seed: 0,` line, insert:

```tsx
          ...(kind === 'lamp' ? { lampSource: 'fixed' as LampSourceKind } : {}),
```

- [ ] **Step 4: Replace the pool readout with a pool control**

Still in `Rail.tsx`, replace the `<h2>pool</h2>` block (the heading and the `cl-note` paragraph):

```tsx
      <h2>pool</h2>
      <label
        className="cl-row"
        title="Which pool the panels below describe. Real follows the text and look above; synthetic is a fixed 24-run, 7-letter stand-in for exercising a kind this look does not build."
      >
        <span>source</span>
        <select
          value={composition.pool}
          onChange={(e) => onChange({ ...composition, pool: e.target.value as PoolSource })}
        >
          <option value="real">real</option>
          <option value="synthetic">synthetic</option>
        </select>
      </label>
      <p className="cl-note">
        run {counts.run}, body {counts.body}, chunk {counts.chunk}
      </p>
```

- [ ] **Step 5: Offer the lamp its source**

Still in `Rail.tsx`, immediately before the `{layer.kind === 'draft' ? null : PARAMS[layer.kind]...}`
params block, insert:

```tsx
          {layer.kind === 'lamp' ? (
            <label
              className="cl-row"
              title="fixed parks the lamp at x,y. orbit walks a circle of radius sweep around it, on the layer's own duration."
            >
              <span>source</span>
              <select
                value={layer.lampSource ?? 'fixed'}
                onChange={(e) =>
                  setLayer(layer.id, { lampSource: e.target.value as LampSourceKind })
                }
              >
                <option value="fixed">fixed</option>
                <option value="orbit">orbit</option>
              </select>
            </label>
          ) : null}
```

- [ ] **Step 6: Hide `roving` from a lamp, and offer `intermittent` to everything**

Still in `Rail.tsx`, wrap the existing `roving` checkbox label and its `{layer.roving ? ... : null}`
block in a guard, and add the second wrapper after them. Replace from the roving `<label` through
the `) : null}` that closes the roving params with:

```tsx
          {layer.kind === 'lamp' ? (
            <p className="cl-note">
              roving substitutes a part index and leaves x/y alone, so it cannot carry a lamp
            </p>
          ) : (
            <>
              <label
                className="cl-row"
                title="Moves this layer's affliction from part to part. Its pass is many inner passes long, so a short hold may never reach a second handover."
              >
                <input
                  type="checkbox"
                  checked={layer.roving !== undefined}
                  onChange={(e) =>
                    setLayer(layer.id, {
                      roving: e.target.checked ? { dwell: 3200, seed: 0, epochs: 96 } : undefined,
                    })
                  }
                />
                <span>roving</span>
              </label>
              {layer.roving ? (
                <>
                  <label
                    className="cl-row"
                    title="Roughly how long one part keeps the fault. This picks WHO flickers, never how much — that is unrest."
                  >
                    <span>dwell</span>
                    <input
                      type="range"
                      min={400}
                      max={9000}
                      step={100}
                      value={layer.roving.dwell}
                      onChange={(e) => setRoving(layer, { dwell: Number(e.target.value) })}
                    />
                    <output>{layer.roving.dwell}</output>
                  </label>
                  <label
                    className="cl-row"
                    title="Handovers to a pass, and so the ceiling on how many parts a pass can reach before it loops. Below the pool size, some parts never take the fault at all."
                  >
                    <span>epochs</span>
                    <input
                      type="range"
                      min={4}
                      max={192}
                      step={4}
                      value={layer.roving.epochs}
                      onChange={(e) => setRoving(layer, { epochs: Number(e.target.value) })}
                    />
                    <output>{layer.roving.epochs}</output>
                  </label>
                </>
              ) : null}
            </>
          )}

          <label
            className="cl-row"
            title="Runs the layer in bouts and swallows it between them. The inner keeps running against the clock, so a bout opens wherever it happens to be."
          >
            <input
              type="checkbox"
              checked={layer.intermittent !== undefined}
              onChange={(e) =>
                setLayer(layer.id, {
                  intermittent: e.target.checked
                    ? { spell: 4200, calm: 2000, bouts: 3 }
                    : undefined,
                })
              }
            />
            <span>intermittent</span>
          </label>
          {layer.intermittent ? (
            <>
              <label
                className="cl-row"
                title="Milliseconds of one bout. Shorter than one inner pass and the layer will not build at all — the piece throws rather than showing a sliver."
              >
                <span>spell</span>
                <input
                  type="range"
                  min={200}
                  max={20000}
                  step={100}
                  value={layer.intermittent.spell}
                  onChange={(e) => setBouts(layer, { spell: Number(e.target.value) })}
                />
                <output>{layer.intermittent.spell}</output>
              </label>
              <label className="cl-row" title="Milliseconds held quiet between bouts.">
                <span>calm</span>
                <input
                  type="range"
                  min={0}
                  max={30000}
                  step={100}
                  value={layer.intermittent.calm}
                  onChange={(e) => setBouts(layer, { calm: Number(e.target.value) })}
                />
                <output>{layer.intermittent.calm}</output>
              </label>
              <label
                className="cl-row"
                title="Bouts to a pass, and so how long the wrapper's own loop runs before it repeats."
              >
                <span>bouts</span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={layer.intermittent.bouts}
                  onChange={(e) => setBouts(layer, { bouts: Number(e.target.value) })}
                />
                <output>{layer.intermittent.bouts}</output>
              </label>
              {layerBuilds(layer) ? null : (
                <p className="cl-warn">
                  spell is shorter than one pass of {layer.kind} — the layer does not build
                </p>
              )}
            </>
          ) : null}
```

- [ ] **Step 7: Give the warning something to ask**

Still in `Rail.tsx`, replace the `./composition.js` import written in Step 1 — `layerPiece` is a
value, so it joins the same statement rather than getting a second one:

```tsx
import {
  type Composition,
  type EffectLayer,
  type IntermittentWrap,
  layerPiece,
  type PoolSource,
  type RovingWrap,
} from './composition.js';
```

Then add below the `KINDS` constant, above the `Rail` function:

```tsx
const layerBuilds = (layer: EffectLayer): boolean => layerPiece(layer) !== null;
```

- [ ] **Step 8: Verify by eye**

Run: `npm --prefix packages/core run dev:composition-lab`
Add a `lamp` layer. Expected: no `roving` checkbox, a `source` select, and a note saying why.
Add a `flicker` layer, tick `intermittent`, drag `spell` to 200.
Expected: the warning appears and the preview's flicker stops.

- [ ] **Step 9: Commit**

```bash
git add packages/core/dev/composition-lab/src/Rail.tsx
git commit -m "give the rail a pool source, a lamp source and an intermittent wrapper"
```

---

### Task 6: Emit learns the two new shapes

The emit panel's whole claim is that what it prints reproduces what you built. A lamp or an
`intermittent` layer that prints as nothing breaks that claim silently.

**Files:**
- Modify: `packages/core/dev/composition-lab/src/emit.ts`
- Test: `packages/core/test/composition-lab/emit.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/composition-lab/emit.test.ts`:

```ts
describe('emit for the round-two shapes', () => {
  const base = {
    text: 'HI',
    look: 'tubing' as const,
    hold: 6000,
    enter: 'slam' as const,
    active: 'none' as const,
    exit: 'none' as const,
    pool: 'real' as const,
  };
  const layer = {
    id: 'a',
    enabled: true,
    target: 'run' as const,
    amount: 1,
    seed: 0,
  };

  it('prints a fixed lamp with its position, and imports what it names', () => {
    const out = emit({
      ...base,
      effects: [
        {
          ...layer,
          kind: 'lamp' as const,
          lampSource: 'fixed' as const,
          params: { duration: 4000, radius: 0.5, strength: 2, x: 0.4, y: 0.35, sweep: 0.3 },
        },
      ],
    });
    expect(out).toContain('lamp({ source: fixed(0.4, 0.35)');
    expect(out).toContain("import { fixed, lamp } from 'klieg';");
  });

  it('prints an orbiting lamp against its sweep rather than its reach', () => {
    const out = emit({
      ...base,
      effects: [
        {
          ...layer,
          kind: 'lamp' as const,
          lampSource: 'orbit' as const,
          params: { duration: 4000, radius: 0.5, strength: 2, x: 0, y: 0, sweep: 0.8 },
        },
      ],
    });
    expect(out).toContain('orbit({ radius: 0.8, x: 0, y: 0 })');
  });

  it('wraps in intermittent outside roving, matching the order layerPiece applies them', () => {
    const out = emit({
      ...base,
      effects: [
        {
          ...layer,
          kind: 'flicker' as const,
          params: { duration: 1400 },
          roving: { dwell: 3200, seed: 0, epochs: 96 },
          intermittent: { spell: 4200, calm: 2000, bouts: 3 },
        },
      ],
    });
    expect(out).toContain('intermittent(roving(');
    expect(out).toContain("import { EFFECTS, intermittent, roving } from 'klieg';");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/core/test/composition-lab/emit.test.ts`
Expected: FAIL — a lamp layer prints `EFFECTS.lamp({...})`, which is not a thing.

- [ ] **Step 3: Print the piece**

In `packages/core/dev/composition-lab/src/emit.ts`, replace `layerSource`:

```ts
function lampSource(layer: EffectLayer): string {
  const p = layer.params;
  const src =
    layer.lampSource === 'orbit'
      ? `orbit({ radius: ${p.sweep ?? 0.3}, x: ${p.x ?? 0}, y: ${p.y ?? 0} })`
      : `fixed(${p.x ?? 0}, ${p.y ?? 0})`;
  return `lamp({ source: ${src}, duration: ${p.duration ?? 4000}, radius: ${p.radius ?? 0.5}, strength: ${p.strength ?? 2} })`;
}

function layerSource(layer: EffectLayer): string {
  let piece: string;
  if (layer.kind === 'draft') {
    piece = `{\n        duration: 1000,\n        at(t, part) {\n${layer.source ?? ''}\n        },\n      }`;
  } else if (layer.kind === 'lamp') {
    piece = lampSource(layer);
  } else {
    // klieg exports `roving` by name but reaches the built-ins only through `EFFECTS`.
    piece = `EFFECTS.${layer.kind}({ ${args(layer.params)} })`;
  }
  if (layer.roving && layer.kind !== 'lamp') {
    piece = `roving(${piece}, { dwell: ${layer.roving.dwell}, seed: ${layer.roving.seed}, epochs: ${layer.roving.epochs} })`;
  }
  if (layer.intermittent) {
    piece = `intermittent(${piece}, { spell: ${layer.intermittent.spell}, calm: ${layer.intermittent.calm}, bouts: ${layer.intermittent.bouts} })`;
  }
  const stagger = layer.stagger === undefined ? '' : `\n      stagger: ${layer.stagger},`;
  return `    {
      piece: ${piece},
      target: { kind: '${layer.target}', by: 'index', amount: ${layer.amount} },
      seed: ${layer.seed},${stagger}
    },`;
}
```

- [ ] **Step 4: Import what it names**

Still in `emit.ts`, replace the `names` block inside `emit`:

```ts
  const names: string[] = [];
  if (live.some((l) => l.kind !== 'draft' && l.kind !== 'lamp')) names.push('EFFECTS');
  if (live.some((l) => l.kind === 'lamp' && l.lampSource !== 'orbit')) names.push('fixed');
  if (live.some((l) => l.kind === 'lamp')) names.push('lamp');
  if (live.some((l) => l.intermittent)) names.push('intermittent');
  if (live.some((l) => l.kind === 'lamp' && l.lampSource === 'orbit')) names.push('orbit');
  if (live.some((l) => l.roving && l.kind !== 'lamp')) names.push('roving');
  const imports = names.length > 0 ? `import { ${names.join(', ')} } from 'klieg';\n\n` : '';
```

The order of the pushes is the order the names print in, and biome's import sorting is not what
orders a string — the tests above pin `fixed, lamp` and `EFFECTS, intermittent, roving`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/core/test/composition-lab/emit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/dev/composition-lab/src/emit.ts \
        packages/core/test/composition-lab/emit.test.ts
git commit -m "emit a lamp layer and an intermittent wrapper"
```

---

### Task 7: The pool switch, wired

This is the fault the round leads with. `realPool()` has been exported and tested since round one
and nothing calls it: `App.tsx` builds `syntheticPool(24, 7)` unconditionally, so the preview
renders `ACRONYM` on `tubing` while every panel beneath it describes a fixed 24-run, 7-letter pool.

**Files:**
- Modify: `packages/core/dev/composition-lab/src/App.tsx`
- Modify: `packages/core/dev/composition-lab/src/Raster.tsx`

- [ ] **Step 1: Load the font once**

In `packages/core/dev/composition-lab/src/App.tsx`, replace the import block (lines 1–11):

```tsx
import { EffectFrame, planEffects } from '@core/effects/frame.js';
import type { FrameCtx, PartInfo } from '@core/effects/types.js';
import { loadFont } from '@core/text/font.js';
import type { LoadedFont } from '@core/text/font.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Composition, toFireOptions } from './composition.js';
import { fontUrl } from './font.js';
import { CHANNELS, type Channel, Plot } from './Plot.js';
import { Preview } from './Preview.js';
import { restore, save } from './persist.js';
import { poolCounts, realPool, syntheticPool } from './pool.js';
import { Rail } from './Rail.js';
import { Raster } from './Raster.js';
import { samplePass } from './sample.js';
```

- [ ] **Step 2: Build the pool from the chosen source**

Still in `App.tsx`, replace the single `parts` line (`const parts = useMemo(...)`) with:

```tsx
  const [font, setFont] = useState<LoadedFont | null>(null);

  useEffect(() => {
    let live = true;
    void loadFont(fontUrl).then((f) => {
      if (live) setFont(f);
    });
    return () => {
      live = false;
    };
  }, []);

  const synthetic = useMemo(() => syntheticPool(24, 7), []);

  /** The real pool needs a font, so it stands in as synthetic for the one frame before it loads. */
  const parts: PartInfo[] = useMemo(() => {
    if (composition.pool === 'synthetic' || !font) return synthetic;
    return realPool(composition.text, font, composition.look);
  }, [composition.pool, composition.text, composition.look, font, synthetic]);
```

- [ ] **Step 3: Tell the raster which pool it is drawing**

Still in `App.tsx`, replace the `<Raster ... />` line inside `cl-panels`:

```tsx
          <Raster
            samples={sampled.data}
            rows={rows}
            at={(elapsed % sampled.pass) / sampled.pass}
            kinds={[...new Set(composition.effects.filter((l) => l.enabled).map((l) => l.target))]}
          />
```

- [ ] **Step 4: Say that an empty pool is empty**

In `packages/core/dev/composition-lab/src/Raster.tsx`, add to `RasterProps`:

```tsx
  /** The kinds `rows` was filtered to, so an empty pool can name itself rather than draw nothing. */
  kinds: string[];
```

Then change the signature to `export function Raster({ samples, rows, at, kinds }: RasterProps) {`
and insert, as the first statement of the function body:

```tsx
  if (rows.length === 0) {
    return (
      <div className="cl-panel">
        <h2>part &times; time</h2>
        <p className="cl-warn">
          no {kinds.join(' or ') || 'addressable'} parts in this pool — only tubing and piping build
          runs
        </p>
      </div>
    );
  }
```

Hooks may not sit behind a conditional return, so move the `useRef` and the `useEffect` above it —
the effect already guards on `ref.current` and on `rows.length` through `Math.max(1, ...)`, so it
draws nothing harmlessly when there is no canvas.

- [ ] **Step 5: Verify by eye**

Run: `npm --prefix packages/core run dev:composition-lab`
With pool `real`, set the text to `HI` and the look to `tubing`.
Expected: the rail's pool counts fall, and the raster's row count falls with them.
Switch the look to `gem`.
Expected: the raster says there are no run parts, and the rail warns on the layer.
Switch pool to `synthetic`.
Expected: 24 runs and 7 bodies, whatever the text says.

- [ ] **Step 6: Commit**

```bash
git add packages/core/dev/composition-lab/src/App.tsx \
        packages/core/dev/composition-lab/src/Raster.tsx
git commit -m "sample the pool the preview renders, not a synthetic stand-in"
```

---

### Task 8: Tenure and jump, off the sampled frame

Round one measured that no intensity readout can settle `dwell`: across a 4× change the aggregates
are flat, because `unrest` sets all of that. Tenure and jump are what can.

Both derive from `PassSamples.moved`, so nothing reads `roving`'s internals.

**Files:**
- Create: `packages/core/dev/composition-lab/src/tenure.ts`
- Create: `packages/core/test/composition-lab/tenure.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/composition-lab/tenure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PassSamples } from '../../dev/composition-lab/src/sample.js';
import { tenureAndJump } from '../../dev/composition-lab/src/tenure.js';
import type { PartInfo } from '../../src/effects/types.js';

function parts(count: number): PartInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'run' as const,
    index,
    count,
    letter: { index: 0, count: 1 },
    x: index,
    y: 0,
    ink: { minX: index, maxX: index, minY: 0, maxY: 0 },
    at: index / count,
    span: 1 / count,
  }));
}

/** `moved` is the only field tenure reads; the rest of a PassSamples is filler. */
function samples(moved: boolean[][]): PassSamples {
  const width = (moved[0] as boolean[]).length;
  const grid = (fill: number) => moved.map(() => new Array<number>(width).fill(fill));
  return {
    samples: width,
    gain: grid(1),
    scale: grid(1),
    dark: grid(0),
    crawl: grid(0),
    light: grid(0),
    color: grid(-1),
    touched: moved.map((row) => row.some(Boolean)),
    moved,
  };
}

describe('tenureAndJump', () => {
  it('measures a holder’s stretch in milliseconds', () => {
    const s = samples([
      [true, true, false, false],
      [false, false, true, true],
    ]);
    const r = tenureAndJump(s, parts(2), 1000);
    expect(r.tenures).toEqual([500, 500]);
    expect(r.meanTenureMs).toBe(500);
  });

  it('counts one handover and measures how far it jumped', () => {
    const s = samples([
      [true, false],
      [false, true],
    ]);
    const r = tenureAndJump(s, parts(2), 1000);
    expect(r.handovers).toBe(1);
    expect(r.meanJumpParts).toBe(1);
    expect(r.meanJumpEm).toBeCloseTo(1);
  });

  // A layer that drives everything all the time is not a broken readout. It is the honest answer,
  // and it is the one a reader is most likely to file as a bug.
  it('reports a continuous layer as one whole-pass tenure and no jump', () => {
    const s = samples([
      [true, true, true],
      [true, true, true],
    ]);
    const r = tenureAndJump(s, parts(2), 900);
    expect(r.tenures).toEqual([900, 900]);
    expect(r.handovers).toBe(0);
    expect(r.meanJumpParts).toBe(0);
  });

  it('reports nothing rather than NaN when no layer moves anything', () => {
    const r = tenureAndJump(samples([[false, false]]), parts(1), 1000);
    expect(r.tenures).toEqual([]);
    expect(r.meanTenureMs).toBe(0);
    expect(r.handovers).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/composition-lab/tenure.test.ts`
Expected: FAIL — cannot resolve `tenure.js`.

- [ ] **Step 3: Write it**

Create `packages/core/dev/composition-lab/src/tenure.ts`:

```ts
import type { PartInfo } from '@core/effects/types.js';
import type { PassSamples } from './sample.js';

export interface TenureReport {
  /** One entry per unbroken stretch a part held the effect, in milliseconds. */
  tenures: number[];
  meanTenureMs: number;
  /** Samples where the holder set changed. */
  handovers: number;
  /** Mean distance a handover moved, by pool index and by em. */
  meanJumpParts: number;
  meanJumpEm: number;
}

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

interface Centroid {
  index: number;
  x: number;
  y: number;
}

function centroid(holders: number[], parts: readonly PartInfo[]): Centroid | null {
  if (holders.length === 0) return null;
  let index = 0;
  let x = 0;
  let y = 0;
  for (const i of holders) {
    const p = parts[i] as PartInfo;
    index += i;
    x += (p.ink.minX + p.ink.maxX) / 2;
    y += (p.ink.minY + p.ink.maxY) / 2;
  }
  const n = holders.length;
  return { index: index / n, x: x / n, y: y / n };
}

/**
 * How long a part keeps the effect, and how far it travels when it changes hands. Both read
 * `PassSamples.moved` rather than any wrapper's own arithmetic, so a hand-authored piece that
 * hands over is measured the same way `roving` is.
 */
export function tenureAndJump(
  samples: PassSamples,
  parts: readonly PartInfo[],
  duration: number,
): TenureReport {
  const perSample = duration / samples.samples;

  const tenures: number[] = [];
  for (const row of samples.moved) {
    let run = 0;
    for (const on of row) {
      if (on) run += 1;
      else if (run > 0) {
        tenures.push(run * perSample);
        run = 0;
      }
    }
    // A stretch still open at the pass end is a tenure; dropping it loses a continuous layer's only
    // one and reports it as never having held anything.
    if (run > 0) tenures.push(run * perSample);
  }

  const jumpParts: number[] = [];
  const jumpEm: number[] = [];
  let handovers = 0;
  let previousKey = '';
  let previous: Centroid | null = null;

  for (let s = 0; s < samples.samples; s++) {
    const holders: number[] = [];
    for (let p = 0; p < samples.moved.length; p++) {
      if ((samples.moved[p] as boolean[])[s]) holders.push(p);
    }
    const key = holders.join(',');
    if (key === previousKey) continue;
    const here = centroid(holders, parts);
    if (previous && here) {
      handovers += 1;
      jumpParts.push(Math.abs(here.index - previous.index));
      jumpEm.push(Math.hypot(here.x - previous.x, here.y - previous.y));
    }
    previousKey = key;
    if (here) previous = here;
  }

  return {
    tenures,
    meanTenureMs: mean(tenures),
    handovers,
    meanJumpParts: mean(jumpParts),
    meanJumpEm: mean(jumpEm),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/core/test/composition-lab/tenure.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/dev/composition-lab/src/tenure.ts \
        packages/core/test/composition-lab/tenure.test.ts
git commit -m "measure how long a part holds an effect and how far a handover jumps"
```

---

### Task 9: The tenure and jump panel

**Files:**
- Create: `packages/core/dev/composition-lab/src/Tenure.tsx`

- [ ] **Step 1: Write it**

Create `packages/core/dev/composition-lab/src/Tenure.tsx`:

```tsx
import type { PartInfo } from '@core/effects/types.js';
import { useMemo } from 'react';
import type { PassSamples } from './sample.js';
import { tenureAndJump } from './tenure.js';

export interface TenureProps {
  samples: PassSamples;
  parts: readonly PartInfo[];
  /** The pass the samples span, in milliseconds. */
  pass: number;
}

export function Tenure({ samples, parts, pass }: TenureProps) {
  const r = useMemo(() => tenureAndJump(samples, parts, pass), [samples, parts, pass]);

  return (
    <div className="cl-panel">
      <h2>tenure &amp; jump</h2>
      <div className="cl-row">
        <span>tenure</span>
        <output>{(r.meanTenureMs / 1000).toFixed(2)}s</output>
      </div>
      <div className="cl-row">
        <span>handovers</span>
        <output>{r.handovers}</output>
      </div>
      <div className="cl-row">
        <span>jump</span>
        <output>{r.meanJumpParts.toFixed(1)}</output>
      </div>
      <div className="cl-row">
        <span>jump em</span>
        <output>{r.meanJumpEm.toFixed(2)}</output>
      </div>
      {r.handovers === 0 && r.tenures.length > 0 ? (
        <p className="cl-note">
          no handovers: every holder keeps the effect for the whole pass, which is what a layer
          without a roving wrapper does
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

It is mounted in Task 12, with the rest of the deck.

```bash
git add packages/core/dev/composition-lab/src/Tenure.tsx
git commit -m "read tenure and jump out beside the raster"
```

---

### Task 10: The swatch grid

The raster answers *when*. This answers *where* — which is the only place a lamp's pool has a
legible shape at all, since a lamp reads as one flat line on every channel plot.

**Files:**
- Create: `packages/core/dev/composition-lab/src/Swatch.tsx`

- [ ] **Step 1: Write it**

Create `packages/core/dev/composition-lab/src/Swatch.tsx`:

```tsx
import type { PartInfo } from '@core/effects/types.js';
import { useEffect, useRef } from 'react';
import type { Channel } from './Plot.js';
import type { PassSamples } from './sample.js';

export interface SwatchProps {
  samples: PassSamples;
  parts: readonly PartInfo[];
  channel: Channel;
  /** 0..1 within the pass. */
  at: number;
}

/** Multiplicative channels rest at 1, so their interesting direction is downward. */
const RESTS_AT_ONE = new Set<Channel>(['gain', 'scale']);

/**
 * One cell per part at its ink centre in em space, tinted by the channel at the playhead. Parts
 * overlap: every run of a letter reports that letter's ink box, so a tube look draws many cells on
 * one letter and the brightest wins.
 */
export function Swatch({ samples, parts, channel, at }: SwatchProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 600;
    const h = 150;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);
    if (parts.length === 0) return;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of parts) {
      minX = Math.min(minX, p.ink.minX);
      maxX = Math.max(maxX, p.ink.maxX);
      minY = Math.min(minY, p.ink.minY);
      maxY = Math.max(maxY, p.ink.maxY);
    }
    // A single-line sign has real height but a collapsed pool would divide by zero.
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);

    const column = Math.min(samples.samples - 1, Math.max(0, Math.round(at * samples.samples)));
    const rest = RESTS_AT_ONE.has(channel) ? 1 : 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as PartInfo;
      const row = samples[channel === 'color' ? 'gain' : channel][i];
      if (!row) continue;
      const value = row[column] as number;
      const amount = Math.min(1, Math.abs(value - rest));
      const cx = (((p.ink.minX + p.ink.maxX) / 2 - minX) / spanX) * (w - 20) + 10;
      const cy = h - 10 - (((p.ink.minY + p.ink.maxY) / 2 - minY) / spanY) * (h - 20);
      g.fillStyle =
        amount < 0.002
          ? 'rgba(126,136,150,0.25)'
          : `rgba(255,${Math.round(179 - amount * 110)},${Math.round(71 - amount * 40)},${0.25 + amount * 0.75})`;
      g.beginPath();
      g.arc(cx, cy, p.kind === 'body' ? 7 : 4, 0, Math.PI * 2);
      g.fill();
    }
  }, [samples, parts, channel, at]);

  return (
    <div className="cl-panel">
      <h2>
        swatch <span className="cl-note">{channel} at the playhead, in em</span>
      </h2>
      <canvas ref={ref} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

Mounted in Task 12.

```bash
git add packages/core/dev/composition-lab/src/Swatch.tsx
git commit -m "draw each part's offset at its own place in the word"
```

---

### Task 11: The param sweep

The round-one finding this exists to reproduce: `dwell` across 1600 / 3200 / 6400 gave dark share
19.9% / 19.9% / 20.3%. A column that does not move is the result, so the sweep marks it rather than
leaving a reader to eyeball three near-identical numbers.

**Files:**
- Create: `packages/core/dev/composition-lab/src/sweep.ts`
- Create: `packages/core/test/composition-lab/sweep.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/composition-lab/sweep.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Composition } from '../../dev/composition-lab/src/composition.js';
import { syntheticPool } from '../../dev/composition-lab/src/pool.js';
import { runSweep } from '../../dev/composition-lab/src/sweep.js';
import { NO_CTX } from '../effects/ctx.js';

const PARTS = syntheticPool(8, 3);

function composition(params: Record<string, number>): Composition {
  return {
    text: 'HI',
    look: 'tubing',
    hold: 6000,
    enter: 'slam',
    active: 'none',
    exit: 'none',
    pool: 'synthetic',
    effects: [
      {
        id: 'a',
        kind: 'flicker',
        enabled: true,
        params: { duration: 1000, depth: 0, unrest: 0.2, spell: 0, calm: 0, ...params },
        target: 'run',
        amount: 1,
        seed: 0,
      },
    ],
  };
}

describe('runSweep', () => {
  it('walks min to max inclusive, one row per step', () => {
    const r = runSweep(composition({}), 'a', 'unrest', 0.1, 0.5, 5, PARTS, 60, NO_CTX);
    expect(r.rows).toHaveLength(5);
    expect(r.rows[0]?.value).toBeCloseTo(0.1);
    expect(r.rows[2]?.value).toBeCloseTo(0.3);
    expect(r.rows[4]?.value).toBeCloseTo(0.5);
  });

  it('moves dark share with unrest, which is the knob that sets it', () => {
    const r = runSweep(composition({}), 'a', 'unrest', 0.05, 0.6, 4, PARTS, 120, NO_CTX);
    const first = r.rows[0]?.darkShare as number;
    const last = r.rows[3]?.darkShare as number;
    expect(last).toBeGreaterThan(first);
    expect(r.flat).not.toContain('darkShare');
  });

  // The finding the panel exists to reproduce: a column that does not move IS the answer, and has
  // to be marked rather than left as three numbers a reader has to compare by eye.
  it('marks a column flat when the param does not reach it', () => {
    const r = runSweep(composition({}), 'a', 'unrest', 0.2, 0.4, 3, PARTS, 60, NO_CTX);
    expect(r.flat).toContain('meanLight');
  });

  it('returns no rows for a layer id that is not in the composition', () => {
    expect(runSweep(composition({}), 'nope', 'unrest', 0, 1, 3, PARTS, 60, NO_CTX).rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/test/composition-lab/sweep.test.ts`
Expected: FAIL — cannot resolve `sweep.js`.

- [ ] **Step 3: Write it**

Create `packages/core/dev/composition-lab/src/sweep.ts`:

```ts
import { EffectFrame, planEffects } from '@core/effects/frame.js';
import type { FrameCtx, PartInfo } from '@core/effects/types.js';
import { type Composition, toFireOptions } from './composition.js';
import { type PassSamples, samplePass } from './sample.js';
import { tenureAndJump } from './tenure.js';

/** Below this a part reads as dropped rather than dimmed. Gain rests at 1. */
const DARK_GAIN = 0.5;

/** A column whose spread is under this share of its own mean is reported as flat, not as a trend. */
const FLAT = 0.01;

export interface SweepRow {
  value: number;
  /** Share of all part-sample cells sitting below `DARK_GAIN`. */
  darkShare: number;
  /** Longest stretch with no part dark, in milliseconds. */
  longestLitMs: number;
  /** Share of parts some layer ever moved. */
  coverage: number;
  meanTenureMs: number;
  meanJumpParts: number;
  meanLight: number;
}

export type SweepMetric = Exclude<keyof SweepRow, 'value'>;

const METRICS: SweepMetric[] = [
  'darkShare',
  'longestLitMs',
  'coverage',
  'meanTenureMs',
  'meanJumpParts',
  'meanLight',
];

export interface SweepResult {
  param: string;
  rows: SweepRow[];
  /** Metrics the sweep never moved. This is a finding, not a failure. */
  flat: SweepMetric[];
}

function aggregate(
  value: number,
  s: PassSamples,
  parts: readonly PartInfo[],
  pass: number,
): SweepRow {
  let dark = 0;
  let light = 0;
  let cells = 0;
  for (const row of s.gain) {
    for (const g of row) {
      if (g < DARK_GAIN) dark += 1;
      cells += 1;
    }
  }
  for (const row of s.light) for (const v of row) light += v;

  let longest = 0;
  let run = 0;
  for (let c = 0; c < s.samples; c++) {
    let anyDark = false;
    for (const row of s.gain) {
      if ((row[c] as number) < DARK_GAIN) {
        anyDark = true;
        break;
      }
    }
    if (anyDark) run = 0;
    else {
      run += 1;
      longest = Math.max(longest, run);
    }
  }

  const t = tenureAndJump(s, parts, pass);
  return {
    value,
    darkShare: cells === 0 ? 0 : dark / cells,
    longestLitMs: (longest / s.samples) * pass,
    coverage: parts.length === 0 ? 0 : s.touched.filter(Boolean).length / parts.length,
    meanTenureMs: t.meanTenureMs,
    meanJumpParts: t.meanJumpParts,
    meanLight: cells === 0 ? 0 : light / cells,
  };
}

/**
 * Resamples the whole pass once per value of one param. Every row rebuilds the `EffectFrame` from
 * `toFireOptions`, so a sweep measures the composition the preview would render rather than a
 * shortcut through the piece alone.
 */
export function runSweep(
  composition: Composition,
  layerId: string,
  param: string,
  min: number,
  max: number,
  steps: number,
  parts: readonly PartInfo[],
  samples: number,
  ctx: FrameCtx,
): SweepResult {
  const rows: SweepRow[] = [];
  if (!composition.effects.some((l) => l.id === layerId) || steps < 1) {
    return { param, rows, flat: [] };
  }

  for (let i = 0; i < steps; i++) {
    const value = steps === 1 ? min : min + ((max - min) * i) / (steps - 1);
    const at: Composition = {
      ...composition,
      effects: composition.effects.map((l) =>
        l.id === layerId ? { ...l, params: { ...l.params, [param]: value } } : l,
      ),
    };
    const specs = toFireOptions(at).effects ?? [];
    const pass = Math.max(1, ...specs.map((s) => (s.piece as { duration: number }).duration));
    const frame = new EffectFrame(planEffects(specs, parts));
    rows.push(aggregate(value, samplePass(frame, parts, pass, samples, ctx), parts, pass));
  }

  const flat = METRICS.filter((m) => {
    const values = rows.map((r) => r[m]);
    const spread = Math.max(...values) - Math.min(...values);
    const scale = Math.abs(values.reduce((a, b) => a + b, 0) / values.length);
    return spread <= Math.max(scale * FLAT, 1e-9);
  });

  return { param, rows, flat };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/core/test/composition-lab/sweep.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/dev/composition-lab/src/sweep.ts \
        packages/core/test/composition-lab/sweep.test.ts
git commit -m "sweep one param and tabulate what moves, and what does not"
```

---

### Task 12: The sweep panel, and the two-column deck

**Files:**
- Create: `packages/core/dev/composition-lab/src/Sweep.tsx`
- Modify: `packages/core/dev/composition-lab/src/App.tsx`
- Modify: `packages/core/dev/composition-lab/src/styles.css`

- [ ] **Step 1: Write the panel**

Create `packages/core/dev/composition-lab/src/Sweep.tsx`:

```tsx
import type { FrameCtx, PartInfo } from '@core/effects/types.js';
import { useState } from 'react';
import type { Composition } from './composition.js';
import { PARAMS } from './pieces.js';
import { type SweepResult, runSweep } from './sweep.js';

export interface SweepPanelProps {
  composition: Composition;
  parts: readonly PartInfo[];
  ctx: FrameCtx;
}

const COLUMNS = [
  ['darkShare', 'dark'],
  ['longestLitMs', 'lit ms'],
  ['coverage', 'cover'],
  ['meanTenureMs', 'tenure'],
  ['meanJumpParts', 'jump'],
  ['meanLight', 'light'],
] as const;

/** On demand rather than live: a run rebuilds the frame once per step, which a slider drag would
 * do on every pointermove. */
export function Sweep({ composition, parts, ctx }: SweepPanelProps) {
  const layers = composition.effects.filter((l) => l.kind !== 'draft');
  const [layerId, setLayerId] = useState('');
  const [param, setParam] = useState('');
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(1);
  const [steps, setSteps] = useState(5);
  const [result, setResult] = useState<SweepResult | null>(null);

  const layer = layers.find((l) => l.id === layerId) ?? layers[0];
  const params = layer && layer.kind !== 'draft' ? PARAMS[layer.kind] : [];

  return (
    <div className="cl-panel">
      <h2>param sweep</h2>
      <div className="cl-row">
        <select value={layer?.id ?? ''} onChange={(e) => setLayerId(e.target.value)}>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.kind}
            </option>
          ))}
        </select>
        <select value={param} onChange={(e) => setParam(e.target.value)}>
          <option value="">param…</option>
          {params.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key}
            </option>
          ))}
        </select>
      </div>
      <div className="cl-row">
        <span>min</span>
        <input type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} />
        <span>max</span>
        <input type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} />
        <span>steps</span>
        <input type="number" value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
      </div>
      <div className="cl-row">
        <button
          type="button"
          disabled={!layer || !param}
          onClick={() =>
            layer &&
            setResult(runSweep(composition, layer.id, param, min, max, steps, parts, 600, ctx))
          }
        >
          run
        </button>
      </div>
      {result ? (
        <table className="cl-table">
          <thead>
            <tr>
              <th>{result.param}</th>
              {COLUMNS.map(([key, label]) => (
                <th key={key} className={result.flat.includes(key) ? 'cl-flat' : undefined}>
                  {label}
                  {result.flat.includes(key) ? ' ·' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.value}>
                <td>{row.value.toFixed(3)}</td>
                {COLUMNS.map(([key]) => (
                  <td key={key}>{row[key].toFixed(3)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {result && result.flat.length > 0 ? (
        <p className="cl-note">
          · marks a column this sweep never moved — which is a finding about the param, not a
          missing measurement
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Lay the deck out**

In `packages/core/dev/composition-lab/src/styles.css`, change `.cl-preview-host`'s height from
`320px` to `240px`, and append:

```css
.cl-deck {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: start;
}

.cl-span2 {
  grid-column: 1 / -1;
}

.cl-table {
  width: 100%;
  border-collapse: collapse;
  font: inherit;
}

.cl-table th,
.cl-table td {
  text-align: right;
  padding: 2px 4px;
  border-bottom: 1px solid var(--cl-edge);
}

.cl-table th {
  color: var(--cl-dim);
  font-weight: 500;
}

.cl-flat {
  color: var(--cl-hot);
}
```

- [ ] **Step 3: Mount the three panels**

In `packages/core/dev/composition-lab/src/App.tsx`, add to the import block:

```tsx
import { Sweep } from './Sweep.js';
import { Swatch } from './Swatch.js';
import { Tenure } from './Tenure.js';
```

`CTX` on line 17 still carries "A pointer panel replaces this when `lamp` arrives", which is now
wrong in both directions — `lamp` has arrived and no panel replaces it. Replace that comment:

```tsx
/** The lab's own frame context. No cursor: `pointerFrame` needs a placed word that only the
 * running fire has, so the lamp sources on offer are the two that ignore it. */
const CTX: FrameCtx = { pointer: null, pointerInWord: null, dt: 16.7 };
```

Then replace the whole `<section className="cl-panels">…</section>` with:

```tsx
        <section className="cl-deck">
          <div className="cl-span2">
            <Raster
              samples={sampled.data}
              rows={rows}
              at={(elapsed % sampled.pass) / sampled.pass}
              kinds={[...new Set(composition.effects.filter((l) => l.enabled).map((l) => l.target))]}
            />
          </div>
          <div className="cl-span2 cl-row">
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={Math.max(0, rows.length - 1)}
              step={1}
              value={row}
              onChange={(e) => setFocus(Number(e.target.value))}
            />
            <output>{label}</output>
          </div>
          <Plot
            samples={sampled.data}
            channel={channel}
            part={rows[row] ?? 0}
            label={label}
            at={(elapsed % sampled.pass) / sampled.pass}
          />
          <Swatch
            samples={sampled.data}
            parts={parts}
            channel={channel}
            at={(elapsed % sampled.pass) / sampled.pass}
          />
          <Tenure samples={sampled.data} parts={parts} pass={sampled.pass} />
          <Sweep composition={composition} parts={parts} ctx={CTX} />
        </section>
```

- [ ] **Step 4: Verify by eye**

Run: `npm --prefix packages/core run dev:composition-lab`
Add a `flicker` layer with a `roving` wrapper. Expected: tenure near the dwell, handovers above 0.
Add a `lamp` layer on `body`, pick `light` as the channel. Expected: the swatch grid shows a bright
pool that moves when you drag `x`.
In the sweep panel pick the flicker layer, `unrest`, 0.05 to 0.6, 5 steps, and run.
Expected: `dark` climbs down the column, and `light` is marked flat.

- [ ] **Step 5: Run the whole check**

Run: `npm run check`
Expected: clean — typecheck, biome and 1494+ tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/dev/composition-lab/src/Sweep.tsx \
        packages/core/dev/composition-lab/src/App.tsx \
        packages/core/dev/composition-lab/src/styles.css
git commit -m "lay the composition lab's panels out as a deck, and add the sweep"
```

---

### Task 13: Record what this round changed

**Files:**
- Modify: `docs/superpowers/HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-08-27-composition-lab.md`

- [ ] **Step 1: Correct the stale state**

`HANDOFF.md`'s `## State` section opens with "**0.8.0 is published and is `latest`**" and
"**`main` is pushed and clean at `9e0ecd8`**". Both predate two releases. Replace those two claims
with what `packages/core/package.json` and `git log` actually say at the time you write it, and
give the test counts from the `npm run check` you just ran rather than carrying these forward.

- [ ] **Step 2: Record the round in the composition lab entry**

In `HANDOFF.md`, in the paragraph beginning "**The composition lab is built and on `main`.**",
replace the sentence naming what the plan deferred with what is now true: the real pool source is
wired and defaults to real; the roster carries `lamp` and `intermittent`; the swatch grid, the
tenure/jump readout and the param sweep are built; timeline lanes and the draft editing pane are
still deferred.

Add the two constraints a reader will otherwise rediscover: `roving` cannot carry a `lamp`, because
it substitutes an index and leaves `x`/`y` alone; and the lab offers no `fromPointer` lamp, because
`pointerFrame` needs a `PlacedWord` that only the running fire has.

- [ ] **Step 3: Close the first plan's deferral list**

In `docs/superpowers/plans/2026-08-27-composition-lab.md`, in the `## Self-review` section, mark
the swatch grid, tenure/jump readout and sweep as built in the round-two plan, and link it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/HANDOFF.md docs/superpowers/plans/2026-08-27-composition-lab.md
git commit -m "record the composition lab's second round, and correct two stale state claims"
```

---

## Self-review

**Spec coverage.** The pool switch — Task 7, with the model field in Task 4 and the control in
Task 5. The roster refresh — `lamp` in Task 3, `intermittent` in Task 4, both surfaced in Task 5 and
emitted in Task 6. `light` as a channel — Task 1 samples it, Task 2 plots it. No pointer surface —
Task 3 offers only `fixed` and `orbit`, and no task builds one. The two wrapper constraints —
Task 4 enforces them, Task 5 explains them in the UI. Swatch grid — Task 10. Tenure and jump —
Tasks 8 and 9. Param sweep — Tasks 11 and 12. Layout — Task 12. Testing — Tasks 1, 3, 4, 6, 8, 11.
Deferred again — no task, correctly.

**Types.** `PassSamples` gains `light` and `moved` in Task 1 and is consumed under those names in
Tasks 2, 8, 10 and 11. `BuildOptions` is defined in Task 3 and used in Task 4. `LampSourceKind` is
defined in Task 3 and used in Tasks 4, 5 and 6. `IntermittentWrap` and `PoolSource` are defined in
Task 4 and used in Task 5. `TenureReport` is defined in Task 8 and used in Tasks 9 and 11.
`SweepResult`/`SweepMetric` are defined in Task 11 and used in Task 12.

**Known risks.** Task 7 changes what every panel describes, so a saved composition from before this
round loads with `pool` defaulting to `'real'` through `persist.ts`'s spread over
`DEFAULT_COMPOSITION` — the counts will move on first load, which is correct rather than a
regression. Task 11's sweep holds `steps` × 600 resolves on the main thread; at the default 5 steps
on a 24-part pool that is 3,000 calls and imperceptible, but a 50-step sweep on a 200-part pool will
block. If it does, the fix is to yield between rows, not to cut the sample count — the rows have to
stay comparable with the live panels.
