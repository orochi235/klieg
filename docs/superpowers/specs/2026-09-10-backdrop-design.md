# The backdrop: rows of the word behind the word

**For:** whoever works on `index.ts`'s fire path or `effects/` next. **Answers:** what a backdrop
is, why the rows cost nothing to build, and what is still unmeasured.

A backdrop is the sign repeated in rows behind the fired word — tilted, dimmed, running an effect
that crawls across the rows. It is not tied to a look: any look and any effect can be used this
way.

```ts
fire('FUCK YOU TRAVIS', {
  look: 'gem',
  backdrop: {
    rows: 7,
    look: 'tubing',
    effects: [{ piece: 'chase', target: { kind: 'run' }, stagger: { from: 'line' } }],
    transform: fromEuler(0, 0, -12 * DEG),
    scale: 1.6,
    dim: 0.35,
  },
});
```

## What it is made of

A second `Word`, added to the scene behind the hero. Its text is the hero's repeated on `rows`
lines unless `text` overrides it.

It never receives the motion slots. No enter, no active, no exit — it is placed once and runs only
its effects, so it is already at full presence when the hero arrives over it.

`scale` is a multiple of the hero's fitted size, so the rows can overfill the frame and the tilt
does not expose a corner. `dim` scales the backdrop's frame-owned base, not the effect layer. Applied through `gain` it would
be one contribution among several and any effect writing `gain` would fight it; applied to the base
it is what every effect then modulates, so a chase still reads at full contrast against a dimmed
row.

## Rows are lines

No new layout. The multi-line block, `PartInfo.line` and `lineCount`, and `stagger`'s grid ordering
all exist already. The one missing piece is `from: 'line'` in `orderKey`, ordering parts by row
instead of by reading order. It is general: any effect then crawls across the rows, which is what
keeps this from being a tubing feature.

On a single-line block `from: 'line'` degrades to reading order, so nothing already written moves.

## The backdrop must share the hero's caches

Measured with `spikes/fire-build-cost.mjs` on "FUCK YOU TRAVIS", 15 letters:

```
shared cache, fire 1/7:  5.5ms
shared cache, fire 2/7:  0.0ms
   ...
shared cache, fire 7/7:  0.0ms
```

Every glyph extrusion and every tube blueprint the first row builds is already cached for the rest,
so rows beyond the first are free to build. This is a constraint, not a nicety: constructed with a
cache of its own, each row pays a full rebuild and seven rows block the main thread for around 40ms
before the first frame.

## What is not yet measured

The per-frame cost, which is the real risk and is not the build. Seven rows of fifteen letters is
seven times the part pool, and the effect compositor evaluates every part every frame. On `tubing`
a letter is many runs, so this may be thousands of `at()` calls per frame.

`rows` is capped at whatever a browser measurement supports. That measurement happens during
implementation; no cap is picked here, because a number chosen now would be a guess wearing a
limit's clothes.

## Reduced motion

The backdrop is placed and static. The rows are composition; the crawl is motion.

## Testing

Backdrop and hero share one cache and the second word builds no new geometry. `from: 'line'` orders
parts by row and degrades to reading order on a single-line block. The backdrop takes no pose from
the motion slots. `rows: 1` is an ordinary second sign.

## Depends on

Nothing here needs [`cycle`](2026-09-10-cycle-effect-design.md), and `cycle` does not need this. The
two meet only in that a backdrop's `effects` list may hold a `cycle` piece like any other.
