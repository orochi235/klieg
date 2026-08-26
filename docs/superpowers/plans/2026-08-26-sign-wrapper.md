# Sign Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `klieg/sign` — a framework-free function that lights a held sign into an anchor — and
`<klieg-sign>`, a custom element adapter over it, plus the `hold: 'forever'` core option both need.

**Architecture:** Three units. `hold: 'forever'` maps onto `Timeline`'s existing `'until-release'`
machinery with no dismissal listener attached, so a fire never settles until `destroy()`. `sign()`
owns one klieg instance and one fire, resolves the tint against the anchor's computed style, derives
`selectable` from where the text came from, and degrades to leaving the anchor untouched.
`<klieg-sign>` imports `sign()` **dynamically** so three.js arrives only when an element connects.

**Tech Stack:** TypeScript 7, vitest 4 (node by default, jsdom per-file), playwright, vite (lib mode
for the standalone bundle), biome.

**Design:** [`../specs/2026-08-26-sign-wrapper-design.md`](../specs/2026-08-26-sign-wrapper-design.md)

**Branch:** `sign-wrapper`, worktree `~/src/klieg-worktrees/sign-wrapper`, cut from `origin/main`
(which carries `framing.align`).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/index.ts` | **Modify** — `hold` gains `'forever'` |
| `packages/core/src/sign/tint.ts` | **Create** — a CSS colour string to a klieg tint number |
| `packages/core/src/sign/index.ts` | **Create** — `sign()`, `SignOptions`, `Sign` |
| `packages/core/src/element.ts` | **Create** — `<klieg-sign>`. No static import of core |
| `packages/core/test/index.test.ts` | **Modify** — `hold: 'forever'` |
| `packages/core/test/sign/tint.test.ts` | **Create** — jsdom |
| `packages/core/test/sign/index.test.ts` | **Create** — jsdom, core mocked |
| `packages/core/test/element.test.ts` | **Create** — jsdom, `sign()` mocked |
| `packages/core/package.json` | **Modify** — exports, `sideEffects`, build scripts |
| `packages/core/standalone.vite.config.ts` | **Create** — one-file bundle with three inlined |
| `vitest.config.ts` | **Modify** — subpath aliases |
| `apps/lab/vite.config.ts` | **Modify** — subpath aliases, `/sign` page |
| `apps/lab/sign/index.html` | **Create** — a page whose only script is the element |
| `apps/lab/test/sign.spec.ts` | **Create** — playwright |
| `README.md`, `CHANGELOG.md` | **Modify** |

`sign()` splits from `tint.ts` because colour resolution is pure string work with its own failure
modes and is the only part that can be tested without mocking anything.

---

### Task 1: `hold: 'forever'` in core

`Timeline` already builds an infinite duration for `hold: 'until-release'`. "Forever" is that, with
no listener attached to release it — so the change is entirely in `index.ts`'s wiring.

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/test/index.test.ts`, inside the top-level `describe('createKlieg', ...)`:

```ts
  it('never settles a forever hold, and settles it on destroy', async () => {
    const bk = create();
    let done = false;
    const fired = bk.fire('HI', { ...INSTANT, hold: 'forever' }).then(() => {
      done = true;
    });
    await flush();

    clock.advance(60 * 60 * 1000);
    await flush();
    expect(done).toBe(false);
    expect(words()).toHaveLength(1);

    bk.destroy();
    await fired;
    expect(done).toBe(true);
    expect(words()).toHaveLength(0);
  });

  it('holds forever under reduced motion too', async () => {
    vi.spyOn(globalThis, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const bk = create();
    let done = false;
    const fired = bk.fire('HI', { ...INSTANT, hold: 'forever' }).then(() => {
      done = true;
    });
    await flush();

    clock.advance(60 * 60 * 1000);
    await flush();
    expect(done).toBe(false);

    bk.destroy();
    await fired;
    expect(done).toBe(true);
  });

  it('accepts a forever hold on an element placement, where click is refused', async () => {
    // Never read: `Stage`'s constructor only stores the placement, and `mount` is stubbed.
    const bk = createKlieg({
      fontUrl: '/f.ttf',
      clock,
      placement: { kind: 'element', el: {} as HTMLElement },
    });

    expect(() => bk.fire('HI', { hold: 'click' })).toThrow(/no meaning for an element placement/);
    expect(() => bk.fire('HI', { ...INSTANT, hold: 'forever' })).not.toThrow();
    bk.destroy();
  });
```

`matchMedia` is not stubbed by the shared `beforeEach`, so the reduced-motion test stubs it itself
and `vi.restoreAllMocks()` in `afterEach` puts it back.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd ~/src/klieg-worktrees/sign-wrapper
npx vitest run packages/core/test/index.test.ts -t forever
```

Expected: FAIL. The first two hang to their timeout or resolve immediately (`'forever'` reaches
`Timeline` as a non-number `hold` and `activeEnd` becomes `NaN`); the third fails to typecheck.

- [ ] **Step 3: Widen the type**

In `packages/core/src/index.ts`, in `FireOptions`, replace the `hold` field and its docblock:

```ts
  /**
   * Milliseconds in the active phase, `'click'` to hold until the viewer dismisses it, or
   * `'forever'` to stay until `destroy()`. A held effect blocks the queue under the default
   * `queue` policy, and its promise stays pending until it leaves the screen.
   *
   * `'click'` has no meaning for an element placement and is refused there; `'forever'` is the
   * value a sign wants, and is legal everywhere.
   */
  hold?: number | 'click' | 'forever';
```

- [ ] **Step 4: Wire it through `run()`**

In `packages/core/src/index.ts`, inside `async function run(...)`, replace:

```ts
    const hold = opts.hold ?? 1200;
    const untilClick = hold === 'click';
```

with:

```ts
    const hold = opts.hold ?? 1200;
    const untilClick = hold === 'click';
    const forever = hold === 'forever';
    // Both are an infinite active phase; only `'click'` attaches something that can end it.
    const openEnded = untilClick || forever;
