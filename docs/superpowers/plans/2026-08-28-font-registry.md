# Font registry implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** several fonts per `Klieg` instance, named at construction and addressed per `fire()`,
with `.ttc` collections unpacked so system fonts load at all.

**Architecture:** a per-instance registry maps a name to a `{ url, face }` spec and memoizes the
load by a derived key, so two names for one file share one fetch, one parse and one glyph cache.
`loadFont` grows a collection-unpacking step in front of the parser, and returns the *extracted*
standalone sfnt as its `bytes` so the CSS `FontFace` path keeps working on collections.

**Tech stack:** TypeScript, opentype.js 2.0, three.js, vitest, biome.

**Spec:** [`docs/superpowers/specs/2026-08-28-font-registry-design.md`](../specs/2026-08-28-font-registry-design.md)

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/text/sfnt.ts` | new — recognize and unpack `ttcf` collections; nothing parses here |
| `packages/core/src/text/font.ts` | modify — `loadFont(url, face?)`, `LoadedFont.key`, extracted `bytes` |
| `packages/core/src/text/font-registry.ts` | new — name → spec, memoized by key, per instance |
| `packages/core/src/text/font-face.ts` | modify — key-derived CSS family (callers pass the key) |
| `packages/core/src/index.ts` | modify — `fonts` / `defaultFont` options, `FireOptions.font`, wiring |
| `packages/core/src/sign/index.ts` | modify — pass `fonts`, so a sign does not trip the deprecation |
| `scripts/fonts.mjs` | new — download catalogue faces + licenses into the lab, write the manifest |
| `apps/lab/src/fonts/catalog.ts` | new — all 34 faces; `seeded` marks the eight committed |
| `apps/lab/public/fonts/` | new — eight `.ttf`, `licenses/*.txt`, `manifest.json` |

---

### Task 1: Seed the lab's fonts

The `.ttc` tests in Task 2 pack two *real* fonts with distinct PostScript names, so the fonts land
first and no test has to synthesize a `name` table.

**Files:**
- Create: `scripts/fonts.mjs`, `apps/lab/src/fonts/catalog.ts`
- Create: `apps/lab/public/fonts/*.ttf`, `apps/lab/public/fonts/licenses/*.txt`,
  `apps/lab/public/fonts/manifest.json`

- [ ] **Step 1: Write the catalogue**

All 34 entries from wod's `src/slice/fonts/catalog.ts`, with its `class` taxonomy
(`display | woodtype | serif | sans | script`). `seeded: true` on exactly eight:
`anton`, `bebas-neue`, `abril-fatface`, `black-ops-one`, `monoton`, `rye`, `cinzel`, `lobster`.

```ts
export type FontClass = 'display' | 'woodtype' | 'serif' | 'sans' | 'script';

export interface CatalogFont {
  id: string;
  /** As the face calls itself. */
  name: string;
  class: FontClass;
  /** The family as the Google Fonts API spells it. */
  google: string;
  /** Committed to the repo, and so servable without running the script. */
  seeded?: boolean;
}
```

- [ ] **Step 2: Port the downloader**

`scripts/fonts.mjs`, from wod's, with two changes: it writes into `apps/lab/public/fonts`, and it
emits `manifest.json` listing what is on disk rather than a stylesheet. Fetch the Google CSS with
no browser user-agent, which is what makes the API answer with one whole-charset `.ttf` instead of
a stack of unicode-range WOFF2 subsets. Print one line per face as it lands (`3/8 anton 130KB`).

- [ ] **Step 3: Run it for the eight seeded faces**

Run: `node scripts/fonts.mjs`
Expected: eight `.ttf` and eight `licenses/*.txt` in `apps/lab/public/fonts`, plus `manifest.json`.

- [ ] **Step 4: Commit**

```bash
git add scripts/fonts.mjs apps/lab/src/fonts/catalog.ts apps/lab/public/fonts
git commit -m "seed eight display faces for the lab"
```

---

### Task 2: Unpack font collections

**Files:**
- Create: `packages/core/src/text/sfnt.ts`, `packages/core/test/text/sfnt.test.ts`

- [ ] **Step 1: Write the failing test**

The fixture packs two real faces into one `ttcf` — a helper in the test file, since a collection is
just N table directories over one pool of tables.

```ts
const ttc = collectionOf(read('anton.ttf'), read('cinzel.ttf'));

it('lists the faces a collection holds', () => {
  expect(collectionFaces(ttc)).toEqual(['Anton-Regular', 'Cinzel-Regular']);
});

it('extracts a member that opentype parses', () => {
  const { bytes, matched } = sfntFromCollection(ttc, 'Cinzel-Regular');
  expect(matched).toBe(true);
  expect(opentype.parse(bytes).getEnglishName('postScriptName')).toBe('Cinzel-Regular');
});

it('preserves the glyphs, since the table bytes are copied not re-encoded', () => {
  const direct = opentype.parse(read('cinzel.ttf'));
  const viaTtc = opentype.parse(sfntFromCollection(ttc, 'Cinzel-Regular').bytes);
  expect(viaTtc.charToGlyph('A').advanceWidth).toBe(direct.charToGlyph('A').advanceWidth);
});

it('passes a single font through untouched', () => {
  const single = read('anton.ttf');
  expect(sfntFromCollection(single).bytes).toBe(single);
});

it('falls back to the first member and says it did not match', () => {
  expect(sfntFromCollection(ttc, 'Nothing-Regular').matched).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/core/test/text/sfnt.test.ts`
Expected: FAIL — cannot resolve `../../src/text/sfnt.js`.

- [ ] **Step 3: Port `sfnt.ts`**

From `~/src/weasel/packages/font/src/outline/sfnt.ts` (MIT, same author). Keep
`isFontCollection`, `isDataForkFont` and `sfntFromCollection` as they stand — including the
recomputed `searchRange`/`entrySelector`, because a member directory's own hint describes its own
table count and a wrong one walks a parser off the end of the directory. Trim the file's essay to
what klieg's reader needs, and add:

```ts
/** PostScript names of every member, in file order. Empty for a single font. */
export function collectionFaces(bytes: ArrayBuffer): string[];
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/text/sfnt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/sfnt.ts packages/core/test/text/sfnt.test.ts
git commit -m "unpack a font collection into a standalone sfnt"
```

---

### Task 3: Load one face of a collection

**Files:**
- Modify: `packages/core/src/text/font.ts`
- Modify: `packages/core/test/text/font.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('keys a plain font by its url', async () => {
  expect((await loadFont('/fonts/x.ttf')).key).toBe('/fonts/x.ttf');
});

