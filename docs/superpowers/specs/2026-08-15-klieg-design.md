# klieg — design

**What:** a transparent WebGL layer that renders shiny extruded 3D type over an existing web
app, for game-show celebration moments.
**For:** developers of any web app; `wod` (spinning name wheel) is the first consumer.
**Answers:** what klieg's public surface is, how it renders, and what it deliberately won't do.

**Status, 2026-10-07: core built; two parts never were.** No `klieg-react` package exists, and in-engine particles were replaced by `attach(SceneLayer)`, which lets a host draw its own. The `{ kind: 'anchor' }` placement shipped as `'element'`.

Two words. A *blit* is a bit-block transfer, the copy-a-rectangle-of-pixels operation the
composite step performs. A *klieg light* is the carbon-arc lamp that lit early film studios,
and the synthetic one this library builds is where all the shine comes from.

## Public API

```ts
const bk = createKlieg({ target?: HTMLElement })   // defaults to document.body

bk.fire('JACKPOT!', {
  enter:  'slam',        // slam | spin | flip | assemble | rise | none
  active: 'sweep',       // sweep | float | pulse | shimmer | none
  exit:   'shatter',     // shatter | drop | recede | fade | none
  look:   'gold',        // gold | chrome | oil | ruby
  hold:    1200,         // ms in the active phase
  bloom:   false,        // opt-in glow; see Render paths
  placement: { kind: 'fullscreen' },
}): Promise<void>        // resolves when the effect finishes

bk.supported              // false where WebGL2 is unavailable
bk.destroy()
```

Motion is three independent slots, not one named effect. An arrival and an idle behavior are
different kinds of thing and don't belong in one vocabulary — `slam` describes how the text
gets there, `sweep` describes what it does while it sits. Split this way, 13 tuned pieces
cover 80 combinations; fused, the same coverage takes 80 presets.

`look` (material) is orthogonal to all three.

Placement is a closed union so element-anchoring can arrive without an API break:

```ts
type Placement =
  | { kind: 'fullscreen' }              // v0 — centered, fitted to the window
  | { kind: 'anchor', el: Element }     // v1.2 — not implemented
```

`fullscreen` here means "positioned against the window," not the browser's Fullscreen API.
klieg never calls `requestFullscreen`.

## Packages

```
packages/core    klieg          vanilla three.js, imperative, no framework
packages/react   klieg-react    thin binding, no logic of its own
apps/lab         Vite demo page
```

npm workspaces, TypeScript, Biome, Vitest — matching `weasel` and `windease`.

Only `three` is a runtime dependency, plus `opentype.js` for fonts.

## Render paths

Two, selected by the `bloom` flag:

**Direct (default).** Scene renders straight to the canvas. Native MSAA, no render target,
no post-processing. Cheaper and sharper.

**Bloom (opt-in).** Scene → render target → luminance threshold → separable blur → composite.
Required for glow, and the reason the composite shader below exists.

The default is direct because glow is a want, not a requirement, and the direct path is
strictly better on both cost and edge quality.

## Decisions

**Fonts are parsed at runtime with opentype.js, not preconverted to typeface.json.**
three's `TextGeometry` requires a build-time conversion that discards kerning, which is
plainly visible on short all-caps words — exactly what klieg renders. opentype.js reads
`.ttf`/`.otf` directly, keeps kerning pairs, and removes the build step. Glyph geometry is
cached by `(font, char, size, bevel)` since letters repeat heavily.

**The environment map is generated at runtime, not shipped as an HDRI.**
A polished metal surface has almost no color of its own; what reads as gold is the
reflection. klieg builds a small cubemap from a dark gradient and a handful of bright bars —
a synthetic photo studio. Two consequences: nothing to download (real HDRIs are 2–50MB), and
the bars are movable. Sliding a bright bar across the letters *is* the `sweep` effect.

**Effects were a closed set in v0.** Superseded by the motion authoring design doc, which opens
`MotionPiece` as public API. The risk this recorded was real but misattributed: it is reaching
three.js internals that would make them klieg's API permanently, and `MotionPiece` takes a
number and returns a plain object without naming three at all.

