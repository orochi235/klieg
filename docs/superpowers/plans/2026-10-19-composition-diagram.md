# Composition Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: written 2026-10-19, not started.** Delete with the spec once the diagram ships.

**Goal:** A wiring diagram in the composition lab's right column that shows how the composition is built and is where layers and motions are edited.

**Architecture:** Two pure modules carry the logic — `pipeline.ts` turns the trial config into the diagram's data and back into meaning, `edits.ts` holds every edit to the layer list — and are unit-tested. `Diagram.tsx` draws them with weasel's `DiagramView` and a floating `ControlPanel` card; `Body.tsx` gives it the right column. The sidebar loses the layer list and the motion dropdowns last, once the diagram can do everything they did.

**Tech Stack:** React 19, `@weasel-js/diagram` and `@weasel-js/labkit` served from the local weasel checkout, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-composition-diagram-design.md`

## Global Constraints

- Lab only: nothing under `packages/core/src` changes; `composition.ts`, `emit.ts` and the saved config shape (`LabConfig`) keep working, and a trial saved before this change opens unchanged.
- The diagram reads and writes the trial config through `useLab().setConfig` with the same paths the sidebar used (`effects`, `enter`, `active`, `exit`).
- Every `@weasel-js` import in the composition lab is served and typechecked from `~/src/weasel`'s built packages; the shipped library keeps its pinned `@weasel-js/font` and `@weasel-js/text`.
- Where weasel cannot do something, message the weasel session (`weasel-47`) and wait or skip that step; do not hand-build around it.
- Nothing is called done until the lab has been driven headless and frames are on the wall (`docs/notes/labs.md`, "Checking an orbit fix" for the method; `transom post --zone klieg`).
- Run tests with `command npx vitest run <path>` from `packages/core` (plain `npx` is broken in this harness).

## Weasel dependencies

On weasel `main` at `b68b7a4e4` (local, unreleased, dist built). Docs: "Overlays and hover" and "Reordering a group's members" in `~/src/weasel/packages/diagram/README.md`; demos `apps/site/demos/DiagramOverlaysDemo.tsx` and the diagram-reorder demo.

| klieg needs | API | Used by |
|---|---|---|
| Edge click and hover | `pickEdges` makes edges pickable; `onSelect` and `onHover?: (id \| null) => void` then report edge ids (`edgeIdOf(dataEdge)`, so give every `DataEdge` an `id`). `onHover` reports null when the pointer reaches an overlay: keep the + on the last hovered edge rather than hiding it on null. | Task 5 |
| Content beside a node or edge | `overlays?: readonly DiagramOverlay[]`, each `{ target, placement?: { side, align } \| 'center', offset?, key?, content }`; an edge's place is its route's midpoint; overlay content takes the pointer. `ref.rectOf(id)` and `ref.subscribeFrame(fn)` for DOM outside the view. `className` now lands on a wrapper div, not the canvas. | Tasks 4, 5 |
| Reorder layer rows | Each row its own group inside `{ id: 'layers', members, reorder: 'y' }`; `onReorder?: ({ group, order }) => void` fires on release; write `order` back into the parent's `members`. Alt+ArrowUp/Down steps the selected row after a click in the canvas. | Task 5 |

Tasks 1–3 need none of them.

## Review Focus

- A trial saved before this change, with layers that have `roving.on` / `intermittent.on` set and a draft with a `source`, draws every layer and wrapper and emits the same `fire()` call. Test in Task 2.
- A composition with no layers draws the word node and the motion row and still offers + to add a layer. Test in Task 2.
- A lamp layer is never offered roving (`carriesRoving` is false for lamp). Test in Task 3.
- Inserting a wrapper the layer already has, or removing one it lacks, leaves the entry unchanged rather than toggling. Test in Task 3.
- A disabled layer stays drawn and grayed, and `emit` still leaves it out. Test in Task 2.

---

### Task 1: Serve and typecheck the lab from the weasel checkout

**Files:**
- Modify: `packages/core/package.json` (`dev:composition-lab` script)
- Modify: `packages/core/dev/composition-lab/tsconfig.json` (`paths`)
- Modify: `docs/notes/labs.md` (the `WEASEL=<checkout>` bullet)

**Interfaces:**
- Produces: `@weasel-js/diagram` importable in `dev/composition-lab/src` with the checkout's types.

- [ ] **Step 1:** Change the script to `"dev:composition-lab": "WEASEL=${WEASEL:-../../../weasel} vite dev/composition-lab"` (the path is from `packages/core`, where `npm run -w klieg` runs it, to `~/src/weasel`).
- [ ] **Step 2:** Add to the lab tsconfig's `paths`: `"@weasel-js/*": ["../../../../../weasel/packages/*/dist/index.d.ts"]`. Do not install `@weasel-js/diagram` from npm.
- [ ] **Step 3:** Verify: `command npx tsc -b dev/composition-lab/tsconfig.json` from `packages/core` exits 0, and a scratch `import { DiagramView } from '@weasel-js/diagram'` in `Body.tsx` typechecks (remove it after).
- [ ] **Step 4:** Restart the lab server (stop the running one by its port, 5184, then `command npm run dev:composition-lab -w klieg`), then `node scripts/lab-probe.mjs composition-lab` from the repo root: every check other than `turn after zoom` (a known 5px reading) is `ok`.
- [ ] **Step 5:** In `docs/notes/labs.md`, say the composition lab now runs against the checkout by default and why (weasel's diagram changes are unreleased).
- [ ] **Step 6:** Commit: `serve and typecheck the composition lab from the local weasel checkout`.

### Task 2: The pipeline model

**Files:**
- Create: `packages/core/dev/composition-lab/src/pipeline.ts`
- Test: `packages/core/test/composition-lab/pipeline.test.ts`

**Interfaces:**
- Consumes: `LabConfig`, `LayerEntry`, `entriesOf` from `config.ts`; `DiagramData` from `@weasel-js/diagram`.
- Produces:
  ```ts
  export type Wrapper = 'roving' | 'intermittent';
  export type Stage = 'enter' | 'active' | 'exit';
  export type Part =
    | { kind: 'patch'; layer: string }
    | { kind: 'wrapper'; layer: string; wrapper: Wrapper }
    | { kind: 'pool'; layer: string }
    | { kind: 'word' }
    | { kind: 'motion'; stage: Stage };
  export const WRAPPERS: readonly Wrapper[]; // ['roving', 'intermittent'], inner to outer, as emit nests them
  export function partOf(id: string): Part | null;      // the inverse of the ids below
  export function idOf(part: Part): string;
  export function diagramOf(config: LabConfig, warnings: (entry: LayerEntry) => string[]): DiagramData;
  ```
  Ids: `patch:<layer>`, `roving:<layer>`, `intermittent:<layer>`, `pool:<layer>`, `word`, `motion:enter|active|exit`. One group per layer, id `layer:<layer>`, inside a group `layers` with `reorder: 'y'`.

- [ ] **Step 1: Write the failing tests** in `pipeline.test.ts`:
  - `draws a layer as patch, its wrappers in order, then its pool, into the word`: a flicker entry with `roving.on` and `intermittent.on` gives edges `patch→roving`, `roving→intermittent`, `intermittent→pool`, `pool→word`.
  - `leaves a wrapper that is off out of the row`: same entry with `roving.on: false` gives `patch→intermittent`.
  - `draws the motion row and the word with no layers`: `schema.defaults()` gives nodes `word`, `motion:enter`, `motion:active`, `motion:exit` and edges `enter→active→exit→word`; the `layers` group has no members.
  - `labels each motion node with its stage and choice`: `motion:enter` rows include `'enter'` and `'slam'`.
  - `draws a disabled layer and marks it`: an entry with `enabled: false` is still drawn; its patch node carries the marker Task 4 styles (a row reading `off`, unless weasel offers per-node styling).
  - `puts a layer's warnings on its pool node`: `warnings` returning `['no runs']` puts a `no runs` row on `pool:<id>`.
  - `round-trips every id through partOf`: for every node id `diagramOf` makes, `idOf(partOf(id)!) === id`.
  - `draws a trial saved before the diagram`: a config literal with a draft (`source` set) and a flicker with both wrappers on draws all five nodes of each row, and `emit(toComposition(config))` is unchanged by drawing it.
