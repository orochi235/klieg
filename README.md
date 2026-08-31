# klieg

Shiny extruded 3D type, slammed over the web app you already have — the `JACKPOT!` that lands
on screen when something worth celebrating happens. It draws into its own fixed, click-through
canvas above the page, plays one effect, and gives the WebGL context back when it goes idle.
The host page is not touched.

An effect is three motion slots — `enter`, `active`, `exit` — plus a material `look`.

Every effect is playable at **[the lab](https://orochi235.github.io/klieg/)**, which is
deployed from `main`.

## Install

```sh
npm install klieg three
```

`three` is a peer dependency, so the app owns the copy: two copies of three in one bundle break
`instanceof` and double the download. Any version from 0.185 up will do. The package is
ESM-only, and ships as `dist/` with type declarations.

TypeScript users also want `npm install -D @types/three` — three ships no declarations of its
own, and klieg's types reference it.

## Usage

```ts
import { createKlieg } from 'klieg';

const bk = createKlieg({ fonts: { display: '/fonts/display.ttf' } });

await bk.fire('JACKPOT!', { enter: 'slam', active: 'float', exit: 'shatter', look: 'gold' });

bk.destroy();
```

`fire()` resolves once the effect has left the screen, whether it played out or was cancelled.
It rejects if the font cannot be fetched or parsed — the next `fire()` retries the load rather
than failing forever. A `font` naming nothing in `fonts` throws where you call it, listing what is
registered: that is a typo in your own code, not a runtime condition to handle. `destroy()` cancels everything in flight and releases the GL context once
the running effect has settled.

`onPhase` reports the boundaries inside an effect. `{ phase: 'active' }` is the instant the word has
landed and is at full presence — the moment to swap a page behind an established flourish rather
than during its arrival. The instants are not fixed when you fire: a `'click'` hold has no exit
until the press lands.

```ts
await bk.fire('RESULTS', {
  hold: 'click',
  onPhase: (e) => {
    if (e.phase === 'active') swapThePage();
  },
});
```

## Motion

An effect plays `enter`, then loops `active` for `hold` milliseconds, then plays `exit`,
crossfading `blendMs` across each boundary. Enter and exit run at a fixed length per piece
(500–1200ms), so total screen time is about enter + `hold` + exit.

### enter

| name | |
|---|---|
| `slam` | the whole word punches forward out of depth and overshoots as it lands |
| `spin` | letters whirl in around their vertical axis, one after the next, fading up |
| `flip` | letters tip forward over their horizontal axis, one after the next |
| `assemble` | letters converge on the word from scattered positions and tumbling angles |
| `rise` | letters lift into place from below, one after the next, with a small overshoot |
| `none` | the word is simply there |

### active

| name | |
|---|---|
| `float` | a slow bob and yaw, as if the word were hanging |
| `pulse` | a gentle scale breath, a few percent |
| `shimmer` | a small yaw ripple travelling letter to letter |
| `none` | dead still |

### exit

| name | |
|---|---|
| `shatter` | letters fly apart tumbling, fading as they go |
| `drop` | letters fall out of frame under gravity, tipping alternately |
| `recede` | the word shrinks back into depth and fades |
| `fade` | fades out with a slight swell |
| `none` | cuts |

### look

| name | |
|---|---|
| `gold` | warm polished metal |
| `chrome` | near-white mirror metal |
| `oil` | near-black metal under an iridescent thin film |
| `gem` | clear stone, lit through, dispersing to rainbow at the edges |
| `velvet` | deep matte nap, bright at grazing angles |
| `neon` | glowing tube-lit sign; turns bloom on by itself |
| `flake` | dark body shot through with catching flecks |
| `glitter` | fine metallic sparkle, close to car paint |
| `leather` | upholstery panels, creased at the seams |
| `tubing` | glowing tube piped around a near-invisible volume; turns bloom on by itself |
| `piping` | corded seam running the edge of a hide |
| `sequin` | discs sewn flat in staggered rows, catching light as they tilt |

### lighting

The environment is what makes metal read as metal, and it is independent of all three motion
slots.

| name | |
|---|---|
| `sweep` | rakes the highlight across the letters, on its own period |
| `static` | holds the environment still |
| `pointer` | aims the highlight wherever the cursor or finger is; `static` until one arrives |

The slot takes a piece instead of a name, or an array mixing both — `sweep({ periodMs })`,
`still()` and `track({ yawRange, pitchRange, followMs })` build one. Layering here is not
`active`'s: each piece keeps its own `duration` rather than sharing the slot's, so the pieces run
on unrelated clocks with nothing holding a phase between them.

Layered pieces add per axis, so two that write the same axis give you one motion rather than two
you can pick apart: `['sweep', sweep({ periodMs: 1000 })]` is a single uniform turn at the summed
rate, once every 773ms. Layer pieces that write different axes — `['sweep', track({ yawRange: 0 })]`
rakes on the clock while the pointer tips the pitch.

All of these turn the one shared environment. For light on the letters near a position instead —
a pool the cursor carries across the word — put a `lamp` in `effects`.

Each list is also exported as a runtime array — `ENTER_NAMES`, `ACTIVE_NAMES`, `EXIT_NAMES`,
`LOOK_NAMES`, `LIGHTING_NAMES`, `POLICY_NAMES` — for building a picker.

### tint

`tint` recolors any look to your own color, keeping everything else about the material:

```js
await bk.fire('YOU WIN', { look: 'gold', tint: 0xff2d6f });   // pink metal
await bk.fire('YOU WIN', { look: 'gem', tint: 0x2dff8f });    // green stone
```

It goes to whichever property actually carries that look's hue. For the metals that is the base
color; `gem` is clear stone whose red comes from what light picks up passing *through* it, and
`neon` is a near-black body whose color is entirely its glow, so tinting either one's base color
would change nothing you could see.

A function is consulted per letter instead, and may return `undefined` for "not mine", leaving
that letter the look's own color:

```ts
tint: (l) => (l.column === 0 ? 0x2df0ff : undefined)
```

`look` also takes a plain object instead of a name, for a material of your own:

```js
await bk.fire('YOU WIN', { look: { metalness: 1, roughness: 0.3, color: 0x00e5ff } });
```

Every field is a number, so nothing about three appears in your types. Out-of-range values clamp
rather than throw. `tintTarget` overrides which channel `tint` writes to when the default
routing guesses wrong.

### gradient

`tubing` and `piping` draw a letter as tube followed around the glyph and cut into runs — some lit,
one flat color each from the look's palette, the rest dark glass. `gradient` sweeps a color ramp
across the lit ones instead of leaving each flat. The tubing is a `TubeSpec`, the `decoration` on
either look's spec:

```ts
import { specOf, type TubeSpec } from 'klieg';

const tubing = specOf('tubing');
const tube = tubing.decoration as TubeSpec;

await bk.fire('OPEN', {
  look: {
    ...tubing,
    decoration: {
      ...tube,
      gradient: {
        domain: { of: 'run' },
        stops: [0x8a1250, 0xff5cb0, 0x8a1250],
        mode: 'replace',
      },
    },
  },
});
```

That is dim at each tube's ends and hot in the middle, which is what a real tube does.

`domain` is what the ramp is measured along:

| domain | |
|---|---|
| `{ of: 'run' }` | 0 to 1 along each run, restarting at every one |
| `{ of: 'letter' }` | 0 to 1 across each glyph's lit tube, run to run |
| `{ of: 'runIndex' }` | one value per lit run, in run order; flat within a run |
| `{ of: 'surface' }` | one value per entry in the spec's `surfaces`, so it is flat on the front-only built-ins |
| `{ of: 'axis', angle }` | position across the whole word; `angle` in degrees, 0 is +x and 90 is +y |
| `{ of: 'radial', at }` | distance from `at`, a fraction of the word's bounds, `[0.5, 0.5]` by default |

`stops` are sRGB hex and interpolate in linear space, so a pink-to-cyan fade does not pass through
gray. Two is a fade, more is a ramp. `mode: 'replace'` paints the ramp; `'modulate'` multiplies each
run's own color by it, keeping the look's palette and shading it — under `modulate` the stops are
multipliers, and one below about `0x555555` reads as a dead tube rather than a shaded one.

Omit `gradient` and every run is flat, which is what the built-in looks do. `tubing` also blooms by
itself, and the glow fills a dim tube end, so a ramp that darkens its ends reads flatter than it is;
`bloom: false` shows it plainly.

### effects

Effects drive a sign's appearance over time, below the level of a letter. A `look` sets what every
letter is made of; an effect changes some *part* of it — one tube of a neon sign, not the sign. Set
them on a look with `LookSpec.effects`, or per fire with `FireOptions.effects`, which replaces a
look's own list rather than adding to it.

```js
import { fire, EFFECTS, roving } from 'klieg';

fire('JACKPOT!', {
  look: 'tubing',
  effects: [
    // One run of the whole sign, picked by seed, stutters like failing glass.
    { piece: 'flicker', target: { kind: 'run', by: 'index', count: 1 } },
    // Every run cycles colour together.
    { piece: 'hue', target: { kind: 'run', by: 'index', amount: 1 } },
  ],
});
```

| field | meaning |
|---|---|
| `piece` | a name from `EFFECT_NAMES`, or a piece from a factory so it can be tuned |
| `target` | `{ kind: 'run' \| 'body' }` plus a selection — `by` orders the pool (`'seed'`, `'length'`, `'index'`), `amount` takes a fraction of it and `count` a literal number of members, and `count` wins when both are given |
| `stagger` | per-part phase spread, the same spec `enter` and `exit` take |
| `seed` | fixes the selection, so a pinned frame is reproducible |

The pool is word-wide, so `{ count: 1 }` picks one bad tube in the sign rather than one in every
letter. A `body` part only reads brightness; colour reaches `run` parts only.

**`flicker`** — a tube on its way out. `EFFECTS.flicker({ depth, unrest, spell, calm, duration })`:
`depth` is the floor of its brightness, `unrest` the share of the pass spent stuttering. `spell` and
`calm` add the long scale — the milliseconds of one flickering bout and the milliseconds held steady
between them, so a tube can stutter for four seconds and sit quiet for fifteen. Both need the other,
and both snap to whole stutter steps; the pass then becomes the nearest whole number of cycles, which
may be longer than the `duration` asked for or shorter.

**`hue`** — a colour sweep across the sign. `EFFECTS.hue({ from, span, spread, luminance, duration })`,
in turns: `span` of 1 is the whole wheel and the only value that meets itself at the loop seam, and
`spread` offsets the hue along the word to make a travelling gradient rather than one synchronized
sign. The sweep holds Rec.709 luminance rather than saturation, so blues and violets come out paler
and the sign glows evenly all the way round — at constant saturation it would brighten through yellow
and fall out of the bloom threshold through blue.

**`roving(inner, { dwell, seed, epochs })`** — takes another piece and moves its affliction from one
part to another, so `roving(EFFECTS.flicker())` is one bad tube that jumps every few seconds. It is a
factory rather than a name, because a name cannot carry the piece it wraps. Give it `{ amount: 1 }`:
it picks its holder from the whole pool of that kind, so against a subset the fault can land on a
part the effect does not drive and nothing happens at all.

`dwell` is roughly how long one part keeps the fault, and it picks *who* flickers, not how much —
that is the inner piece's `unrest`. `epochs` is how many handovers fill a pass, and so the ceiling
on how many parts a pass can reach before it loops; the default of 96 covers a pool of 29 entirely
and most of a pool of 55, which is about as wide as a real sign gets. Raise it for a wider one.

**`lamp({ source, radius, strength, color, duration })`** — puts light on the parts near a position
rather than changing what they are made of. `radius` is its reach in em of layout space, `strength`
the light at the centre falling to nothing at that edge, and `color` the lamp's own, multiplied
against the look's hue. `source` says where the light is on each pass: `fromPointer()` is the
default and follows the cursor — the canvas's whole extent maps onto the word's ink, so the
cursor's whole travel is compressed onto the letters: the light runs ahead of the cursor at one end
of the sign and behind it at the other, and sits under it only where the ink fills the canvas.
`fixed(x, y)` pins the light, `orbit({ radius, x, y })` circles it, and `along([...])` walks a
polyline at constant time per segment rather than constant speed.
`duration` is one pass for the sources that read the clock, `orbit` and `along`, and does nothing
to `fixed` or `fromPointer`, which ignore it. A pointer source stays dark until the pointer has
been inside the canvas, so an untouched page gets no lamp rather than one parked at the origin.

**A lamp does not follow a `stages` regroup.** It lights by position, and the part pool is fixed at
construction, so after the letters re-lay the light still lands where they used to be — on a centred
sign that has dropped letters, a cursor over the type can light nothing at all. Combine the two and
the lamp is a silent no-op, not a smaller effect.

Effects layer. Brightness multiplies and colour is replaced, so `flicker` and `hue` compose without
either knowing about the other — but two pieces both writing colour fight, and the last one wins.
A hue piece writes colour every frame, which overrides `tint`: `tubing` tints its decoration, so a
hue sweep and a tint on that look are the same fight, and the sweep wins.

## Keeping an anchored sign alive

A sign anchored to a page element and held for hours is a different problem from a one-shot
flourish: its motion runs thousands of times while someone reads past it, so it has to be slow
enough to ignore. Name the [lighting](#lighting) either way — the default `sweep` turns the
environment every 3.4 seconds, a strobe on a masthead, and `'pointer'` never moves at all on a page
nobody has moused over. A sign meant to hold still asks for `'static'`, it does not omit the slot.
Four ways to keep one moving at a pace it can hold:

| | |
|---|---|
| `lighting: [sweep({ periodMs: 14000 }), track({ yawRange: 0 })]` | the highlight rakes on its own clock, and a pointer still tips the pitch |
| a `lamp` on an `orbit` source | a pool of light circling the word |
| `EFFECTS.hue({ span: 0.08, spread: 0.3 })` | a narrow color breath that stays near the sign's own tint |
| `active: 'shimmer'` | a yaw ripple letter to letter — the only one of the four that moves geometry |

```ts
import { lamp, orbit } from 'klieg';

await bk.fire('klieg', {
  look: 'tubing',
  hold: 40000,
  effects: [
    {
      piece: lamp({ source: orbit({ radius: 0.4 }), radius: 0.5, strength: 1.4, duration: 9000 }),
      target: { kind: 'run', by: 'index', amount: 1 },
    },
  ],
});
```

`look: 'tubing'` is load-bearing for that example: the target is a run, and only `tubing` and
`piping` have run parts — on `gold` it selects an empty pool and does nothing, silently. A lamp
lights body parts too, so the same one aimed at bodies works anywhere; `hue` is run-only. Build the
pieces in the call, too: `track` carries its yaw across frames, and a shared one resumes from the
last fire's angle rather than from rest.

**A `roving` pass that cannot reach the whole pool never will.** Its walk is identical every pass,
so a part it misses is never afflicted at all, however long the sign runs. Raising `epochs` past
the run count is necessary but not sufficient — handovers are deferred, so even the default 96
reaches 51 of a pool of 55, and the strays are an arbitrary slice of a seeded permutation.

**Geometry is the only thing the anchor's box crops**, and the margin is whatever `framing` left
unspent. `shimmer`'s few degrees of yaw survive most framings; a bob like `float`'s 0.12 em wants
real room. If it clips, *lower* the `framing` share — raising it fits a bigger word into the same
box and leaves less.

## Stages

An effect can exit part of its word and lay the survivors out again as a word of their own — a
poem whose first letters are their own color, then everything else leaves and those letters
gather into a word. `stages` is the list, played after the enter:

```ts
await bk.fire(poem, {
  hold: 'click',
  tint: (l) => (l.column === 0 ? 0x2df0ff : undefined),
  stages: [
    { keep: (l) => l.column === 0, exit: 'fade', as: 'stack', hold: 'click' },
    { as: 'line', hold: 'click' },
  ],
});
```

Each stage:

| field | default | |
|---|---|---|
| `keep` | keeps all | the letters that continue; the rest play this stage's `exit` |
| `exit` | `'fade'` | how the letters that do not continue leave |
| `as` | `'line'` | the survivors' new layout — one line, `'stack'` for one letter per line, or `'place'` to leave them exactly where they already are |
| `active` | `'none'` | what the new word does while it holds |
| `hold` | `1200` | milliseconds, or `'click'` to wait for the viewer |
| `tween` | none | timing for the move into the new layout |

Survivors keep their own material, so a letter's color travels with it, and they are renumbered
against the new word: `index`, `count`, `line`, `column`, `x` and `y` all describe it. A letter
playing its exit instead keeps what it read before the regroup and is marked `leaving: true`, so
its stagger stays coherent with the word it is leaving.

The per-letter form of [`tint`](#tint) is how the survivors get their own color.

`tween`:

| field | default | |
|---|---|---|
| `duration` | `700` | milliseconds for the move into the new layout |
| `ease` | `easeOutCubic` | curve the move runs on |
| `delayBy` | none | holds one channel back, as a fraction of a span (below) |

`delayBy.position` is a fraction of the move; `delayBy.scale` — the viewport refit — is a
fraction of the move or this stage's exit, whichever is longer, so it can wait out an exit that
outlasts the move. `delayBy: { scale: 0.45 }` lands the word before it grows to fill the screen.

Under `prefers-reduced-motion: reduce` the stages do not play — that path holds a pose and never
travels, so there is nothing to regroup.

### acronym

`acronym` is that effect pre-baked: type a block whose acronym is capitalised, and it renders with
the capitals picked out, holds to be read, drops the lower case where it stands, and gathers the
capitals into a line that stays until dismissed. The gather starts as the lower case finishes
leaving; `settle` puts a pause between the two.

```ts
import { acronym } from 'klieg';

await bk.fire(...acronym(`Keep
Lighting
Interesting, Every
Glowing letter`));
```

It returns the arguments to `fire()` rather than firing, so the look, lighting and queue policy stay
yours — spread the options and override whatever you like.

| field | default | |
|---|---|---|
| `caps` | cyan | how the capitals are styled, in the block and after they gather |
| `body` | the look's own colour | how everything else is styled while it is still up |
| `read` | `'click'` | the pause after the block renders, before the lower case leaves |
| `settle` | `0` | an extra pause after the lower case has gone, before the capitals gather |
| `hold` | `'click'` | how long the gathered acronym stays |
| `exit` | `'fade'` | how the lower-case letters leave |
| `active` | `'none'` | what the gathered acronym does while it holds |
| `tween` | none | timing for the gather |

`caps` and `body` are objects rather than colours — today each carries a `tint`, and taking an
object means a richer per-letter style can be added without changing the signature.

A capital is a character whose lower case differs from itself, so digits and punctuation are
dropped along with the lower case. `isCapital` is exported if you want the same test elsewhere.

## Writing your own motion

Every slot also takes a piece you built, or several layered together:

```js
import { spring, transition } from 'klieg';

const swoop = transition(800, {
  from: { position: [0, -6, 0], opacity: 0 },
  ease: spring({ stiffness: 180, damping: 11 }),
  stagger: { each: 0.06, from: 'center' },
});

await bk.fire('YOU WIN', { enter: swoop, active: ['float', 'shimmer'] });
```

Names and pieces mix freely in a layered slot — `active: ['float', myShimmer]`.

A `MotionPiece` is `{ duration, offset(t, letter) }` where `offset` returns a *relative* pose —
position and rotation add onto rest, scale and opacity multiply. It must be a **pure function**:
the compositor samples up to three pieces at three different points in the same frame to
crossfade them, so a piece that remembers anything between calls will tear.

`letter` says where that letter sits: `index` and `count` in reading order, `line`, `column`,
`lineCount` and `columnCount` in the block, and `x`/`y`, its layout position in em relative to
the block center — negate those to travel to the middle. `leaving: true` marks a letter a
[stage](#stages) has dropped, which is playing its exit and will not be back.

`transition(duration, spec)` builds an arrival or a departure. `from` starts displaced and
relaxes to rest; `to` starts at rest and departs. Either accepts a function of the letter, which
is how per-letter scatter stays deterministic and screenshots stay stable. `keyframes` takes N
stops instead. `ease` sets the curve, `easeBy` overrides it for one channel, and `stagger`
controls per-letter delay: `spread` fixes the total ramp, `each` fixes per-letter cadence, and
`from` picks the order — `start`, `end`, `center`, `edges` or `random`, with `grid: true`
measuring it radially over a multiline block.

`cycle(duration, spec)` builds a looping idle from a per-channel `amplitude`, an optional
`harmonic`, and a `phase` function. Motion moves the letters; to rake the environment highlight
instead, declare an env piece in [`lighting`](#lighting).

`spring({ stiffness, damping, mass })` returns a curve, not an animation — it is the closed-form
solution, so it stays a pure `(t) => number` and can go anywhere an easing goes.

`Easing` is exactly `(t: number) => number`, which is also `d3-ease`'s signature, so any curve
library drops straight in:

```js
import { easeElasticOut } from 'd3-ease';
const bounce = transition(700, { from: { scale: 0 }, ease: easeElasticOut });
```

## Options

`createKlieg(options)`:

| field | default | |
|---|---|---|
| `fonts` | required | the fonts this instance can set type in, by name: `{ display: '/d.ttf', body: '/b.ttf' }`. Each is a TTF or OTF opentype.js can parse, fetched on the first fire that names it and shared by every later one. A value may instead be `{ url, face }`, which takes one member of a `.ttc` collection by PostScript name. Much of what macOS ships is a collection, and `face` is what reaches inside one — though Helvetica, Times, Courier and Menlo unpack and then hit a separate opentype.js limit, their `cmap` being a format it does not read |
| `defaultFont` | first entry | which name a `fire()` with no `font` uses. Key order is what JS fixes for string keys, so reordering the object is what changes the default; name it here to stop depending on that |
| `fontUrl` | — | **deprecated.** `fonts: { display: url }` instead |
| `target` | `document.body` | element the overlay canvas is appended to; refused alongside an element `placement`, which is its own parent |
| `clock` | `requestAnimationFrame` | time source; pass the exported `ManualClock` to drive effects by hand in tests |
| `policy` | `'queue'` | what a fire does when one is already running (below) |
| `idleTimeoutMs` | `8000` | idle milliseconds before the GL context is torn down; the next fire brings it back |
| `warmLook` | `'gold'` | the look whose shader programs are linked on an idle callback after construction, so the first fire does not pay for them. The link is the driver's and lands per look: a page that only fires `neon` should say so, or the warm buys it nothing |
| `framing` | `{ width: 0.62, height: 0.3 }` | share of the box the type may fill, per axis — the viewport, or the anchor under an element `placement`; raise it on a page that is nothing but the type. `align: 'start' \| 'center' \| 'end'` places the word in the box at that size, in reading order: an anchored word meets the page's own text edge by default, an overlay stays centred |
| `placement` | `{ kind: 'fullscreen' }` | fullscreen overlay, or `{ kind: 'element', el }` to anchor the type inside one element; fixed for the instance's lifetime |

`warm(look?)` links a look's shader programs and returns a promise. The instance already does this
once on an idle callback after construction, so reach for it only when you know the instant — a
page swap that has decided which look it is about to fire pays the link before the swap instead of
inside it. It defaults to `warmLook`, resolves once the linking draw is issued, and never rejects.

```js
await bk.warm('neon'); // then swap the page, then fire
```

`fire(text, options)` — `text` is a string, or a list of styled runs (below):

| field | default | |
|---|---|---|
| `enter` | `'slam'` | how it arrives — a name, your own piece, or an array of them |
| `active` | `'none'` | what it does while it holds |
| `exit` | `'fade'` | how it leaves |
| `look` | `'gold'` | the material — a name, or a spec of your own |
| `lighting` | `'sweep'` | how the environment lights it — a name, an env piece, or an array of them; a `lamp` effect lights the letters instead of the scene |
| `tint` | none | recolors the look, as `0xff2d6f`, or a rule consulted per letter |
| `hold` | `1200` | milliseconds in the active phase, `'click'` to hold until dismissed, or `'forever'` to hold until `destroy()`; under an element `placement`, `'click'` needs either `clickAnywhere` on the placement or `dismiss: 'host'`, and `'forever'` is refused alongside `stages`, which it would never advance past |
| `stages` | none | stages played after the enter, each regrouping what survives it |
| `blendMs` | `120` | crossfade window straddling each phase boundary |
| `bloom` | look's choice | adds a glow pass, at the cost of three render targets while the effect runs |
| `wrap` | `false` | break long text into the arrangement that renders largest |
| `modal` | `false` | while a `'click'` hold waits, let the overlay swallow the dismissing press |
| `onPhase` | none | called as the effect crosses each boundary — `{ phase: 'active' }` when the word has landed, `{ phase: 'exit' }` when the hold is over, `{ phase: 'stage', index }` as each stage settles |
| `dismiss` | `'window'` | who dismisses a `'click'` hold; `'host'` attaches no window listeners and leaves `advance()` as the only way out |
| `signal` | none | aborts this one effect: no exit plays, and the promise resolves rather than rejecting |
| `selectable` | `'hidden'` | how the fired word appears in the DOM — copyable, findable and readable, or selectable (below) |

## A sign

Type that stands in for a heading, lights once and stays. `klieg/element` is a custom element, so
the page needs no framework and no code of its own:

```html
<klieg-sign font="/font.ttf" look="tubing" tint="currentColor">
  <h1>Your Name</h1>
</klieg-sign>
<script type="module">import 'klieg/element'</script>
```

Your heading stays in the page — readable before any script runs, selectable, findable, and in
the markup a crawler reads. The element anchors a canvas over its own box and turns the heading
transparent when the sign lights; with no WebGL, or no JavaScript at all, nothing happens to it.
It adds no DOM text of its own: the heading is the copy, and a second one would be announced twice
and match Ctrl+F twice. Give it a `text` attribute instead of a heading and it carries a hidden
copy, since then nothing else does.

One `<style>` in `@layer klieg` turns the heading transparent: `display: block; position: relative`
on the element, which anchoring needs, and `klieg-sign[lit] [data-klieg-fallback] { color:
transparent }`, where `[lit]` lands on the element and `data-klieg-fallback` on every child you
supplied. Being layered, that rule loses to *any* unlayered author rule — a plain `color` on your
heading leaves it standing over the lit sign, so put your own rule in a layer too.

Attributes: `font`, `text`, `look`, `tint`, `framing-width`, `framing-height`, `align`,
`lighting`, `bloom`. `tint` takes any CSS color, `currentColor` and `var(--x)` included, resolved
against the element, so a sign inherits your palette rather than repeating it. `bloom="false"` is
off and anything else, the bare attribute included, is on. Removing an attribute unsets what it
set rather than leaving the last value standing.

The `.look`, `.effects` and `.options` properties carry what an attribute cannot, `.options` being
a whole `FireOptions` merged over the rest. All three are read when the sign is built and again on
every attribute change, so set them before the element connects — assigning one to a standing sign
changes nothing until an attribute moves. Setting `.look` also opts the element out of the `look`
attribute: a later attribute change re-fires, still with the property's value.

The element imports klieg dynamically, so three.js arrives only when one connects.

For a page that would rather call a function, `klieg/sign` is the same behavior without the
registry, returning `{ lit, update, destroy }`:

```js
import { sign } from 'klieg/sign';

const heading = document.querySelector('h1');

sign(heading, {
  font: '/font.ttf',
  tint: 'currentColor',
  onLit: (lit) => heading.classList.toggle('lit', lit),
});
```

`onLit(true)` arrives **before** the word is built, not after: building blocks the main thread and
nothing paints during it, so a class added afterwards lands seconds late.

`font` has no default. Bundling a typeface is a licensing decision the library does not make for
its consumers.

For a static page with no bundler, `klieg/element/standalone` — `dist/standalone/klieg-sign.js` —
is the element, klieg and three inlined in one file a `<script type="module">` can load by itself.
It ships no declarations: it is a script tag's build, not one to import from TypeScript.

## Multiple lines

A `\n` in the text always breaks a line, and each line is centered on its own:

```js
await bk.fire('BIG\nMONEY');
```

`wrap: true` additionally breaks long text for you. It picks whichever arrangement renders
*largest* rather than fitting to some column count, so it wraps only when wrapping makes the
type bigger — short text is already at the scale cap and stays on one line. Words are never
split, and the viewport budget means a block realistically runs to two or three lines before
height binds; klieg renders banners, not paragraphs.

## One word, several fonts

`fire()` takes a list of runs as well as a string, so a word can change font, size or color
partway through:

```js
await bk.fire([{ text: 'BIG ' }, { text: 'MONEY', font: 'script', size: 1.4, tint: 0xff2d6f }]);
```

| field | default | |
|---|---|---|
| `text` | required | the characters this run covers |
| `font` | the fire's `font` | a name from the instance's `fonts` |
| `size` | `1` | multiple of the surrounding size |
| `tint` | the fire's `tint` | recolors only this run's letters |

Runs kern across their boundaries and sit on one baseline, so a run is a span *within* a word
rather than a word of its own. Everything a fire does to a word — motion, stages, selectable
text — treats a run list exactly as it treats the same text as a string.

There is no per-run `look`. Bloom is a whole-frame pass, so a single run asking for `neon` would
promote the glow for the whole effect.

## Holding until dismissed

`hold: 'click'` keeps the effect on screen until the viewer presses a pointer or Escape, then
plays the exit normally. The promise stays pending until then, and under the default `queue`
policy a held effect blocks every later `fire()` — use `replace` if a later effect should cancel
it instead. A stage's `hold: 'click'` waits for the same press whatever the top-level `hold` is:
each press advances one stage, and only the last ends the effect.

The dismissing click passes through to your page by default, so it both dismisses the effect and
presses whatever was underneath. `modal: true` makes the overlay swallow it instead, which is why
Escape is always bound. That and `selectable: 'layer'`, which takes a click that lands on a letter,
are the only two things that stop a click reaching your page.

`fire()` returns a handle — the same promise, plus `advance()`, which acts as the dismissing press.
With `dismiss: 'host'` klieg attaches no window listeners at all, neither `pointerdown` nor Escape,
so a host that routes its own input gets one action per press instead of two:

```ts
const held = bk.fire('OPEN', { hold: 'click', dismiss: 'host' });
// …later, from your own key handler:
held.advance();
```

An `advance()` that arrives before the effect starts is not lost: it releases the first hold that
effect reaches. Because `clickAnywhere` exists to gate a window listener, `dismiss: 'host'` does not
need it — an anchored placement may hold on a click without the opt-in.

## Queue policies

- `queue` — effects play one at a time, in the order fired.
- `replace` — a new fire aborts the running effect and drops anything still waiting.
- `concurrent` — effects play on top of each other. Avoid it with `lighting: 'sweep'`: the live
  effects fight over the one shared highlight and it sawtooths between their phases.

## Selectable text

klieg draws its letters in WebGL, so by default nothing it renders can be copied, found with
Ctrl+F, or read by a screen reader. `selectable` puts the fired word into the DOM to fix that:

```js
await bk.fire('CONGRATULATIONS', { selectable: 'layer' });
```

- `'hidden'` (default) — one visually-hidden node carrying the word. Copy, find and screen readers
  work; the glyphs themselves don't highlight.
- `'layer'` — a transparent layer over the type, one span per letter in klieg's own typeface, so a
  drag across it selects the word. A click on a letter is taken by the layer rather than reaching
  the page beneath; the gaps between letters, and whitespace, still pass a click through. It needs
  the word to hold still — under a `transform`, or a motion piece that moves the letters, it falls
  back to `'hidden'` and warns once on the console.
- `'none'` — no DOM text, for a page whose own markup already carries the string, such as an
  element `placement` rendered over a real `<h1>`.

## Browser support

WebGL2 is required. `createKlieg` never throws for want of it, or for want of a DOM:
construction succeeds during server rendering and in a browser without WebGL2, and reports
`supported: false`. On an unsupported instance `fire()` resolves immediately, having loaded no
font and rendered nothing, so calls need no guard — read the flag only to do something else
instead:

```ts
if (!bk.supported) confetti();
```

Under `prefers-reduced-motion: reduce` the word holds the pose its enter settles into for
`hold` and then leaves, with no travel.

## Development

- `npm run dev -w @klieg/lab` — the lab page: every motion, look and policy behind
  pickers, plus canned sequences.
- `npm run dev:tube-lab -w klieg` — the tube lab: several letters at several angles at once
  with the tube pipeline's own numbers beside the render. Dev-only tooling, never published.
- `npm run check` — biome, tsc and the unit suite.
- `npm run test:visual` — Playwright specs asserting the overlay composites over a live page
  without tinting or blocking it.
- `npm run build:pages -w @klieg/lab && npm run preview:pages -w @klieg/lab` — the
  lab exactly as GitHub Pages serves it, under the `/klieg/` subpath the workflow builds
  for. Plain `npm run build` produces a root-served build instead.
