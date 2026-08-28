# Host-driven effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host application observe an effect's phase boundaries, cancel one effect without
destroying the instance, and advance a `'click'` hold from its own input handler.

**Architecture:** `fire()` keeps returning its promise and gains an `advance()` method on it. Phase
boundaries are detected against each frame's `elapsed` by a new `PhaseReporter`, because
`Timeline.release()` rebuilds the timeline and moves `activeEnd` — nothing can be scheduled at fire
time. `Timeline` and `Sequence` grow the two read-only instants the reporter needs; `EffectQueue`
grows a caller signal so an aborted effect can be dropped while still queued.

**Tech Stack:** TypeScript, vitest, three.js. Monorepo: `packages/core` is the published library.

**Source spec:** [`2026-08-27-host-driven-effects-design.md`](../specs/2026-08-27-host-driven-effects-design.md).
Read it first — it carries the reasoning this plan only implements.

---

## Where this plan departs from the spec

Four claims in the spec are wrong or incomplete against the code as it stands. Each departure below
was verified in the tree; implement the plan, not the spec, where they disagree.

1. **`FireHandle extends Promise<void>`, not `PromiseLike<void>`.** The spec argues a thenable
   "widens the return type without breaking it." It narrows it: `PromiseLike` has no `.catch`, and
   `packages/core/dev/composition-lab/src/Preview.tsx:30` already calls `.catch(() => {})` on the
   result of `fire()`. The spec's own declaration would fail `npm run typecheck`.

2. **The class the spec calls `ShowClock` is `RafClock`,** `packages/core/src/clock.ts:41`. The
   catch-then-`queueMicrotask`-rethrow pattern it points at is `clock.ts:66-72`.

3. **Reduced motion needs its own pair of instants.** The spec says events still fire under
   `prefers-reduced-motion: reduce`, but that path pins `elapsed` to `slotDuration(enter)`
   (`index.ts:544`), so `active` fires on the first tick for free while `exit` — read off
   `activeEnd` — never fires at all. Under reduced motion both boundaries are read off `since`
   instead: the word is there from the first frame, and the hold ends where `stillDone` already
   says it does.

4. **A pending abort needs queue support.** The spec says composing the caller's signal with the
   queue's "is the whole of the work." That covers a *running* effect. `EffectQueue` has no way to
   remove one queued entry, so an effect aborted while pending would sit in the queue until its turn
   and only then no-op — not the spec's "drop from queue, never renders." `push()` takes the
   caller's signal so the queue can do both.

## File structure

| File | Responsibility |
|---|---|
| `packages/core/src/motion/phases.ts` *(new)* | `PhaseEvent`, `isolate()`, and `PhaseReporter` — per-frame boundary detection, isolated from the render loop |
| `packages/core/src/motion/compositor.ts` | `Timeline` publishes `enterEnd` and `activeEnd` |
| `packages/core/src/motion/sequence.ts` | `Sequence` publishes `exitAt` and calls `onStage` as each boundary lands |
| `packages/core/src/queue.ts` | `push()` composes a caller signal: drops a pending entry, aborts a live one |
| `packages/core/src/index.ts` | `FireHandle`, the three new `FireOptions` fields, and the wiring |
| `FEATURE-REQUESTS.md` | The asks the spec cites — untracked today |
| `README.md`, `CHANGELOG.md` | Public surface |

Phase detection is its own module rather than three more closures in `run()`, which is already 200
lines. It is the piece with real logic and no dependency on the stage, so it is the piece worth
testing on its own.

---

## Task 0: Prepare the worktree

**Files:** none.

- [ ] **Step 1: Confirm you are in the right tree**

```bash
cd ~/src/klieg-worktrees/host-driven-effects
git branch --show-current
```

Expected: `host-driven-effects`. Do **not** work in `~/src/klieg` — a concurrent session switches
branches there.

- [ ] **Step 2: Rebase onto main**

The branch is one commit behind. Do this before writing anything.

```bash
git fetch origin && git rebase main
```

Expected: `Successfully rebased and updated refs/heads/host-driven-effects.`

- [ ] **Step 3: Install dependencies**

The worktree has no `node_modules`.

```bash
npm install
```

- [ ] **Step 4: Record the green baseline**

```bash
npm test 2>&1 | tail -5
```

Expected: all tests pass. Write the count down — every later task compares against it.

---

## Task 1: Commit the feature requests the spec cites

The spec's first line says the asks "are recorded in `FEATURE-REQUESTS.md`". That file exists only
as an untracked file in `~/src/klieg` and is in no commit on any branch, so the spec currently
points at nothing.

**Files:**
- Create: `FEATURE-REQUESTS.md` (copied from the main checkout)

- [ ] **Step 1: Copy it in**

```bash
cp ~/src/klieg/FEATURE-REQUESTS.md ~/src/klieg-worktrees/host-driven-effects/FEATURE-REQUESTS.md
```

- [ ] **Step 2: Check it is the document the spec describes**

```bash
grep -c '^## ' FEATURE-REQUESTS.md
```

Expected: `3` — one section per ask (phase callback, per-fire cancellation, programmatic advance).
If it is not 3, stop and read the file; the spec and the requests have drifted apart.

- [ ] **Step 3: Commit**

```bash
git add FEATURE-REQUESTS.md
git commit -m "record the consumer requests the effects design answers"
```

---

## Task 2: `Timeline` publishes its two boundary instants

`build()` computes `enterEnd` and `activeEnd` and throws both away. `activeEnd` is the one that
moves — `release()` calls `build()` again with a new hold — which is exactly why a caller cannot
compute it.

**Files:**
- Modify: `packages/core/src/motion/compositor.ts:83-131`
- Test: `packages/core/test/motion/compositor.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` in `packages/core/test/motion/compositor.test.ts`:

```ts
  it('publishes the enter end and the active end, and moves only the latter on release', () => {
    const numeric = build(100);
    expect(numeric.enterEnd).toBe(100);
    expect(numeric.activeEnd).toBe(200);

    const held = new Timeline({
      enter: piece(100, 1),
      active: piece(50, 10),
      exit: piece(100, 100),
      hold: 'until-release',
      blendMs: 20,
    });
    expect(held.enterEnd).toBe(100);
    expect(held.activeEnd).toBe(Number.POSITIVE_INFINITY);

    held.release(500);
    // The enter is fixed; the hold it was released at is what sets the exit's start.
    expect(held.enterEnd).toBe(100);
    expect(held.activeEnd).toBe(500);
    expect(held.duration).toBe(600);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/core/test/motion/compositor.test.ts -t 'publishes the enter end'
```

Expected: FAIL — `expect(received).toBe(expected)` with `received: undefined`.

