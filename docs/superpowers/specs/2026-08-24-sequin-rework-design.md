# Sequin rework — design

**For:** whoever works on the chunk decoration generator. **Answers:** what makes `sequin` read as
sprinkled-on rather than sewn, which three capabilities fix it, and where each one stops.

A chunk decoration scatters small meshes over a letter's surface: `buildChunkBlueprint` samples
points and normals, `chunkMatrices` places one chunk at each. That is right for a look made of
grit. `sequin` is not — a sequin is a thin disc sewn flat onto a garment, and today the generator
gives it a freely tumbling square standing a third of its own size off the surface, at randomly
scattered positions. Every quality that makes it read as a sequin is missing.

`sequin` is the only chunk look left; `pyrite` was deleted rather than respecced.

## What is already there

Thinness needs nothing: `chunkGeometry` builds a `flake` as `PlaneGeometry(1, 1)` drawn
`DoubleSide`, which is a zero-thickness quad. It is square rather than round, and it tumbles, but
it is not a nugget.

Placement gained `faceBias`, `sizeVary`, `sink` and `bedding`, and a pool that scales with `count`
and answers its nearest-neighbour query from a uniform grid rather than scanning per chunk.
`faceBias` matters most here: pure area weighting spends 59.2% of a glyph's chunks on the extrusion
band against 12.9% on the face a reader looks at, which reads as an outline rather than a treated
surface.

## Three capabilities

**`lie: number`, 0..1 — how flat a chunk lies on the surface.** Applied after `align`, slerping the
chosen rotation toward the frame built from the sample's own normal. `align` cannot express this:
it runs from free tumble to *one lattice shared across a letter*, which is a single orientation for
every chunk regardless of where it sits. The normal is already fetched at the placement site and
used only to offset by `proud`.

Spin about the normal stays random. A sewn sequin lies flat but is not rotationally aligned with
its neighbours, and pinning the spin would produce a stamped pattern.

**`shape: 'disc'`.** A `CircleGeometry` beside `'flake'` and `'cube'`. Twelve triangles against the
quad's two, which for an eight-letter word at 400 chunks a letter is ~38k triangles — not a cost
worth designing around.

The side follows `lie`, not the shape. Laying a chunk onto the *outward* normal — rather than onto
whichever side of the surface plane its tumble already leaned toward — is what makes its one face
reliably point out of the letter; at `lie` 0.7 and above no chunk on a near cap faces inward, so the
field renders `FrontSide` and the back cap culls per view. That culling is not a placement change:
turn the letter and those chunks come back, which matters because two shipped enters put the back
cap on screen. Below 0.7 a chunk is still part way through its tumble and can face inward, where
culling would delete it rather than hide it, so it stays `DoubleSide`.

Laying always outward costs half a turn for the chunks that leaned the other way, which leaves them
sitting less flat: at `lie: 0.82` the near cap's mean tilt off the surface goes from 10.7° to 16.1°.
`sequin` ships at 0.88 instead, which puts it back at 10.8°. `spikes/disc-facing.mjs` measures both.

**`BeddingSpec.pitch` and `.jitter` — regular spacing along a bed.** `bedding` already runs chunks
in bands at an angle, which is the row a sequin is sewn in; within a band placement is free, so
spacing still clumps. `pitch` puts sites at a fixed spacing along each bed, alternate beds offset by
half a pitch so rows stagger, and `jitter` is how far off its site a chunk may sit, so the field does
not read as printed.

A site is a **rejection inside the sampling loop, not a snap applied after it**. A snap of up to half
a pitch can carry a chunk over the edge of a letter, and off the glyph is not a place a sequin can be
sewn; rejecting keeps every chunk on the surface it was sampled from by construction.

Omitting `pitch` leaves bedding exactly as it behaves today, so both distributions are one
parameter rather than two code paths.

## Where the lattice stops

A bed is measured in word space, so rows run on from one letter to the next rather than restarting
at each glyph — a garment's rows do not know where a letter ends. The cost, already paid by
`bedding`, is one pool per letter instead of one shared per character.

That framing is well defined on the two caps and not on the extrusion band, which stands
perpendicular to it: a word-space grid projected onto the band smears along the extrusion. **The
lattice therefore governs cap samples only; band samples keep free placement along the bed.** The
per-triangle `facing` value that `faceBias` computes (`|cross.z| / 2·area`) separates them, so this
needs no new classification. With `faceBias` lifting the caps, that is where the chunks are.

`jitter` is a second dial on the same split, which is not obvious from its name. A stray too tight
to hit rejects cap draw after cap draw until the sampler happens to draw a band triangle, which it
accepts immediately — so tightening `jitter` does not make the lattice more exact, it **starves the
caps**. `spikes/bed-lattice.mjs` measures it: cap samples fall from 1236 at 0.5 to 51 at 0.05, while
the share of cap samples actually sitting on a site stays at 100% throughout. Read it against
`faceBias`, which pulls the other way.

## `sequin`'s own values

Re-derived, not preserved: 400 flakes at 0.045 em standing 0.35 proud become **520 discs at 0.062 em
lying at 0.08 on a lattice pitched at 0.055**, with `faceBias: 16` putting them on the faces a
reader looks at. The pitch is under the disc's own width, so each row overlaps the next the way sewn
rows do.

Two values cannot be what the look wants, and both are traps rather than taste:

**`proud` cannot be 0.** A disc lying exactly in the surface z-fights with it across its whole face.
It stands off a twelfth of an edge, which is invisible and enough.

**`lie` cannot be 1.** Discs that lie perfectly flat are parallel mirrors: every one returns the
same reflection, and the field reads as a single dull sheet rather than a garment. 0.82 is flat
enough to read as sewn and varied enough that each disc catches its own light. A look whose whole
point is glitter is destroyed by orienting its facets perfectly, which is the opposite of what the
capability seemed to promise.

`look-sequin`'s visual baseline moves, and the placement pin in `decoration.test.ts` is re-recorded
with it. Both are the deliverable, not collateral. The other 22 baselines pass untouched.

## Verification

`lie` is checked by the angle between a placed chunk's own normal and the surface normal it sat on —
at 1 it is zero for every chunk, at 0 the distribution is unchanged from today. Lattice spacing is
checked by the nearest-neighbour distance across a placed field: a pitch imposes a floor that free
placement does not have. Each check is run against a deliberately broken implementation before it is
believed, per this repo's standing practice — a test that passes with the code under it deleted
proves nothing.
