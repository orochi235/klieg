# Floating legend for the corner lab

**What this is:** a design for a draggable, corner-snapping color key over the corner lab's canvas,
and the three packages it lands across.

**Who it's for:** whoever implements it. The work spans klieg, `@weasel-js/labkit` and `windease`,
and cannot land as one commit.

**The question it answers:** the corner lab draws eight distinct inks with no key at all. Blue and
purple are both carried runs, distinguished only by which side of a split corner they reach it from,
and the only way to learn that today is to open `instrument.tsx`.

## What lands where

| Package | Gains |
| --- | --- |
| `windease` | `floatingStrategy` — placement, dragging, corner snapping, persistence |
| `@weasel-js/labkit` | `FloatingPanel` (React shell over the strategy) and `Legend` (presentational) |
| klieg | composes the two in the corner lab |

The snap behavior lives in windease rather than labkit because labkit is React DOM and
`@weasel-js/hud` — which already ships a `window` widget with drag zones — is WebGL. Neither can
import the other, so a shared snap rule has to sit below both. windease is also already a labkit
dependency (`^1.2.1`), so nothing new is introduced, and it already owns the drag engine and
snapshot persistence this needs.

`Legend` and `FloatingPanel` are separate exports because the floating shell has a second tenant
waiting: the corner lab's minimap (`corner-lab-minimap@ee450c7`).

Nothing collapses. Collapsing was in the original ask and was dropped once it was clear that a
legend small enough to read at a glance has nothing worth hiding.

## `floatingStrategy` (windease)

Every shipped strategy tiles — `grid`, `strip` and `stack` partition their container. None places a
window free over content. `floatingStrategy` is a **decorator**, not a peer:

```ts
floatingStrategy(gridStrategy)   // or stripStrategy, stackStrategy, or nothing
```

`layout()` splits `items` on `meta.floating` — `meta` because the type docs say that is where
strategies read flags like `pinned`. Tiled items go to the inner strategy against the **full**
container, so tiling is unchanged and reserves no room for the panel. Floating items are placed from
the strategy's own state, and both merge into one `placements` map. Affordance ids are namespaced so
`reduce` routes by prefix. `canAccept` and `navigate` delegate to the inner strategy with floating
items filtered out, so it never counts them; `configSpec` is the union. `getDropPreview` is left
undefined, which sends the host down the canonical `layout({ preview })` path — and `preview` is
forwarded to the inner strategy, so drop previews keep working without a second code path.

No existing strategy changes. A container needing no tiling wraps nothing.

**State**, per item: `{ x: number; y: number; anchor: Corner | null }`, where `Corner` is
`'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'`. The position always accumulates and
`anchor` is a sticky cache over it. Storing `anchor` is what makes a resize exact — the rect
re-derives from the corner rather than being re-clamped from stale coordinates.

It cannot be the tidier `{ anchor } | { x, y }` union. While snapped, `layout()` would resolve to the
corner origin, so every incoming delta would be measured from that same origin and a slow drag
outward would re-snap forever, never escaping. The visible consequence of the working shape is
correct sticky-snap behavior: un-snapping jumps the panel up to `snapThreshold` px at once.

**Eligible corners are per item, not container config.** `ConfigFieldSpec` is
`'number' | 'boolean' | 'string' | readonly string[]`, where the array form is an enum of allowed
*scalars*, and `checkStrategyConfig` reports unknown keys — so a list-valued config key both fails
validation and cannot be declared. They live on `meta.snapCorners`, which is the better semantics
anyway: `LayoutItem.meta` *is* the `membership.placement` bag where `pinned` already lives, and two
floating panels in one container can differ. Container config keeps only the scalars `inset`,
`snapThreshold` and `defaultAnchor`.

windease owns this state and its snapshot shape. It does not choose where the snapshot is written;
that is the host's, and is what labkit's `storageKey` names.

**Snapping.** Nearest eligible corner within **12px, measured per-axis** (`dx <= 12 && dy <= 12`),
resting at **12px inset**. Per-axis is not a stylistic choice: with a 12px inset the resting position
is (12, 12) from the corner, and shoving the panel hard into the corner clamps it to (0, 0). By
radius that is 16.97px away and does not snap; per-axis it is 12 on each axis and does. The gesture
that most clearly means "snap here" is the one a radius metric rejects.

Dropping outside every zone leaves the panel where it was released. At a 12px threshold the zones are
small, so free placement is the common case.

**Two constraints the existing contract imposes:**

- **Motion comes from `dx`/`dy`, not `payload.point`.** The `LayoutEvent` doc reserves `point` for a
  strategy whose extents are *quantized*, where a few pixels round to no change and deltas never
  accumulate. A floating position is continuous pixels, so deltas accumulate exactly — and the
  `{ x, y, anchor }` shape above is what makes that true even while snapped. Resolving against
  `point` would need the previous event's pointer held in state, and with no drag-end event to clear
  it the next gesture's first move would measure against where the last one ended and teleport the
  panel. It would also persist per-gesture data into state that snapshots.