- [ ] **Step 3: Publish the instants**

In `packages/core/src/motion/compositor.ts`, replace the class's field declarations and constructor
(currently lines 84-97):

```ts
export class Timeline {
  duration: number;
  /** Where the enter piece's duration ends. Fixed: `release()` only moves what comes after it. */
  readonly enterEnd: number;
  /** Where the hold ends and the exit begins. `Infinity` on a held timeline until `release()`. */
  activeEnd: number;
  private segments: Segment[];
  private readonly blend: number;
  private readonly opts: TimelineOptions;
  private held: boolean;

  constructor(opts: TimelineOptions) {
    this.opts = opts;
    this.blend = opts.blendMs;
    this.held = opts.hold === 'until-release';
    this.duration = 0;
    this.enterEnd = slotDuration(opts.enter);
    this.activeEnd = 0;
    this.segments = [];
    this.build(this.held ? Number.POSITIVE_INFINITY : (opts.hold as number));
  }
```

Then replace `build()`'s first three lines (currently lines 99-103) so it reads off and writes back
the fields:

```ts
  private build(hold: number): void {
    const enterEnd = this.enterEnd;
    const activeEnd = enterEnd + hold;
    this.activeEnd = activeEnd;
    this.duration = activeEnd + slotDuration(this.opts.exit);
```

Delete the now-dead `const activeFor` line only if it is unused — it is not; leave
`const activeFor = slotDuration(this.opts.active);` where it is, immediately after the three lines
above.

And in `release()` (line 130), use the field rather than recomputing:

```ts
    this.build(Math.max(0, elapsed - this.enterEnd));
```

- [ ] **Step 4: Run the whole compositor suite**

```bash
npx vitest run packages/core/test/motion/compositor.test.ts
```

Expected: PASS, with no regression in the existing cases.

- [ ] **Step 5: Verify the test can go red**

Temporarily change `this.activeEnd = activeEnd;` to `this.activeEnd = enterEnd;` and re-run.
Expected: FAIL on the `activeEnd` assertions. Put it back.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/motion/compositor.ts packages/core/test/motion/compositor.test.ts
git commit -m "publish a timeline's enter end and active end"
```

---

## Task 3: `Sequence` reports each stage and where its closing exit begins

Every stage boundary passes through the private `settle()` exactly once, and `this.phase` is that
stage's index at both call sites — `tick()` settles the current phase's boundary, and
`enterNextPhase()` settles the outgoing one *before* `this.phase++`. That makes `settle()` the one
correct hook, and it is why a frame spanning several stages reports several events: `tick()`'s
`while` loop runs `enterNextPhase()` once per crossed boundary.

**Files:**
- Modify: `packages/core/src/motion/sequence.ts:45-54,128-134,201-205`
- Test: `packages/core/test/motion/sequence.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('Sequence', …)` in `packages/core/test/motion/sequence.test.ts`:

```ts
  it('reports each stage as its boundary lands, catching up across a long frame', () => {
    const seen: number[] = [];
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage(), stage(), stage()],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
      onStage: (index) => seen.push(index),
    });

    seq.tick(0);
    // The opening word is phase -1 and has no boundary, so nothing has settled yet.
    expect(seen).toEqual([]);

    seq.tick(10_000);
    expect(seen).toEqual([0, 1, 2]);
  });

  it('withholds the closing exit instant until the last phase carries it', () => {
    const t = target();
    const seq = new Sequence({
      enter: NONE,
      active: NONE,
      stages: [stage(), stage()],
      exit: NONE,
      hold: 0,
      blendMs: 0,
      target: t,
    });

    seq.tick(0);
    expect(seq.exitAt).toBe(Number.POSITIVE_INFINITY);

    seq.tick(10_000);
    expect(seq.exitAt).toBe(600);
  });
```

Where 600 comes from, since the numbers are all `stage()`'s defaults in this file — `hold: 100`,
`tween: { duration: 200 }`, `exit: NONE`, and `blendMs: 0`. A stage's span is
`max(move, leave > 0 ? leave + half : 0)` = `max(200, 0)` = 200; `partition` takes the longer of its
two halves, so each stage timeline's enter lasts 200 and the timeline runs `200 + 100` = 300. The
opening timeline is all zeroes, so phase 0 starts at 0 and phase 1 starts at 300 — and phase 1's own
exit begins 300 into it.

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run packages/core/test/motion/sequence.test.ts -t 'closing exit instant'
```

Expected: FAIL — `seq.exitAt` is `undefined`; the getter does not exist yet.

- [ ] **Step 3: Add the callback and the getter**

In `packages/core/src/motion/sequence.ts`, add to `SequenceOptions` (after `target`, line 52):

```ts
  /** Called as each stage's boundary lands, with that stage's index. Never called for the
   *  opening word, which is phase -1 and has no boundary. */
  onStage?: (index: number) => void;
```

Add the call to `settle()` (line 128-134), last so a listener cannot observe a half-landed
boundary:

```ts
  private settle(): void {
    const boundary = this.pending;
    if (!boundary) return;
    this.pending = null;
    this.opts.target.setFitProgress(1);
    this.retire(boundary);
    this.opts.onStage?.(this.phase);
  }
```

Add the getter beside `isFinished` (after line 205):

```ts
  /**
   * Global elapsed at which the closing exit begins. `Infinity` while an earlier phase is running
   * or the last phase's hold is still open, since neither has an instant to give yet.
   */
  get exitAt(): number {
    if (this.phase < this.opts.stages.length - 1) return Number.POSITIVE_INFINITY;
    return this.phaseStart + this.timeline.activeEnd;
  }
```

- [ ] **Step 4: Run the sequence suite**

```bash
npx vitest run packages/core/test/motion/sequence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify the catch-up test can go red**

The `[0, 1, 2]` assertion is the one that guards the spec's second trap. Temporarily replace
`tick()`'s `while` with `if` (line 106) and re-run.

Expected: FAIL with `seen` equal to `[0]` or `[0, 1]` — a frame spanning several stages reported
fewer events than it crossed. Put the `while` back.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/motion/sequence.ts packages/core/test/motion/sequence.test.ts
git commit -m "report a sequence's stage boundaries and its closing exit instant"
```

---

## Task 4: `PhaseReporter` detects boundaries per frame

