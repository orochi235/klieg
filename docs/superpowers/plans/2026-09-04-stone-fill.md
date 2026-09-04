# The stone fill — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**For:** an engineer who knows TypeScript and three.js but nothing about klieg.
**Answers:** what puts a stone in a cut well, and which four seams that needs.

**Goal:** a `stone` fill that occupies the wells the plate cutter leaves, and a target that can
name it.

**Architecture:** a cutter already answers well outlines and a floor; it now also answers **seats**.
A registered `Fill` turns seats into one geometry, one material and a matrix per seat, which
`WellBuilder` draws as a single `InstancedMesh` per letter and contributes as one part. A target may
name a fill instead of a part kind.

**Tech Stack:** TypeScript, three.js, vitest (unit), Playwright (visual baselines).

**Acceptance for the slice: all 41 visual baselines byte-identical.** No shipped look selects
`'well'`, so nothing on a baseline path may change. A moved pixel is a bug.

The design is [the stone fill](../specs/2026-09-04-stone-fill-design.md); read its "The seat sets
the girdle" section before Task 3. `node spikes/stone-seat.mjs` is the built prototype of Tasks 1–3
and its numbers are the ones to match: 61 seats on an `R`, 90 vertices a stone at 8 girdle facets.

---

## Three constraints that are easy to violate

**A stone's girdle width follows the height it is seated at.** The plate's bevel widens each well
toward the face, so `half + bevelSize * (1 - sink)` and `faceZ - sink * bevelThickness` are one
choice made twice. Pick them independently and the stone either floats above its collar or rattles
inside it.

**`depth` is not the front face.** `ExtrudeGeometry` carries a bevelled face `bevelThickness` past
the depth it was asked for. A stone seated at `depth` sits 0.055 em inside the letter.

**A fill's material may not inherit the look's `thickness`.** It is in world units, and `gem` ships
1.4 for a letter-sized volume. Scale it to the stone or the field renders black.

## File structure

- Create `packages/core/src/render/wells/fills.ts` — the `Seat`/`Filled`/`Fill` types and registry.
- Create `packages/core/src/render/wells/stone.ts` — the brilliant cut.
- Modify `packages/core/src/render/wells/cutters.ts` — `Cut` carries `seats`.
- Modify `packages/core/src/render/wells/plate.ts` — export the two z planes the fill needs.
- Modify `packages/core/src/render/decoration.ts` — `WellSpec.fill` and its params.
- Modify `packages/core/src/render/decorations/well.ts` — build, draw, contribute, dispose.
- Modify `packages/core/src/effects/types.ts` — `PartInfo.fill`, `EffectSpec.target` union.
- Modify `packages/core/src/effects/frame.ts` — match on kind or fill.
- Modify `packages/core/src/render/word.ts` — `partInfo` takes a fill name.
- Create `packages/core/test/render/wells/fills.test.ts`, `stone.test.ts`.

---

### Task 1: A cut reports its seats

The cutter knows each well's centre and half-diagonal and throws both away, answering only
outlines. A fill needs them, and recovering a centre by re-measuring a `Path`'s bounding box —
which the spike does — is the cutter's own arithmetic done a second time, worse.

**Files:** modify `packages/core/src/render/wells/cutters.ts`; test
`packages/core/test/render/wells/cutters.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it('reports a seat per well, at the outline it cut', () => {
  const shapes = boxShapes(1, 1);
  const cut = cutterFor('lattice')(shapes, regionOf(shapes), spec({ pitch: 0.2, size: 0.08 }));
  expect(cut.seats).toHaveLength(cut.wells.length);
  for (const [i, seat] of cut.seats.entries()) {
    const box = new THREE.Box2();
    for (const p of (cut.wells[i] as THREE.Path).getPoints(1)) box.expandByPoint(p);
    const centre = box.getCenter(new THREE.Vector2());
    expect(seat.x).toBeCloseTo(centre.x, 6);
    expect(seat.y).toBeCloseTo(centre.y, 6);
    expect(seat.half).toBeCloseTo(0.04, 6);
  }
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run packages/core/test/render/wells/cutters.test.ts`. Expected: `cut.seats is undefined`.
- [ ] **Step 3:** Add `seats: Seat[]` to `Cut` and push `{ x, y, half }` beside each outline in `lattice`. The values are already in scope; nothing is recomputed.
- [ ] **Step 4:** `npm test`, `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "report a seat beside every well a cutter places"`

