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
