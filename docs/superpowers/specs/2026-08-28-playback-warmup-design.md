# Playback warmup and cross-fire caching — design

**What:** move the cost of a mount off the critical path, and stop rebuilding geometry two fires in
a row already built.
**For:** whoever implements this in `@klieg/core`.
**Answers:** where the time between `fire()` and the first painted frame actually goes, which of it
can be cached, which of it can only be moved earlier, and what the API gains.

## Where the time goes

Measured on an M2 Max (ANGLE/Metal), `'JACKPOT!'`, 8 letters. Two columns because they are two
different situations, not a spread: a browser process that has never linked these programs pays the
driver's cost, and one that has pays almost nothing.

| | cold process | second load |
|---|---|---|
| font fetch + parse | 11.0ms | 5.3ms |
| `new WebGLRenderer` | 13.6ms | 9.3ms |
| `buildEnvironment` (PMREM) | 296.0ms | 25.6ms |
| `new Word` (gold) | 12.4ms | 12.1ms |
| `renderer.compile` | 1.9ms | 1.7ms |
| first `render` (gold) | 138.0ms | 11.1ms |
| second `render` | 0.3ms | 0.2ms |

Repeat fires within one mount, same run: a second gold word costs 5.6ms to build and 10.6ms to
first render; a tubing word costs 14.8ms and 192.4ms the first time, 10.6ms and 18.1ms the second.

Three things follow.

**The mount dominates, and the mount is not once per instance.** `idleTimeoutMs` defaults to 8s and
unmounts the renderer, so a page that fires less often than that pays context creation, the PMREM
prefilter and every program link on *every* fire.

**`renderer.compile()` is not where programs link.** It reports 1.9ms and then the first `render()`
costs 138ms. The link is the driver's, it lands on the first draw, and no JS-side cache reaches it —
only doing it earlier does.

**Program link is per look.** After gold has rendered, tubing's first render still costs 192ms cold
and 18ms warm. Warming one look does not warm another.

Against that, the geometry build is small: `spikes/fire-build-cost.mjs` puts extrusion at 6.7ms per
fire for `'JACKPOT!'` and 18.6ms for a 43-character sentence, and tube blueprints at 5.6ms and
21.8ms. Real, worth taking, but not the reason a fire is late.

## Two warms, split by what survives an unmount

### Persistent: the caches

`GlyphCache` is a `Word` field today (`render/word.ts:241`), so it dies with the word and the next
fire re-extrudes the same glyphs. Hoist it to the instance, keyed `(font, char, depth)` — `font` is
in the key now because the font registry will make it vary, and a key that discriminates only what
it currently needs to is a trap for that work.

Add a second instance cache for tube blueprints, keyed `(font, char, depth, seed)`. The seed is the
letter slot, which is why blueprints cannot be shared between two letters of one word — but the same
word fired again produces the same slots, so they are shared across fires, which is where the 21.8ms
is.

Both survive an unmount: a `BufferGeometry` is CPU-side and re-uploads to the next context. Verified
directly — geometry built under one renderer, that renderer disposed and its context force-lost,
then the same geometry drawn under a fresh renderer: 284 triangles both times, 2.4ms to re-upload.
Nothing else in the pipeline has that property, which makes these caches the only part of a warm
that persists.

### One-shot: the GL side

On a `requestIdleCallback` after `createKlieg`, mount the stage, build the environment, and render
one throwaway glyph to force the program link.

**A warm mount must arm the idle teardown.** `mount()` cancels the idle timer
(`render/stage.ts:137`) and only a settled effect re-arms it (`index.ts:552`), so warming without
this change holds a GL context forever on a page that constructs klieg and never fires. Arming it
makes the warm a bet that a fire is coming, with the existing 8s timer capping the loss when the bet
is wrong.

**The throwaway draw goes to a 1×1 render target, never the canvas.** `mount()` appends a canvas to
the page, so a link-forcing draw to the default framebuffer would paint a stray glyph for one frame
seconds before anything was fired. A one-pixel target links the same programs and shows nothing.

The warm fires no effect and is skipped entirely where the instance is unsupported.

## API

One field:

```ts
interface KliegOptions {
  /** The look whose shader programs the warm links. Defaults to 'gold'. */
  warmLook?: Look;
}
```

Because the link is per look and the warm happens before any `fire()`, klieg cannot know which look
to link unless the host says. A host that only ever fires neon and gets `'gold'` linked has paid for
a warm that bought it nothing.

No new method. A host that wants to control the instant is asking for a different feature — see
below.

## Testing

Vitest has no GL, so the assertions are the CPU half and the scheduling:

- Two fires of the same text receive the same geometry object, not an equal one.
- The cache survives an unmount, and a fire after one re-uses rather than rebuilds.
- Each of `font`, `char`, `depth` and `seed` alone changing produces a different entry. A key that
  ignores one silently returns another font's glyph, which is a wrong picture rather than an error.
- The warm arms the idle teardown, and an instance that warms and never fires unmounts.
- The warm runs once; a `fire()` arriving before the idle callback does not produce two mounts.
- An unsupported instance does not warm.

GL-side numbers stay measurable through `apps/lab/mount-cost/`, which is dev-only — it is not in
`vite.config.ts`'s build inputs, so it does not ship with the lab.

## Deferred

**Prebaking the environment.** It is the largest number on the table and it is fully deterministic —
a const bar array and a const blur sigma, no inputs. Whether it can be *eliminated* rather than
moved depends on three being able to load an already-prefiltered PMREM without re-running the pass,
which is unconfirmed. Check that before designing around it.

**A host-driven `warm()`.** sherpa knows which page it is swapping to before it swaps, so it could
warm the right look at the right instant instead of at construction. Worth having, but it is a
second surface to document and the automatic warm covers the common case; let a real need for the
instant justify it.