- There is no drag-end event. The snap is therefore **live during the drag**, committing wherever the
  pointer is released, rather than resolving on release.
- **The affordance is a band, not the whole panel** — for `<Container>` hosts. windease renders each
  affordance as an interactive `div` at its rect, `z-index: 1`, pointer events on, so one spanning
  the panel would swallow the panel's own clicks; `handleSize` confines it. labkit's `FloatingPanel`
  sidesteps this entirely by driving the strategy as a pure function and owning pointer handling
  itself, so it keeps drag-from-anywhere.

**Z-order is deferred.** `LayoutResult` carries no stacking order, so nothing guarantees a floating
item renders above a tiled one; that falls to the host's render order. Recorded in windease's
`TODO.md` under "Floating chrome over a tiled zone".

## `FloatingPanel` (labkit)

A thin React shell binding the strategy to DOM. Consumer-facing config only:

```tsx
interface FloatingPanelProps {
  children: ReactNode;
  anchor?: Corner;          // resting corner before first drag; default 'bottom-left'
  snapCorners?: Corner[];   // eligible corners, written to meta.snapCorners; default all four
  inset?: number;           // default 12
  storageKey?: string;      // slot for windease's snapshot; omit for ephemeral
  className?: string;
}
```

`storageKey` is where the panel writes the strategy's snapshot, through labkit's existing
`localStorageAdapter`. The snapshot's *shape* is windease's; only its location is labkit's.

There is no header, so a pointerdown anywhere starts a drag. Pointerdowns on `input`, `button`, `a`
or `[data-no-drag]` are ignored so later tenants can hold controls.

## `Legend` (labkit)

```tsx
type LegendMark = 'line' | 'dash' | 'dot' | 'band';

interface LegendEntry { key: string; label: string; color: string; mark?: LegendMark }
interface LegendProps { entries: LegendEntry[]; className?: string }
```

Purely presentational — no handlers, no hover behavior, no internal state. Renders a `<ul>`; each
swatch is `aria-hidden` and the label carries the accessible text.

`mark` exists because the corner lab's inks are not all strokes: the bend floor is a dashed circle,
`authored` is dots, `replaced` is a translucent band. Drawing all four as line swatches would
misdescribe three of them.

## Mounting it in the corner lab

Three constraints imposed by `lk-canvas-stack`, all of which fail quietly if missed:

1. **The panel must be a direct child of the overlay.** `.lk-canvas-stack__overlay` is
   `position:absolute; inset:0` and is the containing block. Nested inside `.junction` — which is
   `width:max-content` pinned top-left — the panel would position against that box, not the canvas.
2. **Direct child again, for pointer events.** The overlay is `pointer-events:none` with `auto`
   restored only on `> *`.
3. **The drag must `stopPropagation()`.** The stack owns pan/zoom on the same pointer events;
   without it, dragging the panel also pans the camera underneath it.

So `render` returns a fragment, with the panel as a sibling of `.junction`:

```tsx
render: ({ state }) => (
  <>
    <div className="junction">…</div>
    <FloatingPanel storageKey="corner-lab.legend" snapCorners={['top-right', 'bottom-left', 'bottom-right']}>
      <Legend entries={LEGEND} />
    </FloatingPanel>
  </>
)
```

`top-left` is excluded because `.junction`, the measures readout, already occupies it.

`LEGEND` is defined beside `INK` in `instrument.tsx` and reads its values, so a color cannot be
changed in one place and go stale in the other. Seven entries: `bad` (`#d1453b`) is omitted because
it only ever colors the measures list, never the drawing.

## Tests

windease:

- a floating item is placed from state; tiled items reach the inner strategy against the full container
- an inner strategy's own placements are unchanged by the wrapper
- a drag whose accumulated position lands within 12px per-axis of an eligible corner sets `anchor`
- the shoved-into-corner case — pointer at (0, 0) with inset 12 — snaps; this is the regression test
  for the per-axis metric
- a corner absent from config never captures
- a position past the threshold clears `anchor`, and is clamped when the container shrinks
- a slow drag out of a snapped corner escapes rather than re-snapping every event
- state round-trips through a snapshot

labkit:

- `FloatingPanel` renders at the anchored corner before any drag
- a pointerdown on a `[data-no-drag]` child does not start a drag
- `storageKey` writes and restores the strategy's snapshot, anchored and free alike
- `Legend` renders one row per entry with the mark class matching `mark`

klieg:

- every `INK` key drawn on canvas has a `LEGEND` entry and the reverse, excluding `bad`

That last one is the anti-drift check and the likeliest of these to catch a real future bug.

## Sequencing

Cannot be one commit:

1. `floatingStrategy` lands in `windease`; publish `1.3.0`.
2. `FloatingPanel` + `Legend` land in `weasel/packages/labkit` against that; publish
   `@weasel-js/labkit@1.2.0`.
3. Bump klieg's labkit dependency off `^1.1.0` and compose it in the corner lab.

Until each publish, the consumer below can only see the work through `npm link`.