- [ ] **Step 2:** Run `command npx vitest run test/composition-lab/pipeline.test.ts`: FAIL, module not found.
- [ ] **Step 3:** Implement `pipeline.ts`. Node rows are short readouts: the patch kind and its params from `PARAMS[kind]` (draft shows `draft`), a wrapper's settings (`dwell 3200 · 96 epochs`), the pool's `target · amount`. `layout: 'layered'` left to right is the caller's, not this module's.
- [ ] **Step 4:** Run the test file: PASS.
- [ ] **Step 5:** Commit: `add the composition lab's pipeline model`.

### Task 3: Edits to the layer list

**Files:**
- Create: `packages/core/dev/composition-lab/src/edits.ts`
- Test: `packages/core/test/composition-lab/edits.test.ts`

**Interfaces:**
- Consumes: `LayerEntry`, `newEntry`, `PatchKind` (config.ts / patches.ts); `Wrapper`, `WRAPPERS` (Task 2); `carriesRoving` (composition.ts).
- Produces (all pure, returning a new list):
  ```ts
  export function addLayer(entries: LayerEntry[], kind: PatchKind): LayerEntry[];
  export function removeLayer(entries: LayerEntry[], id: string): LayerEntry[];
  export function setEnabled(entries: LayerEntry[], id: string, on: boolean): LayerEntry[];
  export function insertWrapper(entries: LayerEntry[], id: string, wrapper: Wrapper): LayerEntry[];
  export function removeWrapper(entries: LayerEntry[], id: string, wrapper: Wrapper): LayerEntry[];
  export function reorder(entries: LayerEntry[], ids: readonly string[]): LayerEntry[];
  /** The wrappers the + between `from` and `to` of a layer's row may insert. */
  export function insertable(entry: LayerEntry, from: Part, to: Part): Wrapper[];
  export function updateEntry(entries: LayerEntry[], id: string, next: LayerEntry): LayerEntry[];
  ```