**Files:**
- Create: `packages/core/src/motion/phases.ts`
- Test: `packages/core/test/motion/phases.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/motion/phases.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { isolate, type PhaseEvent, PhaseReporter } from '../../src/motion/phases.js';

const INF = Number.POSITIVE_INFINITY;

describe('PhaseReporter', () => {
  it('reports active once the enter has run its length, and only once', () => {
    const seen: PhaseEvent[] = [];
    const r = new PhaseReporter((e) => seen.push(e));

    r.observe(50, 100, 500);
    expect(seen).toEqual([]);

    r.observe(100, 100, 500);
    r.observe(160, 100, 500);
    expect(seen).toEqual([{ phase: 'active' }]);
  });

  it('withholds exit while the hold is still open, then reports it once released', () => {
    const seen: PhaseEvent[] = [];
    const r = new PhaseReporter((e) => seen.push(e));

    // A click hold: no exit instant exists yet, however far the clock runs.
    r.observe(0, 0, INF);
    r.observe(60_000, 0, INF);
    expect(seen).toEqual([{ phase: 'active' }]);

    // release() has now rebuilt the timeline and put activeEnd at 60_000.
    r.observe(60_016, 0, 60_000);
    r.observe(60_032, 0, 60_000);
    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('passes a stage index straight through', () => {
    const seen: PhaseEvent[] = [];
    const r = new PhaseReporter((e) => seen.push(e));

    r.stage(0);
    r.stage(1);
    expect(seen).toEqual([
      { phase: 'stage', index: 0 },
      { phase: 'stage', index: 1 },
    ]);
  });
});

describe('isolate', () => {
  it('sends a throwing listener to the microtask queue instead of the caller', () => {
    const queued: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => queued.push(fn));

    const emit = isolate(() => {
      throw new Error('host');
    });

    expect(() => emit({ phase: 'active' })).not.toThrow();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toThrow('host');

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run packages/core/test/motion/phases.test.ts
```

Expected: FAIL — `Failed to resolve import "../../src/motion/phases.js"`.

- [ ] **Step 3: Write the module**

Create `packages/core/src/motion/phases.ts`:

```ts
export type PhaseEvent =
  | { phase: 'active' }
  | { phase: 'exit' }
  | { phase: 'stage'; index: number };

export type PhaseListener = (event: PhaseEvent) => void;

/**
 * A throwing listener reaches the host as an unhandled rejection rather than killing the frame
 * loop — the same trade `RafClock` makes for a throwing subscriber.
 */
export function isolate(listener: PhaseListener): PhaseListener {
  return (event) => {
    try {
      listener(event);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  };
}

/**
 * Detects the two timed boundaries against each frame's elapsed time. They cannot be scheduled
 * when the effect is fired: `Timeline.release()` rebuilds the timeline and moves `activeEnd`, so a
 * click hold has no exit instant at all until the press lands.
 */
export class PhaseReporter {
  private sentActive = false;
  private sentExit = false;

  constructor(private readonly emit: PhaseListener) {}

  /** `exitAt` is `Infinity` while a hold is still open. */
  observe(elapsed: number, enterEnd: number, exitAt: number): void {
    if (!this.sentActive && elapsed >= enterEnd) {
      this.sentActive = true;
      this.emit({ phase: 'active' });
    }
    if (!this.sentExit && elapsed >= exitAt) {
      this.sentExit = true;
      this.emit({ phase: 'exit' });
    }
  }

  stage(index: number): void {
    this.emit({ phase: 'stage', index });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run packages/core/test/motion/phases.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the click-hold test can go red**

This is the test that stands in for the spec's first trap. Temporarily change `observe` to schedule
instead of detect — replace its body with a version that reports `exit` at `enterEnd + 1200` — and
re-run.

Expected: FAIL on `withholds exit while the hold is still open`. Put it back.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/motion/phases.ts packages/core/test/motion/phases.test.ts
git commit -m "detect effect phase boundaries per frame rather than per schedule"
```

---

## Task 5: `EffectQueue` composes a caller's signal

**Files:**
- Modify: `packages/core/src/queue.ts:5-10,39-57,66-109`
- Test: `packages/core/test/queue.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside `describe('EffectQueue', …)` in `packages/core/test/queue.test.ts`:

```ts
  it('drops a queued effect on the caller signal without ever running it', async () => {
    const q = new EffectQueue('queue');
    const ctrl = new AbortController();
    let ran = false;

    const first = q.push('a', (signal) => abortable(signal));
    const second = q.push(
      'b',
      async () => {
        ran = true;
      },
      ctrl.signal,
    );

    ctrl.abort();
    await expect(second).resolves.toBeUndefined();
    expect(ran).toBe(false);

    await q.cancelAll();
    await first;
  });

  it('aborts a running effect on the caller signal, leaving the queue alive', async () => {
    const q = new EffectQueue('queue');
    const ctrl = new AbortController();
    let seen: AbortSignal | null = null;

    const done = q.push(
      'a',
      (signal) => {
        seen = signal;
        return abortable(signal);
      },
      ctrl.signal,
    );
    await Promise.resolve();

    ctrl.abort();
    await expect(done).resolves.toBeUndefined();
    expect(seen?.aborted).toBe(true);

    let after = false;
    await q.push('b', async () => {
      after = true;
    });
    expect(after).toBe(true);
  });

  it('never starts an effect whose signal aborted before the push', async () => {
    const q = new EffectQueue('queue');
    const ctrl = new AbortController();
    ctrl.abort();
    let ran = false;

    await expect(
      q.push(
        'a',
        async () => {
          ran = true;
        },
        ctrl.signal,
      ),
    ).resolves.toBeUndefined();
    expect(ran).toBe(false);
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run packages/core/test/queue.test.ts -t 'caller signal'
```

Expected: FAIL — the third argument is ignored, so `second` stays pending and the test times out or
`ran` is `true`.

- [ ] **Step 3: Take the signal in `push`**

In `packages/core/src/queue.ts`, extend `Entry` (lines 5-10):

```ts
interface Entry {
  id: string;
  run: EffectRunner;
  resolve: () => void;
  reject: (e: unknown) => void;
  /** The caller's own signal, composed with this queue's rather than replacing it. */
  signal?: AbortSignal;
  /** Drops the pending-abort listener once the entry leaves the queue, however it leaves. */
  unwatch: () => void;
}
```

Replace `push` (lines 39-57):

```ts
  push(id: string, run: EffectRunner, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: Entry = { id, run, resolve, reject, signal, unwatch: () => {} };

      // Already aborted: resolve here rather than queue an effect whose only job is to no-op
      // when its turn finally comes round.
      if (signal?.aborted) {
        resolve();
        return;
      }

      if (this.policy === 'concurrent') {
        void this.start(entry);
        return;
      }
      if (this.policy === 'replace') {
        this.abortLive();
        this.dropPending();
      }

      if (signal) {
        const onAbort = () => this.dropOne(entry);
        signal.addEventListener('abort', onAbort);
        entry.unwatch = () => signal.removeEventListener('abort', onAbort);
      }

      this.pending.push(entry);
      // Guarding on `live` instead would start a second drain when an effect settles
      // and its own completion handler pushes, running two effects at once.
      if (!this.draining) void this.drain();
    });
  }

  /** Takes one effect out of the queue before it ever runs. A no-op once it has started. */
  private dropOne(entry: Entry): void {
    const at = this.pending.indexOf(entry);
    if (at < 0) return;
    this.pending.splice(at, 1);
    entry.unwatch();
    entry.resolve();
  }
