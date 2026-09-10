# The backdrop: rows of the word behind the word

**Built.** `FireOptions.backdrop`, `MAX_BACKDROP_ROWS` and `stagger: { from: 'line' }` are in
`packages/core/src/index.ts` and `motion/types.ts`; the README section is *The backdrop*.

**For:** whoever works on `index.ts`'s fire path or `effects/` next. **Answers:** what a backdrop
is, what the rows cost to build and to draw, and where the cap comes from.

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

Every glyph extrusion the first row builds is already cached for the rest, so rows beyond the first
are free to build. This is a constraint, not a nicety: constructed with a cache of its own, each row
pays a full rebuild and seven rows block the main thread for around 40ms before the first frame.

A tube blueprint is the exception, and the figures above do not cover it. Its cache key carries the
letter slot as well as the character, and every row's letters take fresh slots — so a `tubing`
backdrop builds a blueprint per letter per row however the cache is shared. The numbers above are a
repeat fire of the same word, where the slots line up; extra rows are not that case.

## What a frame costs

The per-frame cost was the real risk, and it is the look's, not the row count's. Measured with
`spikes/backdrop-frame-cost.mjs` on "JACKPOT JACKPOT", 15 letters, a chase staggered by line,
90 timed frames each:

```
look     rows  median    p95
gold        1    0.10   0.20
gold        7    0.30   0.40
gold       16    0.40   0.50
tubing      1    3.80   4.50
tubing      4   10.40  11.30
tubing      7   17.40  18.50
tubing      8   19.60  20.90
```

`gold` addresses one body part per letter and barely notices the rows. `tubing` addresses many runs
per letter, costs about 2.2ms a row, and passes a 60Hz frame's 16.7ms between 6 and 7 rows. The
same sweep on a software rasterizer landed within 0.3ms of these numbers at every point, so this is
the compositor and the run-color buffer writes rather than the draw — it does not improve on a
faster GPU, and it gets worse on a slower CPU.

`rows` is therefore capped at 12 as a guard on the allocation rather than as a frame budget: it
sits above what the cheap looks manage comfortably and well above what the expensive ones can
afford, and a caller wanting more than that is asking for wallpaper and should say so with `text`.

## Reduced motion

The backdrop is placed and static. The rows are composition; the crawl is motion.

## Testing

Backdrop and hero share one cache and the second word builds no new geometry. `from: 'line'` orders
parts by row and degrades to reading order on a single-line block. The backdrop takes no pose from
the motion slots. `rows: 1` is an ordinary second sign.

## Depends on

Nothing here needs [`cycle`](2026-09-10-cycle-effect-design.md), and `cycle` does not need this. The
two meet only in that a backdrop's `effects` list may hold a `cycle` piece like any other.