- [ ] **Step 1: Write the failing tests:**
  - `adds a layer of the asked kind at the end`, with `newEntry`'s defaults.
  - `inserts a wrapper by switching it on, keeping its settings`: `roving.dwell` survives an insert after a remove.
  - `leaves the list alone inserting a wrapper the layer has, or removing one it lacks` (`toBe` the same entries, not a copy).
  - `never offers roving to a lamp`: `insertable(lampEntry, patch, pool)` is `['intermittent']`.
  - `offers only the wrappers that belong between two nodes`: for an entry with roving on, `insertable(e, roving, pool)` is `['intermittent']` and `insertable(e, patch, roving)` is `[]`.
  - `reorders to the given ids and drops none`: an id missing from `ids` keeps its relative place at the end.
  - `keeps a layer's id and enabled across an edit of its fields` (the rule `LayersControl.edited` enforced).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement. Inserting or removing a wrapper writes `{ ...entry[wrapper], on }`; `updateEntry` keeps `id` and `enabled` from the stored entry, as `LayersControl.edited` does today.
- [ ] **Step 4:** Run: PASS.
- [ ] **Step 5:** Commit: `add the edits the composition diagram makes to the layer list`.

### Task 4: Draw the diagram, with a settings card on the picked node

**Files:**
- Create: `packages/core/dev/composition-lab/src/Diagram.tsx`
- Create: `packages/core/dev/composition-lab/src/NodeCard.tsx`
- Modify: `packages/core/dev/composition-lab/src/Body.tsx` (right column)
- Modify: `packages/core/dev/composition-lab/src/styles.css`
- Modify: `packages/core/dev/composition-lab/src/LayersControl.tsx` (export `warningsOf` for reuse; the file goes in Task 6)

**Interfaces:**
- Consumes: `diagramOf`, `partOf` (Task 2); `updateEntry`, `setEnabled`, `removeLayer`, `removeWrapper` (Task 3); `useLab`, `useSampled` (hooks.ts); `ControlPanel`, `f` (labkit); `DiagramView`, `diagramScene` (diagram); the overlay or `rectOf` API from the weasel table.
- Produces: `<Diagram />` taking no props (reads the trial through hooks).