```

Replace `dropPending` (lines 70-74) so a bulk drop releases its listeners too:

```ts
  private dropPending(): void {
    const dropped = this.pending;
    this.pending = [];
    for (const entry of dropped) {
      entry.unwatch();
      entry.resolve();
    }
  }
```

Replace `start` and `execute` (lines 87-109):

```ts
  private start(entry: Entry): Promise<void> {
    // It is no longer pending, so the drop listener has nothing left to drop.
    entry.unwatch();
    const slot: Slot = {
      id: entry.id,
      controller: new AbortController(),
      settled: Promise.resolve(),
    };

    let unwatch = () => {};
    const caller = entry.signal;
    if (caller) {
      if (caller.aborted) slot.controller.abort();
      else {
        const onAbort = () => slot.controller.abort();
        caller.addEventListener('abort', onAbort);
        unwatch = () => caller.removeEventListener('abort', onAbort);
      }
    }

    this.live.add(slot);
    // A runner that calls cancelAll from its own synchronous prologue observes the placeholder
    // and is not waited for. Unreachable while every runner awaits something first.
    slot.settled = this.execute(entry, slot, unwatch);
    return slot.settled;
  }

  private async execute(entry: Entry, slot: Slot, unwatch: () => void): Promise<void> {
    try {
      await entry.run(slot.controller.signal);
      entry.resolve();
    } catch (e) {
      entry.reject(e);
    } finally {
      // A host that keeps one signal across many fires would otherwise collect a listener per fire.
      unwatch();
      this.live.delete(slot);
    }
  }
```

- [ ] **Step 4: Run the queue suite**

```bash
npx vitest run packages/core/test/queue.test.ts
```

Expected: PASS, including every pre-existing case.

- [ ] **Step 5: Verify the pending-drop test can go red**

Temporarily make `dropOne` a no-op body (`return;` on its first line) and re-run.

Expected: FAIL on `drops a queued effect on the caller signal` — `second` never resolves. Put it
back.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/queue.ts packages/core/test/queue.test.ts
git commit -m "compose a caller's abort signal with the queue's own"
```

---

## Task 6: `fire()` returns a handle that can advance a hold

**Files:**
- Modify: `packages/core/src/index.ts:311-316` (the `Klieg` interface), `:383-419` (`run`'s
  signature and the dismissal block), `:487-500` (`settle`), `:635-660` (`fire`)
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `packages/core/test/index.test.ts`, after
`describe('holding until dismissed', …)`:

```ts
describe('driving an effect from the host', () => {
  const HELD = { enter: 'none', active: 'none', exit: 'none', hold: 'click' } as const;

  it('advances a hold from the handle, whoever owns the listeners', async () => {
    const bk = create();
    const done = bk.fire('HI', HELD);
    await flush();
    clock.advance(1000);
    expect(words()).toHaveLength(1);

    done.advance();
    clock.advance(16);
    await done;

    expect(words()).toHaveLength(0);
  });

  it('spends an advance that arrived before the effect did on its first hold', async () => {
    const bk = create();
    const first = bk.fire('ONE', HELD);
    const second = bk.fire('TWO', HELD);
    await flush();

    // Queued behind a held effect: there is no hold yet for this press to release.
    second.advance();

    dispatch('pointerdown');
    clock.advance(16);
    await first;
    await flush();

    clock.advance(16);
    await second;
    expect(words()).toHaveLength(0);
  });

  it('leaves the handle inert rather than absent on an unsupported instance', async () => {
    stubWebgl(false);
    const bk = create();

    const done = bk.fire('HI', HELD);
    expect(() => done.advance()).not.toThrow();
    await expect(done).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run packages/core/test/index.test.ts -t 'driving an effect from the host'
```

Expected: FAIL — `done.advance is not a function`.

- [ ] **Step 3: Declare the handle**

In `packages/core/src/index.ts`, add above `export interface Klieg` (line 311):

```ts
/**
 * What `fire()` hands back: the promise it has always been, plus control over this one effect.
 * A `Promise` rather than a bare thenable — callers already use `.catch()` on a fire.
 */
export interface FireHandle extends Promise<void> {
  /**
   * Treats this as the dismissing press. A no-op unless a hold is waiting for one; called before
   * the effect starts, it releases the first hold that effect reaches rather than being lost.
   */
  advance(): void;
}
```

Change the `Klieg` interface's `fire` (line 314):

```ts
  fire(text: string, options?: FireOptions): FireHandle;
```

- [ ] **Step 4: Thread a control object through `run`**

Add above `createKlieg` (before line 320):

```ts
/** The live link between a `FireHandle` and its effect, which may not have started yet. */
interface FireControl {
  /** Set while the effect is waiting on a dismissal; null before it starts and after it settles. */
  dismiss: (() => void) | null;
  /** An `advance()` that arrived before the effect did, to spend on its first hold. */
  latched: boolean;
}
```

Change `run`'s signature (line 383):

```ts
  async function run(
    text: string,
    opts: FireOptions,
    signal: AbortSignal,
    control: FireControl,
  ): Promise<void> {
```

In `settle` (inside the `await new Promise` executor, currently line 487), add the line that makes
`advance()` a no-op once the effect is done — first, so a listener cannot reach a torn-down driver:

```ts
      const settle = (done: () => void) => {
        if (settled) return;
        settled = true;
        control.dismiss = null;
        off();
        detachDismiss();
        stage.scene.remove(word.group);
        host?.remove();
        word.dispose();
        bloom?.dispose();
        stage.scheduleIdleTeardown();
        done();
      };
```

At the end of the `if (awaitsClick) { … }` block, after `detachDismiss` is assigned (currently line
518), publish the dismissal and spend any latch:

```ts
        control.dismiss = dismiss;
        if (control.latched) {
          control.latched = false;
          dismiss();
        }
```

- [ ] **Step 5: Build the handle in `fire`**

Replace the `fire` method's body (lines 636-659) — keep the existing guard comment and error
verbatim, changing only the return type and the two returns:

```ts
    fire(text, opts = {}) {
      const control: FireControl = { dismiss: null, latched: false };
      const handle = (promise: Promise<void>): FireHandle =>
        Object.assign(promise, {
          advance(): void {
            if (control.dismiss) control.dismiss();
            else control.latched = true;
          },
        });

      // The dismissal is a press anywhere in the window, which on a strip sharing a page ends the
      // effect on clicks that have nothing to do with it. An anchor filling the viewport has no
      // such clicks, so it may opt in; one that has not stays out rather than stall on a listener
      // it never wanted.
      if (
        anchored &&
        !clickAnywhere &&
        (opts.hold === 'click' || opts.stages?.some((s) => s.hold === 'click'))
      ) {
        throw new Error(
          "klieg: an element placement takes `hold: 'click'` only with `clickAnywhere` set on it",
        );
      }
      if (!supported || destroyed) return handle(Promise.resolve());
      return handle(queue.push(`${counter++}:${text}`, (signal) => run(text, opts, signal, control)));
    },
```

- [ ] **Step 6: Run the new tests, then the whole suite**

```bash
npx vitest run packages/core/test/index.test.ts -t 'driving an effect from the host'
npm test 2>&1 | tail -5
```

Expected: PASS, at the baseline count from Task 0 plus everything added so far.

- [ ] **Step 7: Verify the latch test can go red**

The latch is the part that keeps a presenter's press from vanishing into a race. Temporarily delete
the `if (control.latched) { … }` block and re-run.

Expected: FAIL on `spends an advance that arrived before the effect did` — `second` never resolves.
Put it back.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck && npm run lint
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "hand fire() back a handle that can advance a held effect"
```

---

## Task 7: `onPhase` reports the boundaries

**Files:**
- Modify: `packages/core/src/index.ts` — imports, `FireOptions`, `run`'s locals and its tick
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('driving an effect from the host', …)` block from Task 6:

```ts
  it('reports active when the enter has run its length, and exit when the hold is over', async () => {
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', {
      enter: { duration: 100, offset: () => ({}) },
      active: 'none',
      exit: 'none',
      hold: 50,
      blendMs: 0,
      onPhase: (e) => seen.push(e),
    });
    await flush();

    clock.advance(50);
    expect(seen).toEqual([]);

    clock.advance(60);
    expect(seen).toEqual([{ phase: 'active' }]);

    clock.advance(100);
    await done;
    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('reports exit only once a click hold is released, which no fire-time schedule can know', async () => {
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', { ...HELD, onPhase: (e) => seen.push(e) });
    await flush();

    clock.advance(60_000);
    expect(seen).toEqual([{ phase: 'active' }]);

    dispatch('pointerdown');
    clock.advance(16);
    await done;

    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('reports every stage a long frame crosses, not just the last', async () => {
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('ABCD', {
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 0,
      blendMs: 0,
      stages: [
        { keep: (l) => l.index < 3, exit: 'none', hold: 0, tween: { duration: 10 } },
        { keep: (l) => l.index < 2, exit: 'none', hold: 0, tween: { duration: 10 } },
        { keep: (l) => l.index < 1, exit: 'none', hold: 0, tween: { duration: 10 } },
      ],
      onPhase: (e) => seen.push(e),
    });
    await flush();

    // One frame, long enough to cross all three boundaries at once.
    clock.advance(10_000);
    await done;

    // Filtered because a single frame this long collapses the timed boundaries against the
    // stage ones; their relative order is not what this test is about.
    expect(seen.filter((e) => e.phase === 'stage')).toEqual([
      { phase: 'stage', index: 0 },
      { phase: 'stage', index: 1 },
      { phase: 'stage', index: 2 },
    ]);
  });

  it('reports both phases under reduced motion, which holds the pose without travelling', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const seen: PhaseEvent[] = [];
    const bk = create();
    const done = bk.fire('HI', {
      enter: { duration: 400, offset: () => ({}) },
      active: 'none',
      exit: { duration: 300, offset: () => ({}) },
      hold: 100,
      onPhase: (e) => seen.push(e),
    });
    await flush();

    clock.advance(16);
    expect(seen).toEqual([{ phase: 'active' }]);

    clock.advance(100);
    await done;
    expect(seen).toEqual([{ phase: 'active' }, { phase: 'exit' }]);
  });

  it('fires no phase event on an unsupported instance, which renders nothing', async () => {
    stubWebgl(false);
    const seen: PhaseEvent[] = [];
    const bk = create();

    await bk.fire('HI', { onPhase: (e) => seen.push(e) });

    expect(seen).toEqual([]);
  });

  it('keeps rendering when onPhase throws, and hands the error to the microtask queue', async () => {
    const queued: (() => void)[] = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => queued.push(fn));

    const bk = create();
    const done = bk.fire('HI', {
      enter: 'none',
      active: 'none',
      exit: 'none',
      hold: 50,
      onPhase: () => {
        throw new Error('host');
      },
    });
    await flush();

    clock.advance(16);
    clock.advance(100);
    await expect(done).resolves.toBeUndefined();

    expect(queued).toHaveLength(2);
    expect(queued[0]).toThrow('host');
    expect(words()).toHaveLength(0);
  });
```

Add `PhaseEvent` to the import from `../src/index.js` at the top of the file:

```ts
  type FireOptions,
  type KliegOptions,
  type PhaseEvent,
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run packages/core/test/index.test.ts -t 'reports active when the enter'
```

Expected: FAIL — `onPhase` is not a known property, and `seen` stays empty.

- [ ] **Step 3: Import and re-export the phase types**

At the top of `packages/core/src/index.ts`, beside the other `./motion/` imports (after line 9):

```ts
import { isolate, type PhaseEvent, PhaseReporter } from './motion/phases.js';
```

And with the other motion re-exports (beside line 82, `export type { LetterInfo, … }`):

```ts
export type { PhaseEvent, PhaseListener } from './motion/phases.js';
```

- [ ] **Step 4: Add the option**

In `FireOptions`, after `stages` (line 284):

```ts
  /**
   * Called as the effect crosses each phase boundary. `active` is the instant the word has landed
   * and is at full presence — mid-blend, which is what a host swapping a page behind the flourish
   * wants. A listener that throws does not stop the render loop.
   */
  onPhase?: (event: PhaseEvent) => void;
```

- [ ] **Step 5: Build the reporter and hand it to the sequence**

In `run()`, replace `const exit = resolveSlot(opts.exit ?? 'fade', EXIT);` (line 446) and the lines
around it so the enter's length is named once rather than recomputed inside the tick:

```ts
    const exit = resolveSlot(opts.exit ?? 'fade', EXIT);
    const enterEnd = slotDuration(enter);
```

Add `slotDuration` to the existing `./motion/compositor.js` import at line 6 — it already imports
`slotDuration`, so no change is needed; confirm with:

```bash
grep -n "from './motion/compositor.js'" packages/core/src/index.ts
```

