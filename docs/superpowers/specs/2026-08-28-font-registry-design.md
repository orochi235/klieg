# Font registry — design

**What:** several fonts per instance, each addressed by name from a `fire()`, and `.ttc`
collections unpacked so the fonts already on a machine can be loaded at all.
**For:** whoever implements this in `@klieg/core`.
**Answers:** what the host declares, what a fire names, what happens when either is wrong, and
which existing code has to change.

## Why more than one

`fontUrl` is one required string per instance, fetched once and memoized (`index.ts:400`). A page
wanting two typefaces needs two `Klieg`s, and two WebGL contexts.

A whole class of font also cannot be loaded today. Helvetica, Times, Courier and Menlo are `.ttc`
collections on macOS — N table directories over one shared pool of tables, opening with `ttcf`
rather than an sfnt version. opentype.js recognizes `\0\1\0\0`, `true`, `typ1`, `OTTO` and `wOFF`
and throws on everything else, so `loadFont` fails on every one of them, with a message about the
file not being a font.

## API

```ts
interface KliegOptions {
  /** Fonts this instance can set type in. The first entry is the default. */
  fonts?: Record<string, string | { url: string; face?: string }>;
  /** Which entry a bare `fire()` uses. Defaults to the first. */
  defaultFont?: string;
  /** @deprecated Pass `fonts` instead. */
  fontUrl?: string;
}

interface FireOptions {
  /** A name from `fonts`. Defaults to `defaultFont`. */
  font?: string;
}
```

`face` names a member of a collection by its PostScript name, and is meaningless on a single font.

Key order decides the default because JS preserves string-key insertion order — which means
reordering the literal changes which font a bare `fire()` uses. `defaultFont` is how a host stops
depending on that.

`fontUrl` keeps working and warns once per instance — not once per process, which would make the
warning depend on which instance happened to be built first. It is the whole existing public
surface, so removing it is a 1.0 change, not this one.

## When the host is wrong

| | |
|---|---|
| neither `fonts` nor `fontUrl` | throws at construction |
| both | throws at construction |
| `fonts: {}` | throws at construction |
| `defaultFont` naming nothing | throws at construction, listing the names |
| `fire({ font })` naming nothing | throws synchronously, listing the names |
| `face` absent from the collection | throws on load, listing the collection's members |
| no `face` on a collection | first member, warns once naming what it took and what else was there |
| fetch or parse failure | rejects that fire; the next one retries |

A name klieg does not know is a typo in the host's own code, so it fails loudly and renders
nothing rather than substituting a typeface nobody asked for. A file that will not load is the
existing behavior (`index.ts:404` clears the memo on rejection), now per font rather than per
instance.

## What changes

**`text/sfnt.ts`** — ported from `@weasel-js/font` (MIT, same author). `isFontCollection`,
`isDataForkFont`, `sfntFromCollection`: it picks the member directory whose PostScript name
matches and re-emits it as a standalone sfnt with the table bytes copied and the offsets
rewritten. Nothing is re-encoded, so the result parses identically to a font that had shipped on
its own, and passing a single font through is a no-op. One addition klieg needs: `collectionFaces
(bytes): string[]`, so a bad `face` is reported against what the file actually holds.

`.dfont` is not unpacked — its sfnt tables sit inside a Macintosh resource map, a second container
on top of this one. `isDataForkFont` recognizes it so the failure says which format it was.

**`text/font.ts`** — `loadFont(url, face?)` becomes fetch → unpack → parse. `LoadedFont` gains
`key` (`url`, or `` `${url}#${face}` ``), and **`bytes` becomes the extracted standalone sfnt
rather than the fetched file**.

**`text/font-registry.ts`** — new, per instance. Holds name → spec, memoizes the load by `key`, and
lists its names for the diagnostics above. Two names pointing at one file therefore share one
fetch, one parse and one glyph cache.

**`text/font-face.ts`** — `familyFor(key)` rather than `familyFor(url)`.

**`index.ts`** — `font()` becomes `font(name?)`, resolving through the registry; the `registerFace`
call at `:501` passes the loaded font's key rather than `options.fontUrl`.

`render/caches.ts` needs nothing: `WordCaches` already keys glyph geometry on the `LoadedFont`
object through a `WeakMap` interner, which discriminates fonts correctly the moment there is more
than one.

## Three traps

**`new FontFace` is handed `LoadedFont.bytes`.** A `ttcf` container is not a font resource, so if
`bytes` stayed the fetched file, `registerFace` would return `null` on every collection and
`selectable: 'layer'` would silently never build — no error, just no selection layer.

**The CSS family hashes the key, not the URL.** Two faces of one `.ttc` share a URL; hashing that
would give them one family, and the selection layer would measure the wrong weight while looking
correct.

**The registry is per instance.** weasel's is module-global, which is the part of its design not
to copy: two `createKlieg` calls on one page must not see each other's names. The `registered`
Set in `font-face.ts` stays module-global on purpose, because `document.fonts` is.

## Lab fonts

The lab serves one `font.ttf`, which demonstrates nothing about a registry. Port wod's
`scripts/fonts.mjs` and its catalogue — all 34 entries with their class taxonomy, so adding a face
later is a script run rather than a research task — and seed eight display faces into
`apps/lab/public/fonts` with their licenses.

The script writes a manifest of what it actually downloaded, and the picker reads that rather than
the catalogue: otherwise it offers 26 faces that 404.

Nothing here ships. `files` publishes `dist` alone.

## Testing

The `.ttc` fixture is synthesized in-test by wrapping `apps/lab/public/font.ttf` into a two-member
`ttcf`, so there is no binary fixture in the repo and the round-trip is checkable both ways:
extracted bytes parse under opentype, and give the same glyph advances as the original file.

- Two names for one file produce one fetch and one `LoadedFont`.
- A rejected load is retried on the next fire; a resolved one is not refetched.
- An unknown font name throws synchronously and names the registered fonts.
- An unknown `defaultFont`, an empty map, both options and neither each throw at construction.
- `fontUrl` still loads, and warns once rather than per fire.
- `familyFor` differs for two faces of one collection URL.
- With no `defaultFont`, the first entry is what a bare fire uses.
- A `face` naming no member throws listing the members; a collection with no `face` warns once.

## Not this slice

Per-run fonts — `fire(TextRun[])` with a font per run — need layout to take metrics per run, which
is its own design. This registry is what that addresses into; it should not be half-built here.
