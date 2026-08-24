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

The side stays `DoubleSide`. A disc only faces reliably outward at `lie: 1`, and `FrontSide` below
that would cull chunks out of existence as they tumble. There is a real optimization at `lie: 1` —
back-cap discs would cull for free, against the 25.1% of `sequin`'s chunks that land there — but it
is conditional on a value rather than a shape, so it needs measuring before it is wired.

**`BeddingSpec.pitch` and `.jitter` — regular spacing along a bed.** `bedding` already runs chunks
in bands at an angle, which is the row a sequin is sewn in; within a band placement is free, so
spacing still clumps. `pitch` puts sites at a fixed spacing along each bed, alternate beds offset by
half a pitch so rows stagger, and `jitter` displaces each by a fraction of a pitch so the field does
not read as printed. A sampled point snaps to its nearest free site, reusing the probe-on-collision
walk the clustered draw already uses for an exhausted pool.

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

## `sequin`'s own values

Re-derived, not preserved. Its current 400 chunks at 0.045 em with no clearcoat were tuned to make
a field of tumbling nuggets read well, and none of that survives the primitive changing: a flush
disc covers differently, catches light differently, and at `proud` near zero cannot self-shadow.
Expect `align: 0`, `lie: 1`, `proud` at or near 0, `shape: 'disc'`, a bedding with a pitch, and a
count and size found against the new primitive.

`look-sequin`'s visual baseline moves, and the placement pin in `decoration.test.ts` is re-recorded
with it. Both are the deliverable, not collateral.

## Verification

`lie` is checked by the angle between a placed chunk's own normal and the surface normal it sat on —
at 1 it is zero for every chunk, at 0 the distribution is unchanged from today. Lattice spacing is
checked by the nearest-neighbour distance across a placed field: a pitch imposes a floor that free
placement does not have. Each check is run against a deliberately broken implementation before it is
believed, per this repo's standing practice — a test that passes with the code under it deleted
proves nothing.