```

Then in the same function, in the `new Timeline({...})` literal, replace:

```ts
      hold: untilClick ? 'until-release' : (hold as number),
```

with:

```ts
      hold: openEnded ? 'until-release' : (hold as number),
```

and in the `new Sequence({...})` literal, replace:

```ts
          hold: untilClick ? 'click' : (hold as number),
```

with:

```ts
          hold: openEnded ? 'click' : (hold as number),
```

Leave `awaitsClick` exactly as it is — a `'forever'` fire must attach no pointer or key listener,
which is the whole difference between the two.

- [ ] **Step 5: Fix the reduced-motion completion test**

Still in `run()`, in the clock subscription, replace:

```ts
          const stillDone = untilClick ? released : since >= (hold as number);
```

with:

```ts
          const stillDone = untilClick ? released : forever ? false : since >= (hold as number);
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run packages/core/test/index.test.ts
```

Expected: PASS, every test in the file.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "let a fire hold until it is destroyed"
```

---

### Task 2: A DOM test environment

The suite runs `environment: 'node'` and fakes `document` with a two-method object. `sign()` and the
element need a real one. jsdom is added per-file rather than globally so no existing test changes
environment.

**Files:**
- Modify: `package.json` (root), `vitest.config.ts`

- [ ] **Step 1: Install jsdom**

```bash
cd ~/src/klieg-worktrees/sign-wrapper
npm install -D jsdom@^28.0.0
```

- [ ] **Step 2: Alias the new subpaths**

`vitest.config.ts` aliases `^klieg$` only, so `klieg/sign` would resolve to unbuilt `dist`. In
`vitest.config.ts`, replace the `alias` array with:

```ts
    alias: [
      {
        find: /^klieg\/sign$/,
        replacement: fileURLToPath(new URL('./packages/core/src/sign/index.ts', import.meta.url)),
      },
      {
        find: /^klieg\/element$/,
        replacement: fileURLToPath(new URL('./packages/core/src/element.ts', import.meta.url)),
      },
      {
        find: /^klieg$/,
        replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      },
    ],
```

Order matters: vite tries these in sequence, and a bare `/^klieg$/` first would not match
`klieg/sign` but the reverse mistake — an unanchored `/klieg/` — would swallow both. Keep them
anchored and keep the bare one last.

- [ ] **Step 3: Prove the environment works**

Create `packages/core/test/sign/environment.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

describe('the jsdom environment', () => {
  it('has a document, custom elements and computed style', () => {
    expect(typeof document.createElement).toBe('function');
    expect(typeof customElements.define).toBe('function');
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(getComputedStyle(el)).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run it**

```bash
npx vitest run packages/core/test/sign/environment.test.ts
```

Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts packages/core/test/sign/environment.test.ts
git commit -m "give the suite a real DOM for the wrapper tests"
```

---

### Task 3: `resolveTint`

A sign takes its colour from the page. Rather than parse CSS, it sets the candidate value as `color`
on a probe inside the anchor and reads back what the browser computed — which resolves
`currentColor`, `var(--x)`, named colours, `hsl()` and hex through one path.

**Files:**
- Create: `packages/core/src/sign/tint.ts`
- Test: `packages/core/test/sign/tint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/sign/tint.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTint } from '../../src/sign/tint.js';

let anchor: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  anchor = document.createElement('h1');
  document.body.appendChild(anchor);
});

describe('resolveTint', () => {
  it('passes a number through untouched', () => {
    expect(resolveTint(anchor, 0x22d3ee)).toBe(0x22d3ee);
  });

  it('returns undefined for no tint at all', () => {
    expect(resolveTint(anchor, undefined)).toBeUndefined();
  });

  it('packs a hex colour into a klieg tint', () => {
    expect(resolveTint(anchor, '#22d3ee')).toBe(0x22d3ee);
  });

  it('packs a named colour', () => {
    expect(resolveTint(anchor, 'red')).toBe(0xff0000);
  });

  it('leaves the anchor exactly as it found it', () => {
    const before = anchor.innerHTML;
    resolveTint(anchor, '#123456');
    expect(anchor.innerHTML).toBe(before);
    expect(anchor.children).toHaveLength(0);
  });

  it('returns undefined rather than a wrong colour for something unparseable', () => {
    expect(resolveTint(anchor, 'not-a-colour')).toBeUndefined();
  });
});
```

`currentColor` and `var(--x)` are **not** tested here: jsdom computes neither, and a test that
passed on jsdom's shortcut would prove nothing about a browser. Task 11's playwright spec is where
those are proven.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/core/test/sign/tint.test.ts
```

Expected: FAIL — `Failed to resolve import "../../src/sign/tint.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/sign/tint.ts`:

```ts
/**
 * A computed `color` is `rgb(r, g, b)` or `rgba(r, g, b, a)` in every engine that matters. A
 * browser returning `color(srgb …)` for a wide-gamut input falls through to undefined, which
 * leaves the look its own colour rather than a wrong one.
 */
function packRgb(css: string): number | undefined {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(css);
  if (!match) return undefined;
  const parts = [match[1], match[2], match[3]];
  let packed = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value)) return undefined;
    packed = (packed << 8) | (Math.round(value) & 255);
  }
  return packed;
}

/**
 * Resolves a tint the page can express against the anchor it will sit on. A probe carrying the
 * candidate as its own `color` is the only way to get `currentColor` and `var()` resolved: both
 * are answered by the cascade, not by any string the caller could parse.
 */
export function resolveTint(
  anchor: HTMLElement,
  value: number | string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;

  const probe = anchor.ownerDocument.createElement('span');
  // Inline, because the whole point is to set one value and read back what the cascade made of it.
  probe.style.display = 'none';
  probe.style.color = value;
  anchor.appendChild(probe);
  const computed = probe.ownerDocument.defaultView?.getComputedStyle(probe).color ?? '';
  probe.remove();

  return packRgb(computed);
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run packages/core/test/sign/tint.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sign/tint.ts packages/core/test/sign/tint.test.ts
git commit -m "resolve a sign's tint through the cascade rather than a parser"
```