- [ ] **Step 1:** `Body.tsx`: put the existing column (preview, transport, timeline, raster) and a new `.cl-diagram` column side by side; the diagram column takes the full height on the right, about a third of the width.
- [ ] **Step 2:** `Diagram.tsx`: `DiagramView` over `diagramScene(diagramOf(config, warnings), { layout: 'layered', layoutOptions: { direction: 'right' } })`, `selected`/`onSelect` held in component state. Warnings come from `warningsOf` exactly as `LayersControl` computes them.
- [ ] **Step 3:** `NodeCard.tsx`: for the picked node, a `ControlPanel` over a schema built per part:
  - patch: the variant's own fields from `config.ts` `VARIANTS[kind]` minus `roving`, `intermittent`, `target` and `amount`, plus an on/off switch and a remove button. A draft's card says its source is edited in the Drafts section.
  - wrapper: that wrapper's fields minus `on`, plus remove.
  - pool: `target` and `amount`.
  - motion: the stage's `f.enum` from `config.ts` (moved out of `shape` into exported nodes Task 6 hides).
  Writes go through Task 3's functions into `setConfig('effects', asEffects(...))`, or `setConfig(stage, value)` for a motion. Export the existing field builders from `config.ts` rather than redefining them.
- [ ] **Step 4:** Place the card beside the picked node using weasel's overlay (or `rectOf`). If neither has landed, stop here and message `weasel-47`.
- [ ] **Step 5:** `command npx tsc -b dev/composition-lab/tsconfig.json` exits 0; the Task 2 and 3 tests still pass.
- [ ] **Step 6:** Drive it headless: load 5184, add a flicker in the sidebar, click its patch node, move `period`, and check the sign's flicker changes and `emit` shows the new period. Post the frames before and after to the wall.
- [ ] **Step 7:** Commit: `draw the composition as a wiring diagram with a card for the picked node`.

### Task 5: Add, insert and reorder on the diagram

**Files:**
- Modify: `packages/core/dev/composition-lab/src/Diagram.tsx`

**Interfaces:**
- Consumes: `addLayer`, `insertWrapper`, `insertable`, `reorder` (Task 3); edge events, overlays and `onReorder` from the weasel table.

- [ ] **Step 1:** A + under the last layer row opens a menu of `KINDS` and calls `addLayer`.
- [ ] **Step 2:** Hovering an edge inside a layer row shows a + when `insertable` offers anything; picking a wrapper calls `insertWrapper`.
- [ ] **Step 3:** `onReorder` on the `layers` group calls `reorder` with the reported ids.
- [ ] **Step 4:** Drive headless: add a hue, insert roving on its patch→pool edge, drag it above the first layer; post each frame; check the `emit` section's order matches.
- [ ] **Step 5:** Commit: `add, insert wrappers and reorder layers on the composition diagram`.

### Task 6: Retire the sidebar's layer list and motion dropdowns

**Files:**
- Delete: `packages/core/dev/composition-lab/src/LayersControl.tsx` (move `warningsOf` into `Diagram.tsx` or `pipeline.ts` first)
- Modify: `packages/core/dev/composition-lab/src/main.tsx` (drop `controls`)
- Modify: `packages/core/dev/composition-lab/src/config.ts` (`enter`, `active`, `exit`, `effects` get `.hidden()`)
- Modify: `packages/core/dev/composition-lab/src/styles.css` (drop `.cl-layer*` rules)
- Test: `packages/core/test/composition-lab/config.test.ts`

- [ ] **Step 1: Write the failing test** `hides the layers and motions from Settings`: the schema nodes for `effects`, `enter`, `active` and `exit` are hidden, and `schema.defaults()` still equals the old defaults (`toComposition(schema.defaults())` equals `DEFAULT_COMPOSITION`).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Make the changes listed under Files.
- [ ] **Step 4:** Run `command npx vitest run test/composition-lab`: PASS.
- [ ] **Step 5:** Drive headless: the sidebar shows text, look, hold and pool only; a trial saved before the change (seed `localStorage` key `klieg:composition-lab` from a pre-change export) opens with its layers on the diagram. Frames to the wall.
- [ ] **Step 6:** Delete the spec and this plan; move anything worth keeping into `docs/notes/labs.md`.
- [ ] **Step 7:** Commit: `move the composition lab's layers and motions onto the diagram`.