Build the reporter immediately before the `sequence` construction (line 464), and pass `onStage`:

```ts
    const reporter = opts.onPhase ? new PhaseReporter(isolate(opts.onPhase)) : null;
    const sequence = stages.length
      ? new Sequence({
          enter,
          active,
          stages: stages.map((s) => ({
            keep: s.keep,
            exit: resolveSlot(s.exit ?? 'fade', EXIT),
            as: s.as,
            active: resolveSlot(s.active ?? 'none', ACTIVE),
            hold: s.hold ?? 1200,
            tween: s.tween ?? {},
          })),
          exit,
          hold: untilClick ? 'click' : (hold as number),
          blendMs,
          target: word,
          onStage: reporter ? (index) => reporter.stage(index) : undefined,
        })
      : null;
```

- [ ] **Step 6: Observe the boundaries in the tick**

Inside the clock subscriber, replace the `const settled = slotDuration(enter);` line (line 543 —
it shadows the outer `settled` flag) and the line after it, then add the observation immediately
after `sequence?.tick(elapsed)`:

```ts
          const raw = Math.max(still ? enterEnd : since, 0);
          const elapsed = sequence ? raw : Math.min(raw, timeline.duration);
          // Ahead of the pose, or the fit and the phase advance both lag it by a frame.
          sequence?.tick(elapsed);

          // Detected against this frame rather than scheduled at fire time: `release()` moves
          // `activeEnd`, so a click hold has no exit instant until the press lands. Reduced
          // motion pins `elapsed` to the settled pose, so it reads both boundaries off `since`.
          if (reporter) {
            if (still) {
              const over = untilClick ? (released ? 0 : Number.POSITIVE_INFINITY) : (hold as number);
              reporter.observe(since, 0, over);
            } else {
              reporter.observe(elapsed, enterEnd, sequence ? sequence.exitAt : timeline.activeEnd);
            }
          }
```

`released` is declared in the enclosing `new Promise` executor, above the subscription, so it is in
scope here.

- [ ] **Step 7: Run the new tests, then the whole suite**

```bash
npx vitest run packages/core/test/index.test.ts -t 'driving an effect from the host'
npm test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 8: Verify the reduced-motion test can go red**

Reduced motion is the case the spec asserts and the code does not naturally give. Temporarily drop
the `if (still)` branch — call `reporter.observe(elapsed, enterEnd, …)` unconditionally — and
re-run.

Expected: FAIL on `reports both phases under reduced motion`, with `seen` holding only
`{ phase: 'active' }`. Put the branch back.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck && npm run lint
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "report an effect's phase boundaries to its caller"
```

---

## Task 8: `signal` aborts one effect

**Files:**
- Modify: `packages/core/src/index.ts` — `FireOptions`, and the `queue.push` call in `fire`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `describe('driving an effect from the host', …)`:

```ts
  it('aborts one running effect on its own signal and leaves the instance alive', async () => {
    const ctrl = new AbortController();
    const bk = create();
    const done = bk.fire('HI', {
      enter: 'none',
      active: 'none',
      exit: { duration: 500, offset: () => ({ opacity: 0 }) },
      hold: 5000,
      signal: ctrl.signal,
    });
    await flush();
    clock.advance(16);
    expect(words()).toHaveLength(1);

    // No exit plays: the abort resolves the fire rather than rejecting it.
    ctrl.abort();
    await expect(done).resolves.toBeUndefined();
    expect(words()).toHaveLength(0);

    const next = bk.fire('AGAIN', INSTANT);
    await flush();
    clock.advance(16);
    await expect(next).resolves.toBeUndefined();
  });

  it('drops a queued effect on its own signal, so it never mounts a word', async () => {
    const ctrl = new AbortController();
    const bk = create();
    const first = bk.fire('ONE', HELD);
    const second = bk.fire('TWO', { ...INSTANT, signal: ctrl.signal });
    await flush();
    clock.advance(16);
    expect(peakWords).toBe(1);

    ctrl.abort();
    await expect(second).resolves.toBeUndefined();

    dispatch('pointerdown');
    clock.advance(16);
    await first;

    expect(peakWords).toBe(1);
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run packages/core/test/index.test.ts -t 'on its own signal'
```

Expected: FAIL — `signal` is not a known property of `FireOptions`.

- [ ] **Step 3: Add the option**

In `FireOptions`, after `onPhase`:

```ts
  /**
   * Aborts this one effect without touching the instance. Composed with the queue's own signal
   * rather than replacing it: an abort plays no exit, and the promise resolves rather than
   * rejecting, which is what it already promises for an effect the queue drops.
   */
  signal?: AbortSignal;
```

- [ ] **Step 4: Pass it to the queue**

In `fire`, the final return becomes:

```ts
      return handle(
        queue.push(
          `${counter++}:${text}`,
          (signal) => run(text, opts, signal, control),
          opts.signal,
        ),
      );
```

- [ ] **Step 5: Run the new tests, then the whole suite**

```bash
npx vitest run packages/core/test/index.test.ts -t 'on its own signal'
npm test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 6: Verify the queued-drop test can go red**

Temporarily drop the third argument from the `queue.push` call and re-run.

Expected: FAIL on `drops a queued effect on its own signal` — `peakWords` reaches 2, because the
queued effect ran anyway once the held one was dismissed. Put it back.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck && npm run lint
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "abort one effect from a caller's own signal"
```

---

## Task 9: `dismiss: 'host'` withholds the window listeners

With no listener on `window` there is nothing for `clickAnywhere` to gate, so an anchored placement
may hold on a click under host dismissal without the opt-in. `modal` still makes the overlay
swallow presses — a host that has taken the input has taken Escape too, and wiring it is the host's
business.

**Files:**
- Modify: `packages/core/src/index.ts` — `FireOptions`, the dismissal block in `run`, the guard in
  `fire`
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `describe('driving an effect from the host', …)`:

```ts
  it("attaches no window listeners under dismiss: 'host'", async () => {
    const bk = create();
    const done = bk.fire('HI', { ...HELD, dismiss: 'host' });
    await flush();
    clock.advance(1000);

    expect(listeners.get('pointerdown') ?? []).toHaveLength(0);
    expect(listeners.get('keydown') ?? []).toHaveLength(0);

    // The presses klieg would have caught reach nothing at all.
    dispatch('pointerdown');
    dispatch('keydown', { key: 'Escape' });
    clock.advance(16);
    await flush();
    expect(words()).toHaveLength(1);

    done.advance();
    clock.advance(16);
    await done;
    expect(words()).toHaveLength(0);
  });

  it('still lets a modal hold swallow presses when the host owns the dismissal', async () => {
    const interactive = vi.spyOn(Stage.prototype, 'setInteractive').mockImplementation(() => {});

    const bk = create();
    const done = bk.fire('HI', { ...HELD, dismiss: 'host', modal: true });
    await flush();
    clock.advance(16);

    expect(interactive).toHaveBeenCalledWith(true);

    done.advance();
    clock.advance(16);
    await done;
    expect(interactive).toHaveBeenLastCalledWith(false);
  });
```

