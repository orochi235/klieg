# Effects pipeline — design

**For:** whoever implements it. **Answers:** how a klieg effect drives appearance over time below the
level of a letter, what an effect can address, and what has to be fixed before any of it works.

Today a look is static. A run's colour, a chunk's brightness and a letter's emissive are decided once
at build time; the only thing that changes per frame is the pose, which moves letters and nothing
else. The immediate want is a neon sign with one bad tube — one length of glass flickering on its own
timing — but a flag for that idea buys only that idea. This makes appearance addressable and
animatable, once, for every decoration kind.

## The part model

A word is made of **parts**. A part is the smallest thing an effect can address, and each decoration
kind contributes its own:

| kind | one part is | what it already is in the scene |
|---|---|---|
| `run` | a length of tube between cuts | its own `THREE.Mesh`, child of the letter group |
| `chunk` | one sequin, flake or glitter chunk | one instance in an `InstancedMesh` |
| `body` | the extruded letter itself | its own `THREE.Mesh`, sibling of the runs |

`body` is a part kind because it is the only thing `neon`, `gold`, `chrome`, `gem` and `velvet` have —
without it, effects reach the decorated looks and the sign that started this cannot flicker. It needs
no special case: `word.ts:296` builds the letter as a `Group` and adds the body as a child, so a body
mesh is structurally a sibling of a run mesh. Motion drives the group, effects drive the children, and
they compose through the scene graph in either order.

Every part is described the same way, mirroring `LetterInfo` one level down:

```ts
interface PartInfo {
  kind: PartKind;
  /** Position in the word's pool of parts of this kind. Stable across frames. */
  index: number;
  count: number;
  /** The letter this part belongs to, so a piece can order by letter as well as by part. */
  letter: LetterInfo;
  /** Layout position in em, relative to the block centre. */
  x: number;
  y: number;
  /** Fraction of the pool's extent lying before this part, and this part's share of it. */
  at: number;
  span: number;
}
```

The pool is word-wide, not per letter: `{ amount: 1 }` is one bad tube in the sign rather than one per
letter. `at` and `span` are not new work for runs — `buildTubeBlueprint` already computes exactly this
into `spans` to drive the `letter` gradient domain.

## The grammar

Deliberately the same shape as `MotionPiece`, so the repo has one compositional vocabulary rather than
two:

```ts
interface EffectPiece {
  /** Milliseconds for one pass. Loops. */
  duration: number;
  /** `t` is normalized 0..1 within this pass. */
  at(t: number, part: PartInfo): PartOffset;
}

/** Partial, like PoseOffset: a piece writes only the channels it drives. */
interface PartOffset {
  gain?: number;                     // multiplies emissive
  color?: number;
  dark?: number;                     // 0..1 toward a tube decoration's `dark` material
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  crawl?: number;                    // shifts the colour ramp along the part
}
```

Composition is an array, as `Slot` already is for motion, and the merge follows the existing
compositor's rule: `gain` and `scale` multiply toward 1, `position`, `rotation` and `crawl` sum,
`dark` takes the max, `color` is last-writer-wins. A part ignores channels its kind cannot carry — a
chunk has no `dark`, and `crawl` needs a ramp.

`crawl` is nearly free because the parameter it shifts already exists. `gradientT` is a per-vertex arc
length, and on the `letter` domain it already runs continuously across a glyph's runs in draw order,
so a crawl is one uniform added before the ramp lookup and it chases through the whole letter rather
than restarting at every cut.

**`stagger` generalizes rather than being duplicated.** `orderKey` and `stagger` in `motion/types.ts`
take a `LetterInfo` but only read `index`, `count`, `column`, `line`, `lineCount` and `columnCount`.
Widen them to a minimal ordering interface that both `LetterInfo` and `PartInfo` satisfy, and a per-
part phase spread is the same `from: 'start' | 'end' | 'center' | 'edges' | 'random'` grammar a
reader already knows.

## Authoring

```ts
interface EffectSpec {
  piece: EffectName;
  /** Which parts, out of the word's pool of that kind. The `assign` selection grammar. */
  target: { kind: PartKind } & SelectSpec;
  /** Per-part phase spread. */
  stagger?: number | StaggerSpec;
  /** Fixes the selection so a pinned frame is reproducible. Defaults to 0. */
  seed?: number;
  // piece parameters, discriminated on `piece`
}
```

A look declares `effects`; `fire(text, { effects })` **replaces** that list rather than appending, so
there is one place to look when a sign misbehaves. `EFFECT_NAMES` exports the piece names for a
picker, matching `ENTER_NAMES` and the rest.

## Frame ownership, which has to be fixed first

`spec.opacity` works: `Word` reads it into `bodyOpacity` and multiplies it into a per-frame write
(`word.ts:139`, `word.ts:533`). What fails is the other door — `applyLook` writes every `PARAM_KEYS`
property onto the material once at build time, and `apply()` then reassigns opacity every tick from
its own two factors, so a look setting opacity through `LookKey` is erased before it is seen. The
comment at `looks.ts:26` warns against the broken door instead of closing it.

Every channel an effect drives has this problem waiting. `emissiveIntensity` is the channel `gain`
needs and is not frame-owned today, so an effect writing it would work now and break silently the day
anything else writes it per frame — which is how the opacity trap was born.

The fix is not to take these properties away from looks — `neon` and `tubing` both declare
`emissiveIntensity`, and a look declaring its own base is correct. The fix is to stop `applyLook`
writing them, and let `Word` compose them:

