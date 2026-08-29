# Share links from the labs

For whoever implements or extends the `show` URL contract. It answers: what a
copied link carries, what it deliberately drops, and why the two labs do it
differently.

## What exists

`/show/` is already the blank presentation page: `apps/lab/src/show-config.ts`
decodes the hash or `?c=`, resolving every field independently so a missing,
malformed or out-of-range one falls back rather than failing the page. That
defensiveness is the contract — these URLs get pasted around and hand-edited —
and every field added below keeps it.

What it carries today is `text`, `looks`, `cycleMs`, `lighting`, `bloom`,
`pivot`, `tint`. None of the motion slots, no transform, nothing acrostic. So a
copy-link built on it as-is would turn a composed acrostic into a plain word
cycling looks.

## The URL format

One query string, holding only what differs from the defaults, written with
short keys:

    t=Keep%0ALighting&lk=tubing&ln=start&an=on&cp=2df0ff

A **shared** link wraps that in base64url and puts it in `?c=`, which is what
`copy link` writes:

    /show/?c=dD1LZWVwJTBBTGlnaHRpbmcmbGs9dHViaW5n…

Three things pushed it there, and they are separate problems:

- **The text is the joke.** A readable URL delivers the punchline in the
  preview, before the page has opened.
- **iMessage ends the link at the `#`** and sends the rest as a message of its
  own. Base64url uses only unreserved characters, so `?c=` has no `#`, `%`, `+`
  or `&` for a detector to stop on.
- **Length.** 197 characters for the acrostic above against 455 before. The
  bare query string is shorter still (128), since base64 charges 4/3 on every
  byte; compressing first would save another ~27 and costs an async decode and
  a format marker, which is not a trade worth making.

The bare form stays first-class for reading and hand-editing, in the hash — the
lab's `readable` checkbox next to `copy link`. Decoding sniffs all three forms,
telling a query string from base64 by the `=` that `atob` refuses.

Keys are in `SHORT` in `show-config.ts`; the long spelling also decodes, so a
hand-editor can write either. Colors are hex (`cp=2df0ff`), booleans are
`on`/`off`, `transform` flattens to `y`/`p`/`r`, and the `looks` cycle list
repeats its key. Two traps: a space rides as `+`, so a literal plus must be
written `%2B`; and a field left out means "whatever the default is now", not
"whatever it was when the link was made".

## What a link carries

The performance, not the look authoring. Added to `ShowConfig`:

- `enter`, `active`, `exit` — the motion slots, validated against the exported
  name lists the way `lighting` already is.
- `transform` — yaw, pitch, roll in degrees, clamped. Degrees, not a matrix: a
  hand-edited URL should be legible, and `fromEuler` is the lab's own input.
- `lineAlign` — `start | center | end`. An acrostic is unreadable without it.
- `acronym` — the routine's own options: `caps` tint, `read`, `settle`, `hold`.
  Absent means an ordinary fire.
- `hold`, `blendMs`, `wrap`.
- `look` — one name. Distinct from the existing `looks` cycle list: a link
  carries the look you composed against, not a slideshow.
- `chrome` — whether the looks strip renders. Default true, so a bare `/show/`
  is unchanged and a copied link decides for itself.

**Deliberately not carried:** the tube and chunk sliders (`radius`, `runs`,
`minRun`, `surfaces`, `count`, `chunkSize`, `align`, `cluster`, `proud`,
`grain`, `density`, `opacity`). Those author a look rather than present one,
each needs its own clamp against a hostile URL, and the resulting link is long
enough to break in chat clients. A look that wants different numbers should
become a named look in the kit, which is the durable fix.

## Why the two labs differ

`apps/lab` copies a URL, because it is served and its state is already in the
hash. The svg-tube lab copies a **config blob** to the clipboard instead: it is
a single file opened from `file://` with no origin to build a link against, and
its `art.svg` is a client mark that must not travel in a URL out of this repo.
A blob is inert until something is built to consume it, which is the honest
shape for a lab with no page to point at.

## Traps

**`Align` is already two things in the lab UI.** `framing.align` places the
whole block in the frame; `lineAlign` ranges lines against each other; and the
`align` slider under `chunks` is chunk orientation, unrelated to both. A share
field named `align` would be ambiguous — hence `lineAlign` spelled out.

**`acronym()` returns options that overwrite, not merge.** It owns `hold`,
`tint`, `stages` and `lineAlign`. A decoder that applies the config's own `hold`
after the routine's will silently break the read beat.
