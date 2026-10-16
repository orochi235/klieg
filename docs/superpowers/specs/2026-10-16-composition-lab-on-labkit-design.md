# Composition lab on labkit

> **Status: unbuilt.** Being built on branch `composition-lab-labkit`. Delete this file once it
> lands; what is worth keeping moves to `docs/notes/labs.md`.

For whoever builds or reviews the rebuild of `packages/core/dev/composition-lab`. It answers how the
lab moves from its hand-rolled shell onto labkit's `<Lab>` runtime with one instrument, as
kliegsminister already is, keeping everything it measures.

## Shape

| Piece | Becomes |
|---|---|
| Page | `<Lab instruments={[composer]} defaultInstrument="composer">`, with `pages`/`path` giving it the dev-lab switcher today's `LabBar` draws. |
| Config | The whole composition, declared with labkit's `f` builders. Every setting carries a label and a `.describe()` hint; the hints in `patches.ts` move there. |
| Config → domain | One function, `toComposition(config)`, turns the stored shape into the `Composition` every logic module already takes. Config needs it because labkit has no optional fields: `roving` and `intermittent` are objects with an `on` switch. |
| State | Empty. Everything shown is derived from config and the clock. |
| Clock | Per trial, seekable, opens paused at 0, loops. Duration is `hold + 2000`, rewritten whenever `hold` changes. labkit's transport replaces the hand-built one. |
| Trial body | `stage`, so the trial pans and zooms it: preview on top, timeline and part × time under it. |
| Preview | One klieg instance per trial on a `ManualClock`, advanced from the trial clock, rebuilt on a backward move (scrub back or loop wrap). |
| Trials | Each trial is its own composition; adding one copies the current look. Sidebar panels follow the focused trial. |
| Saving | labkit's. `persist.ts` goes; the lab opens on `DEFAULT_COMPOSITION`. |

## Layers

`effects` is `f.list` of `f.union('kind', …)`, one variant per patch kind, with `.render()` drawing
the list inline instead of in labkit's dialog. Each entry is a collapsible row (grip, kind, on/off,
remove) whose body is `<PrefControl pref={list.item} …>` from `@weasel-js/ui`, the public control
for drawing one compound leaf in a surface that lays out its own rows. Add, remove and reorder are
the lab's own and write the whole list through `setValue`, so undo and saving cover them. The
rail's derived warnings (empty target pool, chase on a look with no gradient, a bout too short to
build) show under the entry they concern. A draft's source is edited in the **Drafts** sidebar
section, not in the row.

## Panels

Sidebar sections, each a component reading `useTrialState()` and the trial clock: **Pool** (source,
part counts, font status), **Plot**, **Swatch**, **Tenure**, **Sweep**, **Drafts**, **Emit**. The
sampling App does today moves into one memoized hook, `useSampled(composition)`, that every panel
calls. Part × time's channel and focused part are config, so the plot and the raster share them.

## Testing

Logic tests in `test/composition-lab/` stay as they are. New: the schema's defaults convert to
`DEFAULT_COMPOSITION`, and every `PARAMS` entry has a field with a hint. A headless Playwright pass
checks the paused first frame, scrubbing, a second trial, and a torn-out panel.