```ts
/** Written every tick by Word from base × pose × effects, so applyLook must not write them. */
type FrameOwned = 'opacity' | 'emissiveIntensity';
type AppliedKey = Exclude<LookKey, FrameOwned>;
```

`applyLook` loops `AppliedKey` instead of every `PARAM_KEYS` entry; a look still declares the value,
`resolveParams` still clamps it, and `Word` reads it as the base for a per-frame write:

```ts
material.opacity = pose.opacity * base.opacity;
material.emissiveIntensity = base.emissiveIntensity * effect.gain;
```

`Word` already keeps `bodyOpacity`, `decorOpacity` and `darkOpacity` this way; this generalizes what
it does for one property to the set. `Word` stays the sole writer, so no second clobberer appears.

The payoff is that the broken door becomes a working one. `opacity` can now be added to `LookKey`
legally — it would be routed to frame ownership like any other member of the set — so the warning at
`looks.ts:26` is deleted rather than re-worded. The rule the rest of this design rests on: **a channel
an effect drives must be frame-owned, and a frame-owned property is written by `Word` alone.**

## Order of work

Each step has its own guard, checked at that step rather than only at the end.

1. **Frame ownership.** The `FrameOwned` split and the widened `emissiveIntensity` write, with the
   effect factor pinned at 1. No behaviour change; the look snapshots are the guard.
2. **The part model.** Assemble the word-wide pool and give each part a write path. No new materials
   are needed: a run's geometry already carries its own `runColor` attribute (`sweep.ts:170`) and
   `tintByRunColor` drives the emissive from it, so `gain` and `color` are one small attribute
   rewrite; `dark` swaps the mesh's material between the two that already exist; transform is the
   mesh's own. A body has its own material per letter, so it takes `gain` through
   `emissiveIntensity` instead. Material count, draw calls and programs are unchanged. Still no
   behaviour change; same guard.
3. **The grammar, for `run` and `body`.** `EffectPiece`, the compositor, the generalized `stagger`,
   and a first set of pieces. `flicker` is what the ask needs; `chase`, `buzz` and `warmup` are the
   seed of the list, not a closed one.
4. **`chunk` parts.** Per-instance writes: `setMatrixAt` for transform, `instanceColor` for colour.
   Different write path, same grammar.
5. **`crawl`.** The ramp-offset uniform, and the per-part phase that rides it.

## Acceptance

- Every shipped look renders byte-identical with no effects declared — `apps/lab/test/looks.spec.ts`,
  checked after step 1, after step 2, and again at the end.
- Step 2 adds no material, no draw call and no compiled program: assert the counts against a word
  built before it.
- `applyLook` cannot write a frame-owned property — asserted by a type test on `AppliedKey`, not by
  review. `neon` and `tubing` still render at the `emissiveIntensity` they declare, which is the claim
  that moving the write moved no pixels.
- With a pinned clock, a frame mid-flicker is reproducible across runs, so an effect can hold a visual
  baseline of its own.
- An effect targeting nothing, and a look with no effects, cost no per-frame writes.
- `npm run check` and `npx playwright test` stay green.

## Traps

**A frame-owned property written from a closed set of factors is the bug this design exists to stop.**
Widening the set is the fix; adding a second writer outside `Word` reproduces it one channel over.

**`fire()` replacing rather than appending is load-bearing.** A caller expecting to add one effect and
silently dropping the look's own is a support question that looks like a rendering bug.

**A run's index is not stable across a spec change.** The cut moves with path source, spacing and
letter, so an effect targeting explicit indices retargets silently. `SelectSpec` with a fixed `seed`
is the addressable form; explicit indices are not offered.

**Chunks are an `InstancedMesh`, so a per-chunk write is a buffer update, not a property set.** A
selection that targets most of 520 chunks per letter is a different cost class from one that targets
three, and only targeted parts should be written.

**An attribute write must compose from the part's base, not from what is in the buffer.** `runColor`
holds last frame's composed value, so multiplying the buffer by this frame's gain compounds and the
sign fades to black over a few seconds. Keep `run.color` as the base and write `base × gain` every
time.

**A run whose material was supplied by a debug hook has no run-colour contract.** `word.ts:311` already
skips `tintByRunColor` for an override, and an effect writing `runColor` there writes into a shader
that never reads it. Skip those parts rather than writing invisibly.

## Two limits found by asking for a roving fault

The shipped `flicker` afflicts a fixed set of runs. Asking for the bad tube to *move* from segment to
segment surfaced two structural limits, both worth knowing before designing anything on top.

**Layering composes channels on a part; it cannot gate which part.** The merge rule is multiplicative
for `gain`, so a second layered effect can push a run darker but cannot undo what the first dropped —
there is no value it can return that cancels a `gain` of 0.08. "Which part is afflicted right now" is
therefore not expressible by adding an effect to the list. It has to be a piece that wraps a piece and
delegates only to whichever part is currently it, which composes at the piece level rather than the
offset level and works for any inner piece rather than only for `flicker`.

**A piece cannot see across its own passes.** `at(t, part)` receives `t` normalized within one pass, so
anything varying on a slower clock than `duration` is structurally inexpressible. A roving affliction
is exactly that: the stutter cycles at 1400ms while the choice of tube should change far more slowly.
The ways out are a wrapper whose `duration` spans several dwells and which reconstructs the inner
piece's phase, or handing `at` the raw elapsed alongside `t`. Re-running selection periodically is the
third option and the worst: "selection resolves once" is the property the regroup decision rests on.
