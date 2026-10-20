# Composition lab: the effects diagram

**Status: designed 2026-10-19, not built.** Delete this file once the diagram ships; anything worth
keeping moves into `docs/notes/labs.md`.

For whoever builds it: what the composition lab's new diagram view is, what it replaces, and the
calls already made. Read `docs/notes/labs.md` for how the labs are run and checked.

## Intent

The composition lab (`packages/core/dev/composition-lab`, port 5184) describes a `fire()` call: a
word, its look, its enter / active / exit motions, a hold, and a stack of effect layers. Today the
layers are a hand-built list in the sidebar and the motions are dropdowns, which tells you the
settings but not how the effect is put together. The diagram shows, at a glance, how the effect is
built — which patch feeds which wrappers, which parts they drive, and how the word moves — and is
where it is edited.

## What it draws

A left-to-right wiring diagram in a column on the right of the trial, beside the preview, filling
its full height (the timeline and part × time panels stay under the preview).

- **One row per effect layer:** `patch → wrapper(s) → pool → word`.
  - The patch node is the kind (flicker, hue, chase, lamp, draft) and a short readout of its
    params.
  - Each wrapper (roving, intermittent) is its own node, in the order it is applied: roving inside
    intermittent, as `emit` writes it.
  - The pool node is the target kind (runs, bodies, chunks) and the amount.
  - Every layer row ends in a single shared word node (text and look).
- **The word's motion row:** `enter → active → exit`, joined to the word node. Enter and exit are
  shown here and only here.
- A disabled layer stays on the diagram, grayed out.
- The warnings `LayersControl` gives today ("this pool has no run parts, so the layer does
  nothing", a look with no gradient under chase, a bout spell too short to build) move onto the
  node they are about: the pool node or the patch node.

## Editing

- Clicking a node opens a settings card beside it, floating over the diagram (it may cover part of
  it while open). The card is weasel's `ControlPanel` drawn from that node's slice of the schema.
- **+ on an arrow** between two nodes of a layer inserts a wrapper there. A wrapper the layer
  already has, or one the kind cannot take (lamp takes no roving), is not offered.
- **+ under the last layer** adds a layer, asking which patch kind.
- Dragging a layer row reorders the layers.
- A layer's card has its on/off switch and a remove action; a wrapper's card removes the wrapper.
- A patch's kind is not changed in place: remove the layer and add another.
- Enter, active and exit nodes each open a card that picks the motion.
- A draft patch's source stays edited in the Drafts sidebar section; its card links there.

## What goes away

- `LayersControl.tsx` and the `effects` row in Settings.
- The `enter`, `active` and `exit` dropdowns in Settings.

The sidebar keeps text, look, hold and pool in Settings, and the analysis sections (Plot, Swatch,
Tenure & jump, Param sweep, Drafts, Emit).

## Constraints

- **Lab only.** Nothing klieg ships changes. The composition model (`composition.ts`), `emit`, and
  the saved config shape keep working; a trial saved before this change opens unchanged.
- **One source of truth.** The diagram reads and writes the trial config through the same paths
  the sidebar did, so undo, saved trials and torn-out panels behave as they do now.
- **Built on weasel.** Use `@weasel-js/diagram` (new to klieg's labs; pin it at the version the
  other `@weasel-js` packages use) for nodes, edges and left-to-right layout, and labkit's
  `ControlPanel` for the cards. Where weasel cannot do something the diagram needs, file it against
  weasel and say so, rather than hand-building around it.
- **Built against the local weasel checkout, not a release.** `DiagramView` is gaining edge click
  and hover, a node's on-screen box (or DOM overlays anchored to a node or an edge), and reordering
  a group along one axis with the new order reported, on weasel `main` (from 2026-10-19). The +
  on an arrow, the floating card and row reordering are built on those, not around them. The
  composition lab serves and typechecks every `@weasel-js` import from `~/src/weasel`'s built
  packages (`WEASEL=<checkout>`, `dev/shared/weasel.ts`); the shipped library keeps its pinned
  `@weasel-js/font` and `@weasel-js/text`.
- The lab is checked the way `docs/notes/labs.md` says: driven headless, frames on the wall, before
  anything is called done.

## Non-goals

- **Camera moves.** Making the camera automatable by the composition is a separate design (it needs
  new klieg API). Leave room for a camera node on the motion row; don't build it.
- Free-form wiring. The rows are fixed in shape; there is no connecting arbitrary ports.
- Changing a layer's kind in place.

## Left to the builder

- Node size, color and readout text; how a selected node is marked.
- Whether layout is re-run on every change or nodes are placed directly (the shape is fixed).
- How the settings card is positioned and dismissed.
- How the + affordances look.