**Phases compose additively over a resting pose.** Each of `enter`, `active`, and `exit`
contributes an *offset* — position, rotation, scale, material deltas — accumulated onto the
rest pose, rather than writing absolute transforms. Absolute phases snap at every handoff:
the word jumps the instant `enter` finishes and `active` takes over, and again into `exit`.
Boundaries additionally crossfade over a short window so a phase's tail overlaps the next
phase's head. This is the difference between motion that reads as designed and motion that
reads as cheap, and it is invisible in a single-phase prototype because nothing hands off.

## Traps

Each of these fails silently — nothing throws, the output is just wrong.

**`antialias: true` does nothing under post-processing.** It applies to the default
framebuffer only and is ignored once rendering goes through a `WebGLRenderTarget`. The bloom
path needs `samples: 4` on the target. WebGL2 only.

**Bloom destroys canvas transparency.** A stock bloom pass forces alpha to 1.0 across the
frame, turning the overlay into an opaque black rectangle over the host app. klieg's
composite instead derives alpha from glow luminance:

```glsl
outColor = base.rgb + bloom.rgb;
outAlpha = max(base.a, luminance(bloom.rgb) * alphaBoost);
```

Without the second line the glow lives entirely outside the letters' silhouette, where
`base.a` is 0, and is never seen.

**Set `premultipliedAlpha: false` on the renderer.** The default expects RGB pre-scaled by
alpha; a straight-alpha composite against it produces bright halos.

**Color-valued material params are `THREE.Color` objects.** Assigning a hex number over
`material.color` replaces the object and the material stops working. They must go through
`.set()`. This makes `Object.assign(material, params)` unsafe.

**`iridescence: 1.0` does not produce a rainbow.** It sets how much of the thin film shows;
the color range comes from `iridescenceThicknessRange` sweeping a wide nm band. A clearcoat
layered above the film flattens it — `oil` needs `clearcoat: 0`.

## Non-goals

- **Particles** — deferred to v1.1. Until then, consumers layer `canvas-confetti` beneath the
  klieg canvas; confetti will always be behind the letters, never passing in front. Recovering
  that occlusion is the whole reason particles eventually move in-engine.
- **Refracting page content.** Translucent looks refract the environment map only. three's
  transmission samples what is behind the object *in the WebGL scene*, and the DOM is not in
  it. Real refraction would mean rasterizing the page every frame.
- Sound, screen shake, element-anchored placement.
- **Precompiled single-effect builds.** A build-time path where a consumer compiles one fixed
  phrase in one fixed style and ships a library that can say only that, trading the runtime look
  and motion vocabulary for payload. Unscoped, and worth revisiting once the vocabulary stops
  growing.
- **Handwriting animation.** Drawing a glyph the way a hand would write it needs the stroke
  *centerline*, its segmentation into pen strokes, and a stroke order — none of which a font
  outline carries. It is tractable from a single-stroke font (Hershey and engraving fonts are
  centerline data by construction) or from stroke paths authored once per typeface; it is a
  research project from outlines alone. It also shares nothing with this library's premise:
  a matte 2D line has no surface for the environment map, so the looks, the klieg light and
  the bloom path all do nothing for it. If it gets built it is a second renderer on a shared
  overlay harness, not a look.

## Lifecycle

One canvas, one WebGL2 context, created lazily on first `fire()` and torn down after an idle
timeout — browsers cap contexts near 16. `pointer-events: none` throughout. Effects queue
serially by default (`queue | replace | concurrent`). `prefers-reduced-motion` renders the
final frame statically. Without WebGL2, `fire()` resolves immediately and `supported` is false.

## Testing

Animation reads time from an **injected clock** rather than `requestAnimationFrame` directly.
Nothing below is testable without this.

- Vitest over the parts that break silently: kerning and layout math, placement math, queue
  state machine, easing curves.
- Playwright screenshots at fixed clock values for visual regression on the composite shader.

## Status

The material and composite work is validated by `spikes/material-and-composite.html`
(120fps at 1280×800 on both render paths). The spike uses typeface.json fonts, so it does not
exercise the opentype.js decision.

The spike's **motion is not validated**. It carried a `backOut` curve whose two constants were
identical, which cancels at t=0 and pins the curve to the range [1.0, 1.281]. Its "slam"
therefore held final position and bulged toward the camera rather than arriving from depth.
Judgements formed from the spike cover material, environment, and composite only.

Easing was a closed set in v0. `Easing` is `(t: number) => number` and motion pieces call curves
by reference, which is what let the motion authoring design doc export the type and accept
caller-supplied curves without touching a piece.
