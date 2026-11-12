# The dev labs

**For:** whoever uses or extends a lab under `packages/core/dev/` or `apps/lab/`. **Answers:** what
each lab is for, what it can and cannot be trusted on, and the traps in running them. The port map
is `packages/core/dev/shared/pages.ts`; `apps/lab` serves on 5180.

| Lab | Run | For |
|---|---|---|
| lab page | `npm run dev -w @klieg/lab` | every motion, look and policy; share links (`/show/`) |
| tube lab | `npm run dev:tube-lab -w klieg` | the whole `TubeSpec`, sixteen letters in one GL context |
| kliegsminister | `npm run dev:kliegsminister -w klieg` | one corner at a time: stages, repairs, rejoin |
| composition lab | `npm run dev:composition-lab -w klieg` | a whole `fire()` on a clock the lab owns |
| tube gallery | `npm run dev:tube-gallery -w klieg` | 24 tube variants, each sweeping its own hue |

## Composition lab

A labkit `<Lab>` with one instrument (`src/instrument.tsx`): each trial is one composition, and
**Clone trial** copies it to compare looks side by side. The settings are the schema in
`src/config.ts`, where every hint lives; the analysis panels are sidebar sections that read their
own trial through `useTrialState`, so a torn-out one still follows it.

- **Layers and motions are edited on the diagram in the right column** (`src/Diagram.tsx`), not
  in Settings, where `effects`, `enter`, `active` and `exit` are `.hidden()`. Each layer is a row,
  patch → wrappers → pool, into the word; `src/pipeline.ts` turns the config into the diagram and
  maps a node id back to what it stands for, and `src/edits.ts` holds every edit. A node's card is
  labkit's `ControlPanel` over that node's slice of the schema, placed with `DiagramView`'s
  overlays. A layer's `id`, `enabled` and a draft's `source` stay outside the schema, since nested
  `.hidden()` fields are still drawn.
- **Headless driving clicks diagram nodes by id** through `globalThis.kliegDiagram` (`view.rectOf`
  and the node `ids`), as the probe reads ink through `kliegLab`.
- **A fire sizes its word once, when it starts.** The preview fires again when its box resizes, or
  a second trial halving the first leaves the word overflowing it. Filed in `TODO.md`.
- **A draft builds only once its source has compiled**, which is async. Reading a composition
  compiles any stored draft nothing has compiled yet, so a reloaded lab's drafts play with their
  pane folded.
- **Theme the lab's own CSS under the lab, not on `:root`.** labkit applies its tokens on the lab's
  element, so an alias defined on `:root` captures the page's colors instead.
- **Honest about time, dishonest about intensity.** No bloom threshold reaches the plots, so a
  `gain` of 0.65 plots as 0.65 whether or not it reads as a dropout. Judge timing off the raster
  and the plot, and depth off the render.
- **Nothing in it reimplements targeting, `stagger` or merging.** `effects/frame.ts` holds
  `planEffects` and `EffectFrame`, and both `Word` and the lab call them. An instrument that
  re-derives what happens around a piece drifts and then reports confident wrong answers.
- **The raster answers coverage; the timeline does not.** A timeline block means the piece ran, not
  that a part moved. `samplePass` counts moved parts; `test/composition-lab/sample.test.ts` pins it.
- **Tenure matches the true holder exactly at every sample rate.** Empty samples are skipped, and
  `passSamples(pass, finest)` sizes the grid to the finest piece in the composition rather than to
  the pass, so a 306s pass does not step over 252ms drops. `node spikes/tenure-vs-dwell.mjs` is the
  instrument.
- **It refuses `roving` over a `lamp`, and offers no `fromPointer` lamp**, because `pointerFrame`
  needs a `PlacedWord` only a running fire has.
- **Never name a panel for its own module on a case-insensitive filesystem.** `Tenure.tsx` beside
  `tenure.ts` resolves to the `.ts` on macOS; `tsc` and vite both break, and Linux would not. The
  panels are `TenurePanel.tsx` and `SweepPanel.tsx`.

## Tube lab

- **Some rail controls do very little, and the hover hints say so.** `runs` is pinned between the
  corner count and `minRun`; `wall depth`, `wall rise` and the `surface` gradient domain do nothing
  under either front-only shipped look; a positional gradient restarts in each one-letter panel.
  `spikes/slider-sensitivity.mjs` counts distinct outputs per field — run it before believing a
  control.
