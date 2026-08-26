# Tube layout strategies — design

**For:** whoever implements this in `packages/core/src/render/tube/`. Assumes you know the tube
pipeline exists and sweeps a tube along a path; assumes nothing about its internals.
**Answers:** how a filled shape should decide where its tubes go, when outline-tracing is the wrong
answer, and what has to change to offer anything else.

## The problem

klieg has exactly one way to turn a shape into tubes: trace its outline. That is right for
letterforms, where the outline *is* the stroke, and wrong for a solid figure, where the outline is a
silhouette and the inside is empty.

The case that showed it: a logo mark built from three abutting rounded blobs. Outline-traced, it
renders as interlocking rings — legible as neon, but the stair-step identity is gone, because the
tube follows the boundary of a solid rather than describing the solid.

Real signs solve this several ways — a spine down the middle of each stroke, concentric rings inside
a solid, a single continuous tube with unlit carries between letters. klieg can express none of them.

## What already exists

Do not rebuild these.

| | |
|---|---|
| `buildTubeBlueprint(shapes, spec, depth, seed)` | Takes `THREE.Shape[]`. Nothing in `tube/` knows what a font is — art and glyphs enter identically. |
| `TubeSpec.level` | An isocontour level in em: negative insets, 0 rides the outline, positive stands off. Contraction is already a parameter. |
| `PathSource` | `direct` offsets each ring by a vertex normal — fast, cannot change topology. `field` builds a signed distance field (256², `tube/index.ts:90`) and runs marching squares — slower, and correct when a shape splits or a hole closes. `exact` corrects the grid against real segments. |
| `blockout`, `connectors`, `connectorOvershoot` | A corner that carries through *unlit* instead of cutting, and links between face paths. The vocabulary for one tube crossing a gap already exists. |
| `select` | Decides which runs are lit. Per run. |

Two measurements from the spike, 12 paths: `direct` 79ms, `field` 1759ms at the same contraction.
`field` is a build-time choice, not a per-frame one.

## The strategies

A strategy decides **which curves become tubes**. It is not the same question as `level`, which
moves a curve once chosen, or `runs`, which cuts a curve into lit and dark pieces.

**`outline`** — today. Every contour, at `level`. Correct for letterforms.

**`concentric`** — contours at several levels inward, spaced, stopping where the contour vanishes.
This is the Citgo sign. It needs `field`: at any real depth a solid splits into separate rings and
`direct` self-intersects instead. The machinery is written; nothing calls it at more than one level.

**`spine`** — one curve down the middle of each stroke. As contraction deepens, a stroke's two
sides collapse toward its centreline, so this is the medial axis. The distance field `field` already
builds contains it — the axis is the field's ridge — but **extracting a ridge is new code**, not a
different call into existing code. Cheapest honest version first: a deep `level` approximates a
spine well enough on strokes of even weight, which is most signage.

**`single-stroke`** — one continuous tube through the whole figure, unlit where it crosses between
strokes, the way a bent-glass sign is made from one piece. Rendering is solved by `blockout` and
`connectors`. The open problem is the **route**: order the curves and choose where to bridge.
Nearest-neighbour over curve endpoints is approximately what a bender does. `select` has to be
bypassed — lit and dark stop being per-run and become per-segment of one run.

`spine` and `single-stroke` compose: the spine is what you want a single stroke to follow.

## Breaking closed loops

Orthogonal to strategy, and worth doing regardless. A tube has two electrodes, so a seamless closed
loop cannot be built. klieg renders them: `rawSpansOf` returns an uncut whole loop when no corner is
detected (`runs.ts:160`), so a perfect circle is a seamless ring.

An option forcing at least one cut on a corner-free closed span fixes the realism. It also lands on
the same code path as the defect below, which is the argument for doing them together.

## Two defects the spike found

**A short smooth contour rendered nothing — fixed.** `runs` is a budget the cut spent in full
before dropping any piece under `minRun`, so a contour too short to carry the requested count lost
every piece. Measured on `tubing`'s own spec, a circle rendered 7 runs at 1.26 em of perimeter, 4 at
1.13, 1 at 1.01, and **0 at 0.96 and below**. Text rarely reaches it; a logo mark's true circles do.
The cut now fits the count to what the contour can carry, and the old behaviour is
`TubeSpec.shortRun: 'drop'` — it has a use, which is small detail falling out of a sign rather than
being drawn coarsely.

**A sequence of sharp corners loses a fifth of the letter — open.** When a corner's legs are shorter
than the fillet's setback, `filletAt` returns null (`bend.ts:152`) and the corner breaks instead;
a break then cuts the whole corner stretch out (`dropHead`/`dropTail`), leaving a gap. Corners close
together share their legs, so a run of them starves each other and each failure compounds.

Measured with every corner forced to `connect`, so a break is the stage failing rather than choosing:
the `t` of a geometric sans has 12 corners, 8 of them sharper than 60°, and **drops 0.485 em of about
2.44 — a fifth of the letter**. The `W` drops 11%. Bailing out is the wrong response: the tube should
carry through at whatever radius the room allows, or the corner stretch should be shortened rather
than removed. This is the next thing to fix, and it is more visible on art than on text because art
has more right angles.

## Decisions this needs

**Where does `strategy` live?** On `TubeSpec` beside `pathSource` is the small move, and it fits —
both choose what curves come out. Against: `TubeSpec` is already 23 fields and a look declares one,
so a caller cannot pick a strategy without redeclaring the look.

**Is art a first-class input?** The spike treats one `<path>` as one letter, which is what keeps
`runs` and `seed` meaning what they mean for text, and makes the effects part pool work unchanged.
Committing to that shapes the eventual public API more than any strategy does. It is also the
question `sign-wrapper` will ask from the other direction.

**Does `spine` ship as a real medial axis or as deep contraction?** They differ on strokes of uneven
weight. Deep contraction is a parameter change; a real axis is a new extraction. Decide before
promising the name.

## What the spike does and does not show

`spikes/svg-tube/` renders any SVG's paths as `tubing`, with drag-to-pivot and live `contract`,
`radius`, `runs` and path-source controls. `svg-shapes.mjs` mirrors `text/glyphs.ts` — same y
negation, and hole nesting by containment depth rather than winding, which is what lets it take
art from any authoring tool.

It shows outline-tracing on real art, that contraction separates abutting solids under `field`, and
the two costs above. It shows **nothing** about the three unbuilt strategies, and it renders no
letterform through the same page, so no comparison against text has been made.
