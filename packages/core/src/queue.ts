export const POLICY_NAMES = ['queue', 'replace', 'concurrent'] as const;
export type QueuePolicy = (typeof POLICY_NAMES)[number];
export type EffectRunner = (signal: AbortSignal) => Promise<void>;

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

interface Slot {
  id: string;
  controller: AbortController;
  settled: Promise<void>;
}

/**
 * Under `replace` the newest push wins outright: it aborts the running effect and drops any
 * effect still waiting, since a `replace` that keeps a backlog is `queue` with an extra abort.
 *
 * Dropping a queued effect resolves rather than rejects — it is done, not failed. A running
 * effect settles however its runner settles, so an abort can still surface as a rejection.
 */
export class EffectQueue {
  private pending: Entry[] = [];
  private live = new Set<Slot>();
  private draining = false;

  constructor(private readonly policy: QueuePolicy = 'queue') {}

  /** The most recently started effect that has not finished; only `concurrent` has more than one. */
  get current(): string | null {
    let latest: string | null = null;
    for (const slot of this.live) latest = slot.id;
    return latest;
  }

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

  /** Resolves once every aborted effect has finished tearing down, so callers can free what they share. */
  async cancelAll(): Promise<void> {
    this.abortLive();
    this.dropPending();
    await Promise.allSettled([...this.live].map((slot) => slot.settled));
  }

  private abortLive(): void {
    for (const slot of this.live) slot.controller.abort();
  }

  private dropPending(): void {
    const dropped = this.pending;
    this.pending = [];
    for (const entry of dropped) {
      entry.unwatch();
      entry.resolve();
    }
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (let entry = this.pending.shift(); entry; entry = this.pending.shift()) {
        await this.start(entry);
      }
    } finally {
      this.draining = false;
    }
  }

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
}