---

### Task 4: `sign()` — create, fire, degrade

**Files:**
- Create: `packages/core/src/sign/index.ts`
- Test: `packages/core/test/sign/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/sign/index.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FireOptions, KliegOptions } from '../../src/index.js';

const { createKlieg, fire, destroy, prefersReducedMotion } = vi.hoisted(() => ({
  createKlieg: vi.fn(),
  fire: vi.fn(),
  destroy: vi.fn(),
  prefersReducedMotion: vi.fn(() => false),
}));

vi.mock('../../src/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/index.js')>()),
  createKlieg,
}));
vi.mock('../../src/render/stage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/render/stage.js')>()),
  prefersReducedMotion,
}));

const { sign } = await import('../../src/sign/index.js');

let anchor: HTMLElement;
let settle: () => void;

/** The options the last `createKlieg` was built with. */
const built = (): KliegOptions => createKlieg.mock.calls[0]?.[0] as KliegOptions;
/** The options the last `fire` was called with. */
const fired = (): FireOptions => fire.mock.calls[0]?.[1] as FireOptions;

beforeEach(() => {
  vi.clearAllMocks();
  prefersReducedMotion.mockReturnValue(false);
  document.body.innerHTML = '';
  anchor = document.createElement('h1');
  anchor.textContent = 'A Name';
  document.body.appendChild(anchor);

  // A forever hold: the promise stays pending until the test settles it.
  fire.mockImplementation(() => new Promise<void>((resolve) => {
    settle = resolve;
  }));
  createKlieg.mockReturnValue({ supported: true, fire, destroy });
});

describe('sign', () => {
  it('anchors an element placement to the anchor and fires its text', () => {
    sign(anchor, { font: '/f.ttf' });

    expect(built().fontUrl).toBe('/f.ttf');
    expect(built().placement).toEqual({ kind: 'element', el: anchor });
    expect(fire).toHaveBeenCalledWith('A Name', expect.anything());
  });

  it('holds forever and never enters, because an anchored canvas clips a travelling enter', () => {
    sign(anchor, { font: '/f.ttf' });

    expect(fired().hold).toBe('forever');
    expect(fired().enter).toBe('none');
  });

  it('leaves the anchor untouched with no webgl, and never reports itself lit', () => {
    createKlieg.mockReturnValue({ supported: false, fire, destroy });
    const onLit = vi.fn();

    const it_ = sign(anchor, { font: '/f.ttf', onLit });

    expect(fire).not.toHaveBeenCalled();
    expect(onLit).not.toHaveBeenCalled();
    expect(it_.lit).toBe(false);
    expect(anchor.textContent).toBe('A Name');
  });

  it('does not fire an empty anchor', () => {
    anchor.textContent = '   ';
    sign(anchor, { font: '/f.ttf' });

    expect(createKlieg).not.toHaveBeenCalled();
  });

  it('prefers an explicit text over the anchor content', () => {
    sign(anchor, { font: '/f.ttf', text: 'Something Else' });

    expect(fire).toHaveBeenCalledWith('Something Else', expect.anything());
  });

  it('resolves a CSS tint against the anchor', () => {
    sign(anchor, { font: '/f.ttf', tint: '#22d3ee' });

    expect(fired().tint).toBe(0x22d3ee);
  });

  it('merges the fire escape hatch over everything it built', () => {
    sign(anchor, { font: '/f.ttf', bloom: true, fire: { bloom: false, blendMs: 40 } });

    expect(fired().bloom).toBe(false);
    expect(fired().blendMs).toBe(40);
  });

  it('reports lit before the build blocks, and unlit when the fire settles', async () => {
    const onLit = vi.fn();
    const it_ = sign(anchor, { font: '/f.ttf', onLit });

    // Synchronously, with no await: the word build blocks the main thread and nothing paints
    // during it, so a caller told afterwards is told seconds late.
    expect(onLit).toHaveBeenCalledExactlyOnceWith(true);
    expect(it_.lit).toBe(true);

    settle();
    await Promise.resolve();
    expect(onLit).toHaveBeenLastCalledWith(false);
    expect(it_.lit).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/core/test/sign/index.test.ts
```

Expected: FAIL — `Failed to resolve import "../../src/sign/index.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/sign/index.ts`:

```ts
import {
  createKlieg,
  type EffectSpec,
  type FireOptions,
  type Framing,
  type Klieg,
  type LightingSlot,
  type Look,
} from '../index.js';
import { prefersReducedMotion } from '../render/stage.js';
import { resolveTint } from './tint.js';

export interface SignOptions {
  /** No default: bundling a typeface is a licensing decision the library does not get to make. */
  font: string;
  /** Defaults to the anchor's own text, which is what makes the page's markup the DOM copy. */
  text?: string;
  look?: Look;
  /** A number, or any CSS colour — `currentColor` and `var(--x)` included, resolved on `anchor`. */
  tint?: number | string;
  framing?: Framing;
  lighting?: LightingSlot;
  bloom?: boolean;
  effects?: EffectSpec[];
  /** Merged over everything the options above build. */
  fire?: FireOptions;
  /**
   * Called with `true` **synchronously, before the word is built**, and `false` when the sign
   * leaves. Building blocks the main thread for hundreds of milliseconds and nothing paints during
   * it, so a caller hiding its fallback has to be told before the block, not after.
   */
  onLit?: (lit: boolean) => void;
}

export interface Sign {
  readonly lit: boolean;
  /** Re-fires. A sign's settings change rarely enough that diffing them is not worth the branch. */
  update(patch: Partial<SignOptions>): void;
  destroy(): void;
}

export function sign(anchor: HTMLElement, options: SignOptions): Sign {
  let opts = options;
  let instance: Klieg | null = null;
  let lit = false;

  function start(): void {
    const text = opts.text ?? anchor.textContent?.trim() ?? '';
    if (!text) return;

    const klieg = createKlieg({
      fontUrl: opts.font,
      placement: { kind: 'element', el: anchor },
      ...(opts.framing ? { framing: opts.framing } : {}),
    });
    if (!klieg.supported) {
      klieg.destroy();
      return;
    }
    instance = klieg;

    const still = prefersReducedMotion();
    const tint = resolveTint(anchor, opts.tint);

    lit = true;
    opts.onLit?.(true);
    void klieg
      .fire(text, {
        // An anchored canvas crops to its box and every enter piece travels outside it.
        enter: 'none',
        hold: 'forever',
        // The page already carries the word whenever the anchor supplied it; a second copy is
        // announced twice by a screen reader and matches find-in-page twice.
        selectable: opts.text === undefined ? 'none' : 'hidden',
        // A held pose is a still image, so reduced motion stills what moves rather than the sign.
        lighting: still ? 'static' : (opts.lighting ?? 'sweep'),
        effects: still ? [] : opts.effects,
        ...(opts.look !== undefined ? { look: opts.look } : {}),
        ...(tint !== undefined ? { tint } : {}),
        ...(opts.bloom !== undefined ? { bloom: opts.bloom } : {}),
        ...opts.fire,
      })
      .finally(() => {
        lit = false;
        opts.onLit?.(false);
      });
  }

  function stop(): void {
    instance?.destroy();
    instance = null;
  }

  start();

  return {
    get lit() {
      return lit;
    },
    update(patch) {
      opts = { ...opts, ...patch };
      stop();
      start();
    },
    destroy: stop,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run packages/core/test/sign/index.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sign/index.ts packages/core/test/sign/index.test.ts
git commit -m "light a held sign into an element with one call"
```