---

### Task 2: The fill seam

Mirrors `cutters.ts` exactly, so there is one shape to learn for both halves of the pipeline.

**Files:** create `packages/core/src/render/wells/fills.ts`; test
`packages/core/test/render/wells/fills.test.ts`.

- [ ] **Step 1: Write the failing test** — a registered fill is returned by name; an unregistered
  one throws naming what was asked for, as `cutterFor` does.

```ts
it('refuses a fill nobody registered, naming it', () => {
  expect(() => fillFor('glitter')).toThrow("no well fill registered for 'glitter'");
});
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3:** Define `Seat`, `Filled` and `Fill` as in the design, plus `registerFill` /
  `fillFor` over a `Map`. `Filled` carries `geometry`, `matrices` and `material`.
- [ ] **Step 4:** `npm test`, `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "register a fill the way a cutter is registered"`

---

### Task 3: The brilliant cut

**Files:** create `packages/core/src/render/wells/stone.ts`; modify
`packages/core/src/render/wells/plate.ts`; test `packages/core/test/render/wells/stone.test.ts`.

`plate.ts` computes the slab depth and the two bevel thicknesses and keeps them local. Export
`platePlanes(depth, floor, bezel): { faceZ, floorZ }` and have `buildPlate` use it, so the fill and
the plate cannot disagree about where the front face is.

- [ ] **Step 1: Write the failing tests**

```ts
it('seats the girdle in the opening at the height it sits at', () => {
  const { faceZ } = platePlanes(0.3, 0.09, 0.012);
  const [geo] = [stone([seat], { sink: 0.25, tint: 0.5, facets: 8 })];
  geo.geometry.computeBoundingBox();
  const box = geo.geometry.boundingBox as THREE.Box3;
  // Widest at the girdle, which sits a quarter of the way down the plate's bevel.
  expect(box.max.x).toBeCloseTo(0.024 + 0.038 * 0.75, 5);
  expect(box.max.z).toBeGreaterThan(faceZ); // the crown stands proud of the letter
});

it('scales transmission thickness to the stone, not to the look', () => {
  const filled = stone([seat], { sink: 0.25, tint: 0.5, facets: 8 });
  // The look's own 1.4 em is tuned for a letter-sized volume and renders a stone black.
  expect(filled.material.thickness).toBeCloseTo(0.5 * 2 * (0.024 + 0.038 * 0.75), 5);
});

it('costs 90 vertices at eight girdle facets, whatever the seat count', () => {
  expect(stone([seat], opts).geometry.getAttribute('position').count).toBe(90);
  expect(stone([seat, seat, seat], opts).matrices).toHaveLength(3);
});
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3:** Port `brilliant()` from `spikes/stone-seat.mjs` — table, crown, girdle, pavilion,
  non-indexed and flat-shaded. Build the material from the fill's look via the existing
  `createMaterial` / `applyLook`, then overwrite `thickness`. One matrix per seat, translation only.
- [ ] **Step 4:** `npm test`, `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "cut a brilliant and seat it at its girdle"`

---

### Task 4: `WellSpec` carries a fill

**Files:** modify `packages/core/src/render/decoration.ts`.

- [ ] **Step 1:** Add to `WellSpec`:

```ts
  /** Which registered fill occupies the wells. Omitted leaves them empty, as today. */
  fill?: 'stone';
  /** How far down the well's bevel the girdle sits, 0 at the letter's face. */
  sink?: number;
  /** Transmission thickness as a fraction of the girdle's width — the stone's colour. */
  tint?: number;
  /** Girdle points. Four fills a diamond seat corner to corner; eight inscribes an octagon. */
  facets?: number;
  /** The stone's own look. Defaults to `gem`. */
  stone?: MaterialSpec;
```

  Optional throughout, so every existing `WellSpec` still typechecks and still cuts empty wells.

- [ ] **Step 2:** `npm run typecheck && npm run lint`.
- [ ] **Step 3: Commit** — `git commit -m "let a well spec name the fill that occupies it"`

---

### Task 5: The builder draws the stones

