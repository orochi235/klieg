# The stone fill — design

**For:** an engineer who knows TypeScript and three.js, and has read
[the plate cutter](2026-09-03-plate-cutter-design.md). **Answers:** what puts a stone in a cut
well, and how an effect addresses one.

The plate cutter carves wells and leaves them empty. A **fill** is what sits in one. This ships
`stone` — a brilliant cut seated at its girdle — and the one targeting change a named fill needs.

`node spikes/stone-seat.mjs` is the built version of everything below: it drives the shipped
cutter and plate assembler and seats a stone in every well they leave.

## The seam

A fill is registered the way a cutter is, and for the same reason: `word.ts` used to branch on
`decoration.kind` in a dozen places, and the registry is what removed that. A cutter answers well
outlines and a floor; a fill receives those and answers geometry and a material.

```ts
/** On the cut, beside the outline it belongs to. */
export interface Seat {
  x: number;
  y: number;
  /** The well's half-diagonal, before the plate's bevel widens the opening. */
  half: number;
}

export interface Filled {
  /** One geometry for every seat on the letter, drawn as one instanced mesh. */
  geometry: THREE.BufferGeometry;
  /** Per-seat placement, in the same order as the seats. */
  matrices: THREE.Matrix4[];
  material: THREE.MeshPhysicalMaterial;
}

export type Fill = (seats: readonly Seat[], ctx: FillContext, spec: WellSpec) => Filled;
```

The two z planes reach the fill on its context rather than on each seat: a seat is *where* a well
is, and how far the front face stands above the floor belongs to the plate and is the same for
every well on the letter.

One geometry and one material for every stone on the letter, because they differ only in where
they sit — 61 seats on an `R` cost **90 vertices**, not 5,490.

**Register a fill from the module that exports the lookup, never by having the fill register
itself.** The package declares a narrow `sideEffects` list, so a module imported only for its
registration is dropped from the standalone bundle: `registerFill` never runs, the name cannot be
found, and the sign renders nothing. Every unit test still passes, because a test imports the fill
module directly. `cutters.ts` already does it the safe way, and the only thing that catches the
unsafe one is firing a real sign.

## The seat sets the girdle, and it is one number rather than two

`ExtrudeGeometry` bevels a hole *outward* toward the face, so a well's opening is `half + bevelSize`
wide at the plate's front and only `half` wide once the bevel has run out. **The girdle's width and
the height it sits at are therefore the same choice.** One knob, `sink`, moves the stone down its
own bevel: at 0 the girdle is at the letter's face and as wide as the opening gets, at 1 it is
below the collar and the stone is in a pit.

Seating below the collar is the failure worth naming, because it is what the arithmetic does if
nobody thinks about it. `depth` is not the front face — the extruder carries a bevelled face
`bevelThickness` past the depth it was asked for — so a stone placed at `depth` sits 0.055 em
*inside* the letter with its crown under the letter's own surface, and the pavé reads as a grid of
dimples. `sink` ships at **0.25**: far enough down that the plate's bevel reads as a collar coming
up around the girdle, which is what a bezel setting is.

The plate's thickness is not the stone's depth. A brilliant's pavilion is about 0.43 of its girdle
width — 0.045 em on the shipped seat — against a 0.09 em plate, so the culet floats well clear of
the floor. Nothing sees it, and a thinner plate is a change to the cutter rather than the fill.

## Transmission thickness is the stone's colour knob

`gem` ships `transmission: 1`, `attenuationColor` ruby and **`thickness: 1.4`**. Thickness is in
world units and that value is tuned for a volume the size of a letter, so a stone a twentieth of
that size absorbs almost everything: inheriting the look's own thickness renders the field as
**black holes in the plate**, which is the first thing this spike drew.

So a fill's material cannot simply be its look. The stone scales thickness to its own girdle width,
and the fraction is a knob:

| `tint` | what the stone reads as |
|---|---|
| 0.5 | ruby — the attenuation colour fully developed |
| 0.12 | champagne, the plate's gold showing through |
| 13 (the look's own 1.4 em) | black |

**It ships at 0.5.** The lesson generalizes past this fill: any look reused at a different scale has
to have its distance-carrying properties rescaled, and `thickness`, `attenuationDistance` and
`iridescenceThicknessRange` are all of them.

## Targeting names the fill; `PartKind` stays closed

An effect targets `{ kind: 'run' | 'body' | 'chunk' }`, which works only because a look has at most
one decoration. `PartInfo` gains an optional `fill`, and a target may name it instead:

```ts
target: ({ kind: PartKind } | { fill: string }) & SelectSpec;
```

Additive: every shipped look keeps `{ kind }`, and nothing already written moves.

**A stone field reports `kind: 'chunk'`.** `types.ts` already defines that kind as "a letter's whole
scattered field, not one scatterer: the field is a single instanced draw sharing one material, so it
moves and lights together or not at all" — which describes a pavé field exactly. Adding a `'stone'`
member instead would be a second way to say the same thing, and the next fill would need a third;
that is the `decoration.kind` switch growing back in the targeting layer.

This departs from the handoff, which expected the slice to open `PartKind`. The spec's own model is
the reason: it says a target becomes `{ fill: 'stones' }` and "the part kind goes back to meaning
what shape of thing it is".

**One part per letter, not per stone.** A twinkle running across individual stones is not
expressible, and would need per-instance colour on the instanced mesh plus a part per seat — a pool
of 61 parts a letter against today's one. Worth doing when a look asks; not worth paying for here.

## What this does not do

Not a second cutter: `plate` is still the only one, so wells stay diamond-shaped and single-floored.
Not a migration: `tubing`, `piping` and `sequin` stay on their current path, and re-expressing them
as fills moves visual baselines and is its own slice, last.

**Acceptance: all 41 visual baselines byte-identical.** No shipped look selects `'well'`, so nothing
on a baseline path may change.