it('keys a face of a collection by url and face, so two faces do not collide', async () => {
  expect((await loadFont('/f.ttc', 'Helvetica-Bold')).key).toBe('/f.ttc#Helvetica-Bold');
});

it('hands the parser the extracted sfnt, not the collection', async () => {
  // `new FontFace` is given these bytes, and a ttcf container is not a font resource.
  const { bytes } = await loadFont(TTC_URL, 'Cinzel-Regular');
  expect(isFontCollection(bytes)).toBe(false);
});

it('names the members when the face is not one of them', async () => {
  await expect(loadFont(TTC_URL, 'Nope')).rejects.toThrow(
    "klieg: /f.ttc has no face 'Nope' — it holds Anton-Regular, Cinzel-Regular",
  );
});

it('warns once and takes the first member when no face is named', async () => {
  await loadFont(TTC_URL);
  expect(warn).toHaveBeenCalledWith(
    "klieg: /f.ttc is a collection and no face was named — using Anton-Regular of Anton-Regular, Cinzel-Regular",
  );
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/core/test/text/font.test.ts`
Expected: FAIL — `loadFont` takes one argument and `LoadedFont` has no `key`.

- [ ] **Step 3: Implement**

```ts
export interface LoadedFont {
  font: Font;
  unitsPerEm: number;
  metrics: GlyphMetrics;
  /** Identity for caches and for the CSS family: the url, or `url#face` within a collection. */
  key: string;
  /** The *extracted* sfnt, kept so a CSS `FontFace` can reuse it instead of downloading again. */
  bytes: ArrayBuffer;
}

export async function loadFont(url: string, face?: string): Promise<LoadedFont>;
```

Between the `arrayBuffer()` and the `parse`: if `isFontCollection(fetched)`, resolve the member —
throw naming `collectionFaces` when `face` misses, warn once when `face` is absent — and parse the
extracted bytes. A single font is untouched.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/text/font.test.ts`
Expected: PASS, existing cases included.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/font.ts packages/core/test/text/font.test.ts
git commit -m "load one named face out of a font collection"
```

---

### Task 4: Separate the CSS families of two faces

**Files:**
- Modify: `packages/core/test/text/font-face.test.ts`

`familyFor` already hashes an opaque string; the change is that every caller passes
`LoadedFont.key`. The test pins the consequence, which is the part a future edit can break.

- [ ] **Step 1: Write the failing test**

```ts
it('separates two faces of one collection, which share a url', () => {
  expect(familyFor('/f.ttc#Helvetica')).not.toBe(familyFor('/f.ttc#Helvetica-Bold'));
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/core/test/text/font-face.test.ts`
Expected: PASS — it already holds. Rename the parameter `url` → `key` and update the doc comment
so the next reader passes the right thing.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/text/font-face.ts packages/core/test/text/font-face.test.ts
git commit -m "key the CSS family by the font key rather than its url"
```

---

### Task 5: The registry

**Files:**
- Create: `packages/core/src/text/font-registry.ts`, `packages/core/test/text/font-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('resolves the first entry when no default is named', async () => {
  const r = new FontRegistry({ display: '/d.ttf', body: '/b.ttf' });
  expect((await r.load()).key).toBe('/d.ttf');
});

it('honours an explicit default', async () => {
  const r = new FontRegistry({ display: '/d.ttf', body: '/b.ttf' }, 'body');
  expect((await r.load()).key).toBe('/b.ttf');
});

it('fetches one file once, however many names point at it', async () => {
  const r = new FontRegistry({ a: '/one.ttf', b: '/one.ttf' });
  expect(await r.load('a')).toBe(await r.load('b'));
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('names the registered fonts when asked for one it has not got', () => {
  const r = new FontRegistry({ display: '/d.ttf', body: '/b.ttf' });
  expect(() => r.load('bdy')).toThrow(
    "klieg: no font named 'bdy' — registered: display, body",
  );
});

it('retries a failed load rather than making one bad fetch permanent', async () => {
  // Matches the memoization `index.ts` had per instance, now per font.
});

it('rejects an empty map and a default naming nothing', () => {
  expect(() => new FontRegistry({})).toThrow('klieg: fonts is empty');
  expect(() => new FontRegistry({ a: '/a.ttf' }, 'b')).toThrow(
    "klieg: defaultFont 'b' is not one of: a",
  );
});
```

The unknown-name throw is synchronous, not a rejection: it is a typo in the host's own code, and a
`fire()` that throws where it is called is what puts the stack at the call site.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/core/test/text/font-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type FontSpec = string | { url: string; face?: string };

export class FontRegistry {
  constructor(fonts: Record<string, FontSpec>, defaultFont?: string);
  /** The names, in declaration order. */
  get names(): string[];
  /** Throws synchronously on a name it does not hold; rejects on a load that fails. */
  load(name?: string): Promise<LoadedFont>;
}
```

Memoize on `` `${url}#${face ?? ''}` ``, not on the name, so two names for one file share one
promise. Clear the memo on rejection.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/core/test/text/font-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/text/font-registry.ts packages/core/test/text/font-registry.test.ts
git commit -m "hold an instance's fonts in a registry keyed by name"
```

---

### Task 6: Wire the registry through `createKlieg`

**Files:**
- Modify: `packages/core/src/index.ts` (options at `:179`, `font()` at `:424`, `registerFace` at `:504`)
- Modify: `packages/core/src/sign/index.ts:66`
- Modify: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('sets a fire in the font it names', async () => {
  const bk = createKlieg({ fonts: { display: '/d.ttf', body: '/b.ttf' }, clock });
  await bk.fire('X', { font: 'body' });
  expect(loadFont).toHaveBeenCalledWith('/b.ttf', undefined);
});

it('throws at the call site on a font it does not have', () => {
  const bk = createKlieg({ fonts: { display: '/d.ttf' }, clock });
  expect(() => bk.fire('X', { font: 'nope' })).toThrow("klieg: no font named 'nope'");
});

it('refuses both fontUrl and fonts, which disagree about which font is which', () => {
  expect(() => createKlieg({ fontUrl: '/a.ttf', fonts: { a: '/a.ttf' } })).toThrow(
    'klieg: pass fonts or fontUrl, not both',
  );
});

it('refuses neither', () => {
  expect(() => createKlieg({} as KliegOptions)).toThrow('klieg: fonts is required');
});

it('warns once for the deprecated fontUrl, not once per fire', async () => {
  const bk = createKlieg({ fontUrl: '/d.ttf', clock });
  await bk.fire('X');
  await bk.fire('Y');
  expect(warn).toHaveBeenCalledTimes(1);
});

it('registers the CSS face under the loaded font key', async () => { /* selectable: 'layer' */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run packages/core/test/index.test.ts`
Expected: FAIL — `fonts` is not an option.

- [ ] **Step 3: Implement**

`KliegOptions` gains `fonts?: Record<string, FontSpec>` and `defaultFont?: string`, and `fontUrl`
becomes optional and `@deprecated`. Build one `FontRegistry` beside `caches` at `:388`; delete the
`fontPromise` memo at `:424`, which the registry now owns. `FireOptions` gains `font?: string`,
resolved in `run()`; `registerFace` at `:504` takes `loaded.key`.

`sign()` passes `fonts: { default: opts.font }` rather than `fontUrl`, so an anchored sign does not
warn about a deprecation its own caller cannot see.

The unknown-name check runs where `fire()` is called, before the queue, so it throws rather than
rejecting.

- [ ] **Step 4: Run the whole suite**

Run: `npm run check`
Expected: lint, typecheck and every test pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "address an instance's fonts by name from a fire"
```

---

### Task 7: A font picker in the lab

**Files:**
- Modify: `apps/lab/index.html`, `apps/lab/src/*`

- [ ] **Step 1: Read the manifest, not the catalogue**

The picker offers what `manifest.json` says is on disk. A catalogue entry with no file is an
invitation to run `node scripts/fonts.mjs <id>`, never a 404.

- [ ] **Step 2: Fire each face from the picker**

One `createKlieg` holding every seeded face, `fire(text, { font: id })` on selection — which is the
thing the registry exists for, and the only manual check that the glyph cache discriminates fonts.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev -w @klieg/lab`, switch faces, confirm each renders in its own typeface and that
switching back is instant (the second fire hits the cache).

- [ ] **Step 4: Commit**

```bash
git add apps/lab
git commit -m "pick a face in the lab"
```

---

### Task 8: Document it

**Files:**
- Modify: `README.md` (the options table at `:487`), `CHANGELOG.md`

- [ ] **Step 1: README**

Replace the `fontUrl` row with `fonts` and `defaultFont`, and say what `face` is for: the macOS
system fonts are collections, and this is what makes them loadable at all.

- [ ] **Step 2: CHANGELOG**

Under `## 0.9.4`, beside the warmup entry.

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "document the font registry"
```