- **A spec change rebuilds all sixteen cells**: ~1.45s front-only, ~2.85s with `back`/`wall`/
  `connectors`. Sliders commit on release. The real fix is not rebuilding a whole `Word` per cell.
- The spikes are the fast way back in: `bend-acceptance.mjs` (the invariant across the alphabet),
  `where-under-bend.mjs <look> <letters>`, `run-vertices.mjs`, `corner-width.mjs`, `fillet-view.mjs`,
  `join-geometry.mjs`, `source-shootout.mjs`, `run-decomposition.mjs`.

## kliegsminister

- Drives `stages`, `draw at`, seven repair toggles, `rejoin` and `subject` off the core registries
  through `src/pipeline.ts`; it draws nothing core does not.
- **With every repair on, nothing is skipped**, so the `ghost` layer is empty; the `repair` layer
  draws the sites that ran. `node spikes/repair-layer-ink.mjs <layer>` md5s the canvas with a layer
  toggled, the only way to tell a layer that drew from a legend row that appeared.
- **labkit's zoom readout does not track a programmatic view**, so it is not evidence about the view.

## Tube gallery

**Two ways a cell silently stops cycling, both refused in code**: a `tubeMaterial` override, and a
`mode: 'replace'` gradient (`lookFor` throws). See [tubes](tubes.md#color).

## Checking an orbit fix

`npm run probe:lab -- composition-lab` (or `tube-lab`) drives the running lab headless — a turn at
the pose the lab opens on, then, settled into the hold, a pan, a turn, a zoom at the pointer and a
turn after it — and prints how far, in pixels, the ink under each
gesture's fixed point slid. A change to how a lab orbits is not done until this passes against the
lab itself; unit tests of the transform have passed while the lab visibly drifted. Frames land in
`test-results/lab-probe/<lab>/`, emptied each run, and go to the wall unless `--no-post`.

- **The composition lab is measured exactly**, through `pointOn` on the instance it leaves at
  `globalThis.kliegLab`. Other labs fall back to matching images, which bloom defeats under a zoom
  (its glow is drawn in screen pixels and does not grow), so a `LOST` there is the matcher, not the lab.
- **Check the pose the user sees, not only the rest pose.** The composition lab opens mid-entrance
  with the letters 26 em behind where they rest; a pivot that held at rest threw them out of frame
  there while every settled check passed. The opening check measures the ink's on-screen middle.
- **A turn moves whatever is off the pivot plane.** The pivot is the ink's face; a tube stands one
  radius in front of it, so its surface legitimately shifts a few pixels under a turn.

## Running them

- **Identify a dev server by its process cwd, never by its port.** `lsof -p <pid> -a -d cwd`. Other
  projects on this machine interleave ports — 5183 is slopboard's vite and 5199 is astv — and a
  render against the wrong one looks plausible.
- **Kill by port, never `pkill -f vite`**, which takes out every session's servers.
- **Playwright derives its port from the checkout's path** and starts vite `--strictPort`, so a run
  in one worktree cannot answer from another's server.
- **Plain `chromium.launch()` gets `chrome-headless-shell`, which rasterizes WebGL in software** and
  gets transmission wrong. The render spikes pass `channel: 'chromium'` and `--use-angle=metal`.
- **A push to `main` touching `apps/lab/**` deploys the lab** through `pages.yml`.
- **`WEASEL=<checkout>` serves every `@weasel-js` import from a weasel checkout's built
  packages** (`dev/shared/weasel.ts`), for trying an unreleased labkit. It takes all of them at
  once, because a labkit is built against its own core, and keeps klieg's React and three.
- **The tube lab runs against `~/src/weasel` the same way** (`dev:tube-lab`, and its tsconfig's
  `@weasel-js/*` path), for labkit's floating trial settings, `hide` and `renderTitle`'s config
  (2026-11-11). Drop both once a weasel release carries them.
- **The composition lab always runs against `~/src/weasel`** (its `dev:composition-lab` script
  defaults `WEASEL` to the sibling checkout, and its tsconfig maps `@weasel-js/*` to that
  checkout's `dist`), because its effects diagram uses `@weasel-js/diagram` APIs weasel has not
  released. Build the checkout before serving; until a weasel release carries those APIs, the
  repo's `typecheck` needs the checkout beside it.