---

### Task 5: `sign()` — reduced motion, `selectable`, lifecycle

The behaviours from Task 4's implementation that its tests do not yet pin.

**Files:**
- Test: `packages/core/test/sign/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('sign', ...)` block in `packages/core/test/sign/index.test.ts`:

```ts
  it('adds no DOM copy when the anchor is the copy', () => {
    sign(anchor, { font: '/f.ttf' });
    expect(fired().selectable).toBe('none');
  });

  it('adds a hidden copy when nothing else carries the word', () => {
    sign(anchor, { font: '/f.ttf', text: 'Something Else' });
    expect(fired().selectable).toBe('hidden');
  });

  it('shows the sign under reduced motion and stills what moves', () => {
    prefersReducedMotion.mockReturnValue(true);
    sign(anchor, { font: '/f.ttf', lighting: 'pointer', effects: [{ piece: 'flicker' }] });

    expect(fire).toHaveBeenCalledOnce();
    expect(fired().lighting).toBe('static');
    expect(fired().effects).toEqual([]);
  });

  it('destroys the instance and nothing else', () => {
    const it_ = sign(anchor, { font: '/f.ttf' });
    it_.destroy();

    expect(destroy).toHaveBeenCalledOnce();
    expect(anchor.textContent).toBe('A Name');
  });

  it('re-fires on update, against the patched options', () => {
    const it_ = sign(anchor, { font: '/f.ttf', look: 'gold' });
    expect(fired().look).toBe('gold');

    it_.update({ look: 'tubing' });

    expect(destroy).toHaveBeenCalledOnce();
    expect(createKlieg).toHaveBeenCalledTimes(2);
    expect(fire.mock.calls[1]?.[1]).toMatchObject({ look: 'tubing' });
  });

  it('carries unpatched options through an update', () => {
    const it_ = sign(anchor, { font: '/f.ttf', look: 'gold', bloom: true });
    it_.update({ look: 'tubing' });

    expect(fire.mock.calls[1]?.[1]).toMatchObject({ bloom: true });
  });
```

- [ ] **Step 2: Run them**

```bash
npx vitest run packages/core/test/sign/index.test.ts
```

Expected: PASS, 14 tests — Task 4's implementation already satisfies these. If any fail, the
implementation is wrong, not the test; fix `packages/core/src/sign/index.ts`.

- [ ] **Step 3: Typecheck**

```bash
npx tsc -b
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/sign/index.test.ts
git commit -m "pin a sign's reduced-motion, selectable and update behaviour"
```

---

### Task 6: `<klieg-sign>` — registration, stylesheet, fallback marking

**Files:**
- Create: `packages/core/src/element.ts`
- Test: `packages/core/test/element.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/element.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sign, update, destroy } = vi.hoisted(() => ({
  sign: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../src/sign/index.js', () => ({ sign }));

await import('../src/element.js');

/** The custom element upgrade and the dynamic import of `sign` are both async. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let onLit: (lit: boolean) => void;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  sign.mockImplementation((_anchor: HTMLElement, opts: { onLit?: (l: boolean) => void }) => {
    onLit = opts.onLit ?? (() => {});
    return { lit: false, update, destroy };
  });
});

async function mount(html: string): Promise<HTMLElement> {
  document.body.innerHTML = html;
  await settled();
  return document.querySelector('klieg-sign') as HTMLElement;
}

describe('<klieg-sign>', () => {
  it('registers itself once the module is imported', () => {
    expect(customElements.get('klieg-sign')).toBeDefined();
  });

  it('installs exactly one stylesheet however many elements connect', async () => {
    await mount('<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>' +
      '<klieg-sign font="/f.ttf"><h1>B</h1></klieg-sign>');

    const styles = document.head.querySelectorAll('style[data-klieg-sign]');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toContain('@layer klieg');
  });

  it('marks the fallback the page supplied, and not the canvas klieg appends', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');
    el.appendChild(document.createElement('canvas'));

    expect(el.querySelector('h1')?.hasAttribute('data-klieg-fallback')).toBe(true);
    expect(el.querySelector('canvas')?.hasAttribute('data-klieg-fallback')).toBe(false);
  });

  it('anchors the sign to itself, not to the heading', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');

    expect(sign).toHaveBeenCalledOnce();
    expect(sign.mock.calls[0]?.[0]).toBe(el);
  });

  it('carries the lit state as an attribute the stylesheet can see', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');
    expect(el.hasAttribute('lit')).toBe(false);

    onLit(true);
    expect(el.hasAttribute('lit')).toBe(true);

    onLit(false);
    expect(el.hasAttribute('lit')).toBe(false);
  });

  it('destroys the sign and drops lit when it leaves the document', async () => {
    const el = await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');
    onLit(true);

    el.remove();

    expect(destroy).toHaveBeenCalledOnce();
    expect(el.hasAttribute('lit')).toBe(false);
  });

  it('never starts a sign for an element removed before the import lands', async () => {
    document.body.innerHTML = '<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>';
    document.querySelector('klieg-sign')?.remove();
    await settled();

    expect(sign).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/core/test/element.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/element.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/element.ts`:

```ts
import type { Sign, SignOptions } from './sign/index.js';

const TAG = 'klieg-sign';
const STYLE_MARK = 'data-klieg-sign';
const FALLBACK = 'data-klieg-fallback';

/**
 * `display` and `position` are not taste: klieg's `claimAnchor` refuses `display: contents|inline`
 * and needs a containing block. `@layer` puts every rule here below any the consumer writes, so
 * overriding one needs no specificity game.
 */
const CSS = `@layer klieg {
  ${TAG} { display: block; position: relative; }
  ${TAG}[lit] [${FALLBACK}] { color: transparent; }
}`;

function installStyle(doc: Document): void {
  if (doc.head.querySelector(`style[${STYLE_MARK}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARK, '');
  style.textContent = CSS;
  doc.head.appendChild(style);
}

class KliegSign extends HTMLElement {
  static observedAttributes = [
    'font',
    'text',
    'look',
    'tint',
    'framing-width',
    'framing-height',
    'align',
    'lighting',
    'bloom',
  ];

  /** Anything an attribute cannot serialize, and the full `FireOptions` escape hatch. */
  declare look?: SignOptions['look'];
  declare effects?: SignOptions['effects'];
  declare options?: SignOptions['fire'];

  #sign: Sign | null = null;
  /** Bumped on every connect and disconnect, so a late import lands on a stale element and stops. */
  #token = 0;

  connectedCallback(): void {
    installStyle(this.ownerDocument);
    const token = ++this.#token;

    // The parser reaches the open tag before the children, so an element upgraded during parsing
    // sees none of them. Waiting for the document is the only reading of "my fallback content".
    const start = () => {
      if (token !== this.#token || !this.isConnected) return;
      this.#markFallback();
      void import('./sign/index.js').then(({ sign }) => {
        if (token !== this.#token || !this.isConnected) return;
        this.#sign = sign(this, {
          ...this.#options(),
          onLit: (on) => this.toggleAttribute('lit', on),
        });
      });
    };

    if (this.ownerDocument.readyState === 'loading') {
      this.ownerDocument.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  disconnectedCallback(): void {
    this.#token++;
    this.#sign?.destroy();
    this.#sign = null;
    this.removeAttribute('lit');
  }

  attributeChangedCallback(): void {
    this.#sign?.update(this.#options());
  }

  /** Whatever the page put here, before klieg appends a canvas and a text layer of its own. */
  #markFallback(): void {
    for (const child of this.children) {
      if (child.tagName !== 'CANVAS') child.setAttribute(FALLBACK, '');
    }
  }

  #options(): SignOptions {
    return { font: this.getAttribute('font') ?? '' };
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, KliegSign);

export { KliegSign };
```

`#options()` is deliberately a stub here; Task 7 is the one that reads the rest of the attributes,
and its tests are what force them in.

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run packages/core/test/element.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/element.ts packages/core/test/element.test.ts
git commit -m "register a klieg-sign element that keeps the page's own heading"
```

---

### Task 7: `<klieg-sign>` — attributes to options

**Files:**
- Modify: `packages/core/src/element.ts`
- Test: `packages/core/test/element.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `describe('<klieg-sign>', ...)` in `packages/core/test/element.test.ts`:

```ts
  it('reads every attribute it observes', async () => {
    await mount(
      '<klieg-sign font="/f.ttf" text="Sign" look="tubing" tint="currentColor" ' +
        'framing-width="0.94" framing-height="0.66" align="center" lighting="static" bloom>' +
        '<h1>A Name</h1></klieg-sign>',
    );

    expect(sign.mock.calls[0]?.[1]).toMatchObject({
      font: '/f.ttf',
      text: 'Sign',
      look: 'tubing',
      tint: 'currentColor',
      framing: { width: 0.94, height: 0.66, align: 'center' },
      lighting: 'static',
      bloom: true,
    });
  });

  it('omits what the page did not say, so the library defaults stand', async () => {
    await mount('<klieg-sign font="/f.ttf"><h1>A Name</h1></klieg-sign>');

    const opts = sign.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(opts.framing).toBeUndefined();
    expect(opts.look).toBeUndefined();
    expect(opts.bloom).toBeUndefined();
    expect(opts.text).toBeUndefined();
  });

  it('reads a bare bloom as on and an explicit false as off', async () => {
    await mount('<klieg-sign font="/f.ttf" bloom="false"><h1>A</h1></klieg-sign>');
    expect((sign.mock.calls[0]?.[1] as { bloom?: boolean }).bloom).toBe(false);
  });

  it('ignores a framing number that is not one', async () => {
    await mount('<klieg-sign font="/f.ttf" framing-width="wide"><h1>A</h1></klieg-sign>');
    expect((sign.mock.calls[0]?.[1] as { framing?: unknown }).framing).toBeUndefined();
  });

  it('prefers the properties over the attributes for what an attribute cannot carry', async () => {
    document.body.innerHTML = '<klieg-sign font="/f.ttf"><h1>A</h1></klieg-sign>';
    const el = document.querySelector('klieg-sign') as HTMLElement & {
      effects?: unknown;
      options?: unknown;
    };
    el.effects = [{ piece: 'flicker' }];
    el.options = { blendMs: 40 };
    await settled();

    expect(sign.mock.calls[0]?.[1]).toMatchObject({
      effects: [{ piece: 'flicker' }],
      fire: { blendMs: 40 },
    });
  });

  it('re-fires through update when an observed attribute changes', async () => {
    const el = await mount('<klieg-sign font="/f.ttf" look="gold"><h1>A</h1></klieg-sign>');

    el.setAttribute('look', 'tubing');

    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]?.[0]).toMatchObject({ look: 'tubing' });
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run packages/core/test/element.test.ts
```

Expected: FAIL — the first reports `font` only and every other key undefined.

- [ ] **Step 3: Implement the attribute reading**

In `packages/core/src/element.ts`, add above `class KliegSign`:

```ts
/** A framing fraction the page did not write, or wrote as something that is not a number. */
function fraction(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : ({ [key]: value } as Record<string, T>);
}
```

and replace the `#options()` stub with:

```ts
  #options(): SignOptions {
    const width = fraction(this.getAttribute('framing-width'));
    const height = fraction(this.getAttribute('framing-height'));
    const align = (this.getAttribute('align') as Align | null) ?? undefined;
    const framing = {
      ...optional('width', width),
      ...optional('height', height),
      ...optional('align', align),
    };
    const bloomAttr = this.getAttribute('bloom');

    return {
      font: this.getAttribute('font') ?? '',
      ...optional('text', this.getAttribute('text') ?? undefined),
      // A name is a `Look`; the property carries a spec an attribute cannot hold.
      ...optional('look', this.look ?? (this.getAttribute('look') as SignOptions['look']) ?? undefined),
      ...optional('tint', this.getAttribute('tint') ?? undefined),
      ...(Object.keys(framing).length ? { framing } : {}),
      ...optional('lighting', (this.getAttribute('lighting') as SignOptions['lighting']) ?? undefined),
      ...optional('effects', this.effects),
      ...optional('bloom', bloomAttr === null ? undefined : bloomAttr !== 'false'),
      ...optional('fire', this.options),
    };
  }
```

Add the `Align` import to the top of the file, beside the other type import:

```ts
import type { Align } from './text/layout.js';
```

Both imports are `import type`, so they are erased at compile time and the element module still
reaches core only through its dynamic `import()`.

- [ ] **Step 4: Run them to verify they pass**

```bash
npx vitest run packages/core/test/element.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc -b && npx biome check .
```

Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/element.ts packages/core/test/element.test.ts
git commit -m "read a sign's settings off the element's attributes"
```

---

### Task 8: Publish the subpaths

**Files:**
- Modify: `packages/core/package.json`
- Test: `packages/core/test/readme.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/readme.test.ts`:

```ts
import { readFileSync } from 'node:fs';

describe('the published surface', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, unknown>;
    sideEffects: unknown;
  };