And, in the anchored-placement `describe` that already holds the `clickAnywhere` cases (around
line 1571):

```ts
  it("takes hold: 'click' from an anchor with no opt-in once the host owns the dismissal", () => {
    const klieg = create({ placement: { kind: 'element', el }, target: undefined });

    // `clickAnywhere` gates a window listener, and `dismiss: 'host'` attaches none.
    expect(() => klieg.fire('hi', { hold: 'click', dismiss: 'host' })).not.toThrow();
    expect(() => klieg.fire('hi', { stages: [{ hold: 'click' }], dismiss: 'host' })).not.toThrow();
    klieg.destroy();
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run packages/core/test/index.test.ts -t "dismiss: 'host'"
```

Expected: FAIL — `dismiss` is not a known property of `FireOptions`.

- [ ] **Step 3: Add the option**

In `FireOptions`, after `modal` (line 270):

```ts
  /**
   * Who dismisses a `'click'` hold. `'host'` attaches no window listeners at all — neither
   * `pointerdown` nor `Escape` — so one press does one thing, and `advance()` on the handle is
   * the only way out. Per effect rather than per instance, so window-dismissed flourishes and
   * host-driven held slides can share one `Klieg`.
   */
  dismiss?: 'window' | 'host';
```

- [ ] **Step 4: Branch the dismissal block**

In `run()`, replace the body of `if (awaitsClick) { … }` (lines 502-518, from the `const dismiss =`
closure through the `detachDismiss` assignment) with:

```ts
      if (awaitsClick) {
        // Not one-shot with stages: each dismissal advances one stage, and only the last ends it.
        const dismiss = () => {
          if (released) return;
          const since = clock.now() - startedAt;
          driver.release(since);
          if (!sequence || sequence.isFinished(since)) {
            released = true;
            detachDismiss();
          }
        };

        // A modal hold is a keyboard trap without Escape: it swallows input and never times out.
        // Under host dismissal that trade is the host's to make, since it holds the input.
        if (opts.modal) stage.setInteractive(true);

        if (opts.dismiss === 'host') {
          detachDismiss = () => {
            stage.setInteractive(false);
            detachDismiss = () => {};
          };
        } else {
          // Capture on window catches the press in both modes; `modal` only decides whether the
          // canvas absorbs it on the way down or the page underneath sees it too.
          const onPointer = () => dismiss();
          const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') dismiss();
          };
          globalThis.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
          globalThis.addEventListener('keydown', onKey);

          detachDismiss = () => {
            globalThis.removeEventListener('pointerdown', onPointer, { capture: true });
            globalThis.removeEventListener('keydown', onKey);
            stage.setInteractive(false);
            detachDismiss = () => {};
          };
        }

        control.dismiss = dismiss;
        if (control.latched) {
          control.latched = false;
          dismiss();
        }
      }
```

- [ ] **Step 5: Exempt host dismissal from the `clickAnywhere` guard**

In `fire`, extend the condition and its comment:

```ts
      // The dismissal is a press anywhere in the window, which on a strip sharing a page ends the
      // effect on clicks that have nothing to do with it. An anchor filling the viewport has no
      // such clicks, so it may opt in; one that has not stays out rather than stall on a listener
      // it never wanted. `dismiss: 'host'` attaches no listener, so there is nothing to gate.
      if (
        anchored &&
        !clickAnywhere &&
        opts.dismiss !== 'host' &&
        (opts.hold === 'click' || opts.stages?.some((s) => s.hold === 'click'))
      ) {
```

- [ ] **Step 6: Run the new tests, then the whole suite**

```bash
npx vitest run packages/core/test/index.test.ts -t "dismiss: 'host'"
npm test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 7: Verify the listener test can go red**

Temporarily change `opts.dismiss === 'host'` in the dismissal block to `false` and re-run.

Expected: FAIL on `attaches no window listeners` — `pointerdown` has one listener and the word is
gone before `advance()` is reached. Put it back.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run typecheck && npm run lint
git add packages/core/src/index.ts packages/core/test/index.test.ts
git commit -m "let a host own a held effect's dismissal"
```

---

## Task 10: Document the surface

**Files:**
- Modify: `README.md:433-448` (the `fire()` option table), `:465-478` (holding until dismissed)
- Modify: `CHANGELOG.md:1-3`
- Test: `packages/core/test/readme.test.ts`

- [ ] **Step 1: Add the new options to the `fire(text, options)` table**

After the `modal` row (README line 446):

```markdown
| `onPhase` | none | called as the effect crosses each boundary — `{ phase: 'active' }` when the word has landed, `{ phase: 'exit' }` when the hold is over, `{ phase: 'stage', index }` as each stage settles |
| `dismiss` | `'window'` | who dismisses a `'click'` hold; `'host'` attaches no window listeners and leaves `advance()` as the only way out |
| `signal` | none | aborts this one effect: no exit plays, and the promise resolves rather than rejecting |
```

And amend the `hold` row, which currently says `'click'` is refused under an element placement:

```markdown
| `hold` | `1200` | milliseconds in the active phase, or `'click'` to hold until dismissed; under an element `placement`, `'click'` needs either `clickAnywhere` on the placement or `dismiss: 'host'` |
```

- [ ] **Step 2: Extend "Holding until dismissed"**

Append to that section, after the paragraph ending "…are the only two things that stop a click
reaching your page." (README line 478):

````markdown
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
````

- [ ] **Step 3: Add the phase callback to the README's teaching prose**

After the paragraph at README line 38 ("`fire()` resolves once the effect has left the screen…"),
add:

````markdown
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
````

- [ ] **Step 4: Write the changelog entry**

Insert after `# Changelog` (CHANGELOG.md line 1), above `## 0.9.0`:

```markdown
## Unreleased

### A host can watch, cancel and advance one effect

Three additions to `fire()`, for an application that plays klieg as a flourish over its own page
swap and needs to know where inside the effect it is.

**`onPhase`** reports each boundary as the effect crosses it: `{ phase: 'active' }` when the enter
has run its length, `{ phase: 'exit' }` when the hold is over, and `{ phase: 'stage', index }` as
each stage settles. `active` is the one a page swap wants — mid-blend, where the word has landed
and is at full presence. The instants are detected per frame rather than scheduled when you fire,
because releasing a `'click'` hold rebuilds the timeline and moves the exit; a schedule fixed at
fire time would be right for every numeric hold and silently never fire for a click hold. A frame
long enough to span several stages reports every one of them. A listener that throws reaches you as
an unhandled rejection instead of stopping the render loop.

**`signal`** aborts one effect without taking the instance and its GL context down with it. An
effect aborted while it is still queued never renders at all. An abort plays no exit and resolves
the promise rather than rejecting it, which is what the promise already meant for an effect the
queue dropped.

**`dismiss: 'host'`** withholds klieg's window listeners — `pointerdown` and Escape both — so a host
that routes its own input gets one action per press instead of two. `fire()` now returns a handle:
the same promise, plus `advance()`, which acts as the dismissing press. An `advance()` that arrives
before the effect starts releases the first hold it reaches rather than being lost to the race.

Because `clickAnywhere` exists to gate a window listener, and `dismiss: 'host'` attaches none, an
anchored placement may hold on a click under host dismissal without the opt-in.

`fire()`'s return type widens from `Promise<void>` to a `FireHandle` that extends it, so existing
callers — `await`, `.then`, `.catch` — are untouched.
```

- [ ] **Step 5: Extend the documented-surface test**

`readme.test.ts` guards names the README tells people to import. Add `FireHandle` and `PhaseEvent`
coverage — they are types, so `toHaveProperty` cannot see them. Instead add a compile-time case to
`packages/core/test/readme.test.ts`:

```ts
  it('hands back a handle that is still the promise callers already use', async () => {
    const handle: bk.FireHandle = Object.assign(Promise.resolve(), { advance: () => {} });

    expect(typeof handle.then).toBe('function');
    expect(typeof handle.catch).toBe('function');
    expect(typeof handle.advance).toBe('function');
    await handle;
  });
```

This is the check that keeps `FireHandle` from being narrowed back to a bare thenable, which would
break `dev/composition-lab/src/Preview.tsx`'s `.catch()`.

- [ ] **Step 6: Run everything**

```bash
npm run check
```

Expected: lint, typecheck and the full suite all pass.

- [ ] **Step 7: Commit**

```bash
git add README.md CHANGELOG.md packages/core/test/readme.test.ts
git commit -m "document the host-driven effect surface"
```

---

## Task 11: Run the spike the design was written against

`spikes/double-dispatch.mjs` reproduces the one-press-two-actions problem `dismiss: 'host'` removes.
It has never been run — it was written during an investigation aimed at a different app's dev
server. A spike that has never run is a claim, not evidence.

**Files:**
- Modify: `spikes/double-dispatch.mjs` (only if it is aimed at the wrong target)

- [ ] **Step 1: Read it and find what it points at**

```bash
cat spikes/double-dispatch.mjs
```

- [ ] **Step 2: Run it**

```bash
node spikes/double-dispatch.mjs
```

- [ ] **Step 3: Decide, and say which**

If it runs and shows the double dispatch: note the output in the commit message; the design's
premise is confirmed. If it is aimed at another app's dev server: either repoint it at
`apps/lab` (`npm run dev -w apps/lab`) or delete it and say so — an unrunnable spike in the tree
is worse than none, because it reads as evidence.

- [ ] **Step 4: Commit whichever you did**

```bash
git add spikes/double-dispatch.mjs
git commit -m "run the double-dispatch spike against the lab"
```

---

## Task 12: Re-check the design's claims about sherpa

The spec's account of sherpa is pinned to `v1-runtime` / `9addc1e`, read while sherpa's working
tree was dirty and its IPC surface was under revision. Two claims rest on that snapshot.

- [ ] **Step 1: Check whether `PageInstance.goto(index)` still takes an absolute step index**

If sherpa has moved to a relative step, `advance()` is the same shape as `goto` and the naming
argument in the spec's "Where this departs" section is stale. That changes nothing in this plan's
code — `Sequence` only moves forward either way — but it changes what the README should say.

- [ ] **Step 2: Check whether sherpa's documented v1 limit still reads "nothing klieg shows is
      dismissible"**

That sentence is what `dismiss: 'host'` unblocks. If it is gone, so is the justification, and the
CHANGELOG entry should not claim it.

- [ ] **Step 3: Follow through on the undertaking**

Naming this `advance()` rather than `goto()` came with an undertaking to add `advance` to sherpa
too. Open that as an issue on sherpa, or do it, but do not let it lapse silently.

- [ ] **Step 4: Fix whatever drifted, or record that nothing did**

Amend the spec's "Where this departs from the obvious models" section with the commit you checked
against, and commit.

---

## Task 13: Finish the branch

- [ ] **Step 1: Full check from clean**

```bash
npm run check
```

Expected: green, at the Task 0 baseline plus roughly 20 new tests.

- [ ] **Step 2: Confirm no public surface leaked**

```bash
grep -n "PhaseReporter\|isolate" packages/core/src/index.ts
```

Expected: only the `import` line. `PhaseReporter` and `isolate` are implementation; only
`PhaseEvent`, `PhaseListener`, `FireHandle` and the three `FireOptions` fields are public.

- [ ] **Step 3: Read the diff as a reviewer would**

```bash
git diff main...host-driven-effects -- packages/core/src
```

- [ ] **Step 4: Hand off**

Use `superpowers:finishing-a-development-branch`. The branch is unpushed; there is no remote branch
yet. `0.9.0` is already on npm, so this is a minor version, not a patch — releases are tag-triggered,
so do not `npm publish` by hand.

---

## Self-review

**Spec coverage.** Every section of the design maps to a task: the surface (6, 7, 8, 9), the phase
instants and both traps (2, 3, 4, 7), the queue-state table (5, 6, 8), `dismiss: 'host'` and
`clickAnywhere` (9), the WAAPI departures and the sherpa alignment (10, 12), the three named tests
(3 Step 5, 4 Step 5, 7 Step 8, 9 Step 7 — each with its mutation check). "Not in scope" stays out:
no backward seeking, no `playState`, no pausing, no enter event.

**Types.** `PhaseEvent`, `PhaseListener`, `PhaseReporter.observe(elapsed, enterEnd, exitAt)`,
`PhaseReporter.stage(index)`, `Timeline.enterEnd`, `Timeline.activeEnd`, `Sequence.exitAt`,
`SequenceOptions.onStage`, `EffectQueue.push(id, run, signal?)`, `FireControl`, `FireHandle.advance`
are each defined once and used under the same name everywhere after.

**Every assertion is derived.** Task 3's `exitAt` value of 600 is worked out in the step from
`stage()`'s own defaults rather than read off a run, so a failure there means the implementation is
wrong, not that the expectation needs updating.