**Files:** modify `packages/core/src/render/decorations/well.ts`; test
`packages/core/test/render/decorations/well.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('adds one instanced draw per letter, holding every seat', () => {
  const group = new THREE.Group();
  builder.buildLetter(0, 'R', group, undefined);
  const mesh = group.children[0] as THREE.InstancedMesh;
  expect(mesh.count).toBe(cut.seats.length);
});

it('contributes one part per letter that drew stones, and none for a letter that did not', () => {
  builder.buildLetter(0, 'R', new THREE.Group(), undefined);
  builder.skipLetter(1);
  expect(builder.collectParts()).toHaveLength(1);
  expect(builder.collectParts()[0]?.info.fill).toBe('stone');
});

it('leaves the wells empty when no fill is named', () => {
  const bare = new WellBuilder({ ...spec, fill: undefined }, ctx);
  bare.buildLetter(0, 'R', group, undefined);
  expect(group.children).toHaveLength(0);
  expect(bare.collectParts()).toEqual([]);
});
```

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3:** In `buildLetter`, when `spec.fill` is set, look up the fill, call it with the
  char's seats, and add an `InstancedMesh` to `sized`. Cache the geometry and material per char
  beside `bodies` — a letter's wells cannot depend on its neighbours, so neither can its stones.
  `collectParts` answers one `DecorationPart` per built letter, `kind: 'chunk'`, `fill: spec.fill`.
  `writePart` writes colour to the shared material as `ChunksBuilder` does. `dispose()` frees the
  fill's geometries and materials — builder-owned, like `bodyGeometry`'s.

  The third test is the one that matters: the empty-well path is what every existing `well` spec
  takes, and it must keep taking it.

- [ ] **Step 4:** `npm test`, `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "seat a fill's stones in the wells a letter was cut with"`

---

### Task 6: A target may name a fill

**Files:** modify `packages/core/src/effects/types.ts`, `packages/core/src/effects/frame.ts`,
`packages/core/src/render/word.ts`; test `packages/core/test/effects/frame.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('selects by fill name, across kinds', () => {
  const parts = [part({ kind: 'chunk' }), part({ kind: 'chunk', fill: 'stone' })];
  const [plan] = planEffects([{ piece: 'hue', target: { fill: 'stone', by: 'index' } }], parts);
  expect(plan?.parts).toEqual([1]);
});

it('leaves a kind target selecting by kind, so nothing already written moves', () => {
  const parts = [part({ kind: 'chunk' }), part({ kind: 'chunk', fill: 'stone' })];
  const [plan] = planEffects([{ piece: 'hue', target: { kind: 'chunk', by: 'index' } }], parts);
  expect(plan?.parts).toEqual([0, 1]);
});
```

  The second test is the guard on the whole change: a `kind` target must not start excluding filled
  parts, or every shipped look's effects narrow silently.

- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3:** Add `fill?: string` to `PartInfo`; widen `EffectSpec.target` to
  `({ kind: PartKind } | { fill: string }) & SelectSpec`; in `planEffects` replace the filter with
  one that reads `'fill' in spec.target ? part.fill === spec.target.fill : part.kind === spec.target.kind`.
  Add a trailing `fill?: string` parameter to `Word.partInfo`.
- [ ] **Step 4:** `npm test`, `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** — `git commit -m "let an effect target a fill by name"`

---

### Task 7: Show it through the shipped path

A spike that builds geometry directly cannot show the line this slice turns on. This fires a real
`<klieg-sign>` on a look whose decoration is a filled `well`, beside the same look unfilled.

**Files:** extend `spikes/carved-sign.mjs`, which the plate cutter added for exactly this, with a
filled cell; modify `spikes/stone-seat.mjs` to drive the shipped fill rather than its
own copy of the brilliant, as `plate-stack.mjs` was pointed at the shipped cutter.

- [ ] **Step 1:** Write the spike; a filled cell that renders as bare metal means the fill is being
  asked for nothing.
- [ ] **Step 2:** Point `stone-seat.mjs` at `fillFor('stone')`; its reported numbers must not move —
  61 seats, 90 vertices a stone.
- [ ] **Step 3: The visual gate.** `npm run test:visual`. Expected: **41/41, every baseline
  byte-identical.** Nothing shipped selects `'well'`, so a moved pixel is a bug in this slice.

  Run it on an idle box. The three lighting specs are timing-sensitive — `sign.spec.ts:6` records
  why — and they fail on load average alone.

- [ ] **Step 4: Commit** — `git commit -m "show a stone-set word through the shipped path"`