  it('publishes the sign and the element as their own subpaths', () => {
    expect(pkg.exports['./sign']).toEqual({
      types: './dist/sign/index.d.ts',
      default: './dist/sign/index.js',
    });
    expect(pkg.exports['./element']).toEqual({
      types: './dist/element.d.ts',
      default: './dist/element.js',
    });
    expect(pkg.exports['./element/standalone']).toBe('./dist/standalone/klieg-sign.js');
  });

  it('declares the element as having side effects, because registering one is', () => {
    // `sideEffects: false` lets a bundler drop a module nothing imports a binding from, which is
    // exactly how the element is used: imported for the registration and nothing else.
    expect(pkg.sideEffects).toEqual(['./dist/element.js', './dist/standalone/klieg-sign.js']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/core/test/readme.test.ts
```

Expected: FAIL — `expected undefined to deeply equal { types: './dist/sign/index.d.ts', … }`.

- [ ] **Step 3: Edit the manifest**

In `packages/core/package.json`, replace the `exports` block and the `sideEffects` line:

```json
  "sideEffects": ["./dist/element.js", "./dist/standalone/klieg-sign.js"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./sign": {
      "types": "./dist/sign/index.d.ts",
      "default": "./dist/sign/index.js"
    },
    "./element": {
      "types": "./dist/element.d.ts",
      "default": "./dist/element.js"
    },
    "./element/standalone": "./dist/standalone/klieg-sign.js",
    "./package.json": "./package.json"
  },
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run packages/core/test/readme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/core/test/readme.test.ts
git commit -m "publish the sign and the element as subpaths"
```

---

### Task 9: The standalone bundle

One file a static page can load with a script tag: the element, `sign()`, klieg and three, with the
dynamic import inlined rather than split into a second chunk.

**Files:**
- Create: `packages/core/standalone.vite.config.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Write the build config**

Create `packages/core/standalone.vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Nothing is external: a script tag has no resolver, so three and opentype.js go in the file.
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/element.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'klieg-sign.js',
    },
    outDir: 'dist/standalone',
    // `dist` is built by tsc first and this writes inside it.
    emptyOutDir: false,
    rollupOptions: {
      // The element imports `sign()` dynamically so a bundler can split it out. Here that would
      // produce a second file the script tag never fetches.
      output: { inlineDynamicImports: true },
    },
  },
});
```

- [ ] **Step 2: Add the script**

In `packages/core/package.json`, replace the `build` script and add one beside it:

```json
    "build": "rm -rf dist && tsc -b tsconfig.json --force && npm run build:standalone",
    "build:standalone": "vite build --config standalone.vite.config.ts",
```

- [ ] **Step 3: Build it**

```bash
cd ~/src/klieg-worktrees/sign-wrapper
npm run build -w klieg
```

Expected: tsc emits `packages/core/dist/sign/index.js`, `dist/element.js` and their `.d.ts` files,
then vite reports one chunk written to `dist/standalone/klieg-sign.js`.

- [ ] **Step 4: Verify it is one self-contained file**

```bash
ls packages/core/dist/standalone/
node -e "const s=require('node:fs').readFileSync('packages/core/dist/standalone/klieg-sign.js','utf8');
  if (/^\s*import\s.*from/m.test(s)) { console.error('FAIL: bare import survived'); process.exit(1) }
  console.log('one file, no external imports:', (s.length/1024|0)+'kb')"
```

Expected: exactly `klieg-sign.js` in the directory, and a size report with no FAIL. A second `.js`
file means `inlineDynamicImports` did not take.

- [ ] **Step 5: Commit**

```bash
git add packages/core/standalone.vite.config.ts packages/core/package.json
git commit -m "bundle the element into one file a script tag can load"
```

---

### Task 10: A lab page for the sign

**Files:**
- Create: `apps/lab/sign/index.html`
- Modify: `apps/lab/vite.config.ts`

- [ ] **Step 1: Alias the subpaths for the lab**

In `apps/lab/vite.config.ts`, replace the `alias` array with:

```ts
    alias: [
      {
        find: /^klieg\/element$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/element.ts', import.meta.url)),
      },
      {
        find: /^klieg\/sign$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/sign/index.ts', import.meta.url)),
      },
      {
        find: /^klieg$/,
        replacement: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      },
    ],
```

and add the page to `build.rollupOptions.input`, beside `strip`:

```ts
        sign: entry('./sign/index.html'),
```

- [ ] **Step 2: Write the page**

Create `apps/lab/sign/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="/klieg-mark.svg" type="image/svg+xml" />
    <title>klieg — sign element</title>

    <style>
      html { height: 100%; }
      body { margin: 0; min-height: 100%; color: #e6e9f0; background: #07080c;
             font: 14px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
             /* What `tint="currentColor"` has to resolve to. */
             --accent: #22d3ee; }
      .page { max-width: 900px; margin: 0 auto; padding: 40px 24px 80px; }
      .page p { color: #7d8494; max-width: 62ch; }

      .frame { height: 120px; background: #0d1017; border: 1px solid #1d2230; overflow: hidden; }
      .frame h1 { margin: 0; color: var(--accent); font-size: 34px; letter-spacing: 0.18em;
                  text-transform: uppercase; }
      #inherit { color: #d8b25f; }
    </style>
  </head>
  <body>
    <div class="page">
      <h2>the element, with nothing else on the page</h2>
      <p>
        No bundler entry, no script of this page's own — the module below is the whole integration.
        With JavaScript off, every heading here is simply readable.
      </p>

      <div class="frame">
        <klieg-sign id="plain" font="/font.ttf" look="gold" framing-width="0.94" framing-height="0.66">
          <h1>klieg</h1>
        </klieg-sign>
      </div>

      <h2>tint from a custom property</h2>
      <div class="frame">
        <klieg-sign id="varTint" font="/font.ttf" look="tubing" tint="var(--accent)"
                    framing-width="0.94" framing-height="0.66">
          <h1>varsign</h1>
        </klieg-sign>
      </div>

      <h2>tint inherited from the page</h2>
      <div class="frame" id="inherit">
        <klieg-sign id="currentTint" font="/font.ttf" look="tubing" tint="currentColor"
                    framing-width="0.94" framing-height="0.66">
          <h1>huesign</h1>
        </klieg-sign>
      </div>
    </div>

    <script type="module">
      import 'klieg/element';
    </script>
  </body>
</html>
```

- [ ] **Step 3: Look at it**

```bash
npm run dev -w @klieg/lab
```

Open `http://localhost:5180/sign/`. Expected: three lit signs, each meeting the left edge of its
frame (`align` defaults to `'start'` under an element placement), the second and third tinted cyan
and gold respectively, and no doubled heading showing through.

- [ ] **Step 4: Commit**

```bash
git add apps/lab/sign/index.html apps/lab/vite.config.ts
git commit -m "add a lab page whose only script is the sign element"
```

---

### Task 11: Prove the element in a browser

The things jsdom cannot answer: `currentColor` and `var()` resolution, the fallback actually going
transparent, a canvas attaching, and the GL context going back on disconnect.

**Files:**
- Create: `apps/lab/test/sign.spec.ts`

- [ ] **Step 1: Write the failing spec**

Create `apps/lab/test/sign.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const LIT = 'klieg-sign[lit]';

test.describe('the sign element', () => {
  test('reads without javascript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/sign/');

    await expect(page.locator('#plain h1')).toHaveText('klieg');
    await expect(page.locator('#plain h1')).toBeVisible();
    await expect(page.locator('#plain canvas')).toHaveCount(0);

    await context.close();
  });

  test('lights every sign and hides the heading it stands in for', async ({ page }) => {
    await page.goto('/sign/');
    await expect(page.locator(LIT)).toHaveCount(3, { timeout: 20_000 });

    await expect(page.locator('#plain canvas')).toHaveCount(1);
    // Transparent, never hidden: the name stays in selection, find-in-page and the a11y tree.
    await expect(page.locator('#plain h1')).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('#plain h1')).toBeVisible();
  });

  test('adds no second copy of the word to the accessibility tree', async ({ page }) => {
    await page.goto('/sign/');
    await expect(page.locator(LIT)).toHaveCount(3, { timeout: 20_000 });

    // `selectable: 'none'` is derived from the text coming from the anchor.
    expect(await page.locator('#plain').getByText('klieg', { exact: true }).count()).toBe(1);
  });

  test('resolves a var() tint and an inherited currentColor to different colours', async ({
    page,
  }) => {
    const tints: string[] = [];
    await page.exposeFunction('recordTint', (hex: string) => void tints.push(hex));
    await page.goto('/sign/');
    await expect(page.locator(LIT)).toHaveCount(3, { timeout: 20_000 });

    const resolved = await page.evaluate(() => {
      const read = (id: string) => {
        const host = document.getElementById(id) as HTMLElement;
        const probe = document.createElement('span');
        probe.style.color = host.getAttribute('tint') ?? '';
        host.appendChild(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      };
      return { varTint: read('varTint'), currentTint: read('currentTint') };
    });

    expect(resolved.varTint).toBe('rgb(34, 211, 238)');
    expect(resolved.currentTint).toBe('rgb(216, 178, 95)');
    expect(tints).toEqual([]);
  });

  test('gives the context back when the element leaves the document', async ({ page }) => {
    await page.goto('/sign/');
    await expect(page.locator(LIT)).toHaveCount(3, { timeout: 20_000 });

    await page.evaluate(() => document.getElementById('plain')?.remove());

    await expect(page.locator('#plain')).toHaveCount(0);
    await expect(page.locator(LIT)).toHaveCount(2);
  });
});
```

The `recordTint`/`tints` pair asserts the page's own script never had to resolve a colour — the
element did it. Keep it: it is the difference between the feature working and the test page faking it.

- [ ] **Step 2: Run it**

```bash
npx playwright test apps/lab/test/sign.spec.ts
```

Expected: PASS, 5 tests. This spec is written last on purpose — it asserts the browser behaviour
the earlier tasks could not reach, so a failure here is a defect in Tasks 3–7, not in the spec.
Fix the implementation.

- [ ] **Step 3: Check the machine before believing a failure**

```bash
uptime
```

The visual suite has produced bogus failures under load. A load average above ~50 means re-run
before diagnosing.

- [ ] **Step 4: Commit**

```bash
git add apps/lab/test/sign.spec.ts
git commit -m "prove the sign element in a browser"
```

---

### Task 12: Document it

**Files:**
- Modify: `README.md`, `CHANGELOG.md`
- Test: `packages/core/test/readme.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe('documented surface', ...)` in `packages/core/test/readme.test.ts`:

```ts
  it('exports the sign the README teaches', async () => {
    const mod = await import('../src/sign/index.js');
    expect(mod).toHaveProperty('sign');
  });
```

- [ ] **Step 2: Run it**

```bash
npx vitest run packages/core/test/readme.test.ts
```

Expected: PASS — Task 4 built it. This test exists so a rename cannot leave the README teaching a
name that is gone.

- [ ] **Step 3: Write the README section**

In `README.md`, add a section after the one covering `placement`:

````markdown
## A sign

Type that stands in for a heading, lights once and stays. `klieg/element` is a custom element that
needs no framework and no build step:

```html
<klieg-sign font="/font.ttf" look="tubing" tint="currentColor">
  <h1>Your Name</h1>
</klieg-sign>
<script type="module">import 'klieg/element'</script>
```

Your heading stays in the page — readable before any script runs, selectable, findable, and in the
markup a crawler reads. The element anchors a canvas over its own box and turns the heading
transparent once the type lands; with no WebGL, no JavaScript or a failed load, nothing happens to
it at all. Type size stays your `font-size`: `framing` is a proportion of the anchor, never a size.

Attributes: `font`, `text`, `look`, `tint`, `framing-width`, `framing-height`, `align`, `lighting`,
`bloom`. `tint` takes any CSS colour, `currentColor` and `var(--x)` included, so a sign inherits
your palette rather than repeating it. The `.look`, `.effects` and `.options` properties carry what
an attribute cannot, `.options` being a whole `FireOptions` merged over the rest.

The element imports klieg dynamically, so three.js arrives only when one connects.

For a page that would rather call a function, `klieg/sign` is the same behaviour without the
registry:

```js
import { sign } from 'klieg/sign'

const it = sign(document.querySelector('h1'), {
  font: '/font.ttf',
  tint: 'currentColor',
  onLit: (lit) => heading.classList.toggle('lit', lit),
})
```

`onLit(true)` arrives **before** the word is built, not after: building blocks the main thread and
nothing paints during it, so a class added afterwards lands seconds late.

For a static page with no npm at all, `dist/standalone/klieg-sign.js` is the element, klieg and
three in one file.
````

- [ ] **Step 4: Write the changelog entry**

In `CHANGELOG.md`, under `## Unreleased`, above the `### An anchored word…` heading:

```markdown
### A sign wrapper, and a hold that does not end

`createKlieg` + `fire` is shaped for a burst over a running app, and every consumer wanting a
**sign** — type standing in for a heading, lit once and left there — wrote the same integration
around it. Two new entry points carry it instead. `klieg/sign` exports `sign(anchor, options)`,
framework-free; `klieg/element` registers `<klieg-sign>`, which takes the page's own heading as its
content so the word stays readable, selectable and in the accessibility tree whether or not
anything renders. The element imports klieg dynamically, so three.js arrives only when one connects,
and `dist/standalone/klieg-sign.js` is the whole thing in one file for a page with no bundler.

`tint` on a sign takes any CSS colour, `currentColor` and `var(--x)` included, resolved against the
anchor — so a sign tracks the page's palette rather than repeating a number from it.

**`FireOptions.hold` gains `'forever'`**, which holds until `destroy()`. `'click'` is refused for an
element placement and there was no other way to say "indefinitely", so an anchored sign had to name
a number it did not mean. Unlike `'click'` it attaches no listener, and it is legal on every
placement.
```

- [ ] **Step 5: Run everything**

```bash
cd ~/src/klieg-worktrees/sign-wrapper
npm run check && npx playwright test
```

Expected: lint and typecheck silent, the vitest suite green with roughly 30 tests more than the
count on `origin/main`, and the playwright suite green with 5 more.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md packages/core/test/readme.test.ts
git commit -m "document the sign element and the forever hold"
```

---

## Done when

- `npm run check` and `npx playwright test` are both green, with the counts recorded rather than
  carried over from this document.
- `npm run build -w klieg` writes `dist/sign/index.js`, `dist/element.js` and a single
  `dist/standalone/klieg-sign.js`.
- The lab's `/sign/` page lights three signs, and reads as plain headings with JavaScript disabled.

## Not in this plan

- **The portfolio migration.** `SiteHeader.tsx` collapsing onto `<klieg-sign>` is the proof the
  wrapper works, and it is work in the portfolio repo against a published klieg. It is also where
  the masthead's 43px alignment compensation comes out, `framing.align` having landed.
- **A release.** Both `'forever'` and `framing.align` are minors and tagging is the owner's call.
- **Other scenario wrappers.** A one-shot celebration element is the obvious sibling; the
  `sign()`/adapter split is the seam it arrives through.
