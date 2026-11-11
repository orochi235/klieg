# Tube lab — design

> **Superseded page structure (2026-11-11):** the lab now runs on labkit's `<Lab>`, each panel a
> trial and the shared tube spec in `<Lab over>`. What this doc says about the hand-rolled
> workspace, `PanelTile` and the rail's add-panel row no longer matches the code.

**What:** a dev-only workbench for judging and tuning the `tubing` look's geometry.
**For:** whoever implements it. **Answers:** what gets built, where it lives, and how it draws.

## Why a second lab

`apps/lab` fires whole words fullscreen through the public API, which is the right shape for
checking that the library works and the wrong shape for judging a tube. A run that varies in depth
is invisible head-on; one word at one angle is one sample; and the numbers that explain what the
pipeline did — how many runs, which ones lost radius — are not on screen at all.

This lab shows several letters at several angles at once, with the pipeline's own intermediate data
next to the render. It is built for `tubing` and works unchanged for `piping`, which is the same
decoration kind with different weights.

## Where it lives

`packages/core/dev/tube-lab`, its own Vite app. This is the package's own tooling rather than
consumer code, so importing `../../src/render/tube/*` directly is legitimate and not the
reach-past-the-public-surface pattern the project bans. `packages/core`'s `files` field already
limits the tarball to `dist/`, so nothing publishes by accident; `tsconfig.json` must exclude
`dev/` so it stays out of the build.

React 19 and `windease` are devDependencies of `packages/core`, imported only here. Nothing in
`apps/lab`, `packages/core/src` or the published bundle gains a React dependency.

## The zone

A single [windease](https://github.com/orochi235/windease) zone on `splitStrategy` with
`recursive: true`, under `<DragProvider>`.

- **A panel is a `{ letter, mode }` pair** held in `meta`, not a fixed cell in a grid. Any number of
  panels; add and remove from the rail. Two panels may show the same letter in different modes, or
  the same mode for different letters.
- **Rearranging** is dragging a panel's title bar, which is the `<DragHandle>`. **Resizing** is
  dragging a `splitStrategy` gutter, which ships with the strategy.
- **The arrangement persists** through `serialize(store)` into `localStorage`, restored on load.
  A default seed of `NSRE` x the four modes builds the first-run layout.

The letters come from a text field in the rail. Changing it adds and removes panels for the
letters that changed, leaving the rest of the arrangement alone.

## Panel modes

| Mode | Shows |
| --- | --- |
| `beauty` | The shipped look as `fire()` renders it: lit and dark glass, emissive, bloom. The reference the others are judged against. |
| `orbit` | The same render, drag to yaw and pitch. Its own camera per panel, and only the panel being dragged moves. |
| `skeleton` | Run centerlines, the glyph contour rings from `surfacesOf()`, run endpoints, and the diagnostics below. No tube geometry. |
| `ramp` | The swept tube coloured by one per-vertex scalar through one colour ramp. The source — depth, or arc length along the run — is a per-panel control, so two ramp panels can show both at once. |

`skeleton` is where the numbers live, because it is the mode with room for them:

- **Requested versus actual radius per run**, with clamped runs drawn in a warning colour and the
  panel reporting `N runs · M clamped`. `sweepRadius(run, spec.radius)` is already exported, so
  this recomputes rather than requiring a pipeline change.
- **Runs that vanished.** `sweepRun` returns `null` when the clamped radius reaches zero, and that
  run is silently absent from `lit`/`dark` while still present in `runs`. Drawn as a dropped run.
- **The corner strategy at each junction** — `break`, `connect` or `loop`.

`TubeBlueprint` already carries `runs: Run[]`, so centerlines, surface kind, length, lit flag and
colour need no new plumbing. The corner decisions are the exception: `pickStrategy`'s result is
consumed inside `stitchPath` and discarded. Recording it is the one pipeline change this lab needs
— a per-junction `{ point, strategy }` list on the blueprint.

## Rendering

One `WebGLRenderer` on one canvas, sized to the zone and sitting behind it. Panel chrome is DOM on
top; the panel body is transparent.

Sixteen panels cannot each own a renderer — Chrome caps WebGL contexts near sixteen and silently
loses the oldest. Instead, windease's `placements: Map<NodeId, Rect>` is walked once per draw, and
each panel's rect becomes a `setViewport` / `setScissor` pair.

**Bloom forces an offscreen step.** It is a post-process over a whole render target, so scissoring
alone would bleed one panel's glow into its neighbours. A panel renders into a single shared
offscreen target, runs the bloom chain only if its mode wants it, and is blitted into its rect.
One target reused, not one per panel.

**Drawing is on demand, not per frame.** A redraw is scheduled when a parameter changes, when the
layout settles, or while a panel is being dragged — and only the dragged panel redraws
continuously. This is what makes sixteen bloom chains affordable, and a tuning tool has no use for
an idle 60fps.

## Parameters

One rail, applying to every panel at once. Every field of `TubeSpec` that is worth a control:

- **Tube:** `radius`, `segments`, `spacing`, `level`, `runs`, `minRun`, `select.amount`, `amplitude`
- **Corners:** `break`, `connect`, `loop` weights
- **Surfaces:** independent `front` / `back` / `wall` checkboxes, `wallDepth` and `wallRise`, and
  `connectors` with `connectorOvershoot`. Both shipped tube looks trace the front face only, so
  these are what let the lab judge a tube on an extruded letter rather than a flat contour —
  `connectors` need both faces on, and say so when they are not.
- **Material:** the lit look's `emissive` and `emissiveIntensity`, `colors`, and a bloom toggle
- **Zone:** letters, add panel, reset layout

Seeded from `specOf('tubing')` on load, so the controls read as that look's own tuning until
dragged — the same rule `apps/lab` follows.

## Testing

Layout is a pure function: `splitStrategy.layout({ items, container, state, options })` returns
rects, and that is unit-testable in vitest with no GL context. So is the skeleton's data — clamped
runs, dropped runs and corner decisions are derived from `buildTubeBlueprint`'s output.

The rendering itself is judged by eye, which is the tool's entire purpose, so it gets no visual
baselines. `apps/lab` keeps that job.

## What this lets us delete

`packages/core/src/debug.ts` and `apps/lab/src/diagnostics.ts` exist only because there was
nowhere else to put diagnostic rendering. Once this lab is real both are removed, returning
`apps/lab` to consumer code touching public API only. `WordDebugHooks` stays — it is a genuine
narrow surface.

Deletion happens in this work, not later: leaving both diagnostic paths alive means two of them
drifting instead of one.

## Risks

- **`windease` is at 0.8.0 and two weeks old.** Rough edges are likely, and lab progress can block
  on fixing them upstream. Report them rather than working around them.
- **React 19 is a second build target** in a repo that is otherwise vanilla TypeScript and three.js.
  Biome needs to handle JSX, and `packages/core` gains a dev-only toolchain.

## Out of scope

The two geometry defects this lab exists to expose are **not** fixed here. They get their own spec
once the lab can measure them:

- **Diameter is not constant.** `sweepRadius` clamps each run to 80% of its tightest curvature
  radius, so a letter's tube is a set of differing diameters set by each run's worst corner. Real
  neon is one diameter, and the bender's minimum bend radius should shape the runs instead.
- **Loops are closed planar rings, not helices.** `buildLoop` sweeps 2π in the tangent–depth plane
  and lands exactly back on the corner, where the incoming and outgoing tube also pass, so the tube
  intersects itself. A pigtail must advance along the path by at least one tube diameter over its
  period and rejoin downstream.
