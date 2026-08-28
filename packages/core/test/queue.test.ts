import { describe, expect, it, vi } from 'vitest';
import { EffectQueue } from '../src/queue.js';

/** Resolves when aborted, so a test never waits on a timer for teardown it does not care about. */
const abortable = (signal: AbortSignal) =>
  new Promise<void>((r) => {
    signal.addEventListener('abort', () => r());
  });

describe('EffectQueue', () => {
  it('runs one effect at a time and reports what is current', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    const a = q.push('a', async () => {
      order.push('a');
    });
    const b = q.push('b', async () => {
      order.push('b');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
    expect(q.current).toBeNull();
  });

  it('replace policy cancels the running effect', async () => {
    const q = new EffectQueue('replace');
    const cancelled = vi.fn();
    const a = q.push('a', (signal) => {
      signal.addEventListener('abort', cancelled);
      return abortable(signal);
    });
    const b = q.push('b', async () => {});
    await Promise.all([a, b]);
    expect(cancelled).toHaveBeenCalled();
  });

  it('concurrent policy runs effects simultaneously', async () => {
    const q = new EffectQueue('concurrent');
    let peak = 0;
    let live = 0;
    const run = async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 10));
      live--;
    };
    await Promise.all([q.push('a', run), q.push('b', run)]);
    expect(peak).toBe(2);
  });

  it('a rejecting effect does not stall the effects queued behind it', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    const bad = q.push('bad', async () => {
      throw new Error('boom');
    });
    const good = q.push('good', async () => {
      order.push('good');
    });
    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBeUndefined();
    expect(order).toEqual(['good']);
  });

  it('stays serial when a completion handler pushes two more effects', async () => {
    const q = new EffectQueue('queue');
    const order: string[] = [];
    let live = 0;
    let peak = 0;
    const run = (id: string) => async () => {
      live++;
      peak = Math.max(peak, live);
      order.push(id);
      await new Promise((r) => setTimeout(r, 5));
      live--;
    };

    const tail: Promise<void>[] = [];
    await q.push('a', run('a')).then(() => {
      tail.push(q.push('b', run('b')), q.push('c', run('c')));
    });
    await Promise.all(tail);

    expect(peak).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(q.current).toBeNull();
  });

  it('cancelAll resolves queued effects instead of leaving them unsettled', async () => {
    const q = new EffectQueue('queue');
    const aborted = vi.fn();
    const queuedRan = vi.fn();
    const a = q.push('a', (signal) => {
      signal.addEventListener('abort', aborted);
      return abortable(signal);
    });
    const b = q.push('b', async () => {
      queuedRan();
    });
    expect(q.current).toBe('a');

    await q.cancelAll();

    await expect(b).resolves.toBeUndefined();
    await a;
    expect(aborted).toHaveBeenCalled();
    expect(queuedRan).not.toHaveBeenCalled();
    expect(q.current).toBeNull();
  });

  it('cancelAll waits for the aborted effect to finish tearing down', async () => {
    const q = new EffectQueue('queue');
    const torn: string[] = [];
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((r) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              torn.push('a');
              r();
            }, 10);
          });
        }),
    );

    await q.cancelAll();

    expect(torn).toEqual(['a']);
    expect(q.current).toBeNull();
    await expect(a).resolves.toBeUndefined();
  });

  it('cancelAll resolves even when an aborted effect rejects while tearing down', async () => {
    const q = new EffectQueue('queue');
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('teardown failed')));
        }),
    );
    const rejected = expect(a).rejects.toThrow('teardown failed');

    await expect(q.cancelAll()).resolves.toBeUndefined();

    await rejected;
    expect(q.current).toBeNull();
  });

  it('cancelAll clears a replace queue too', async () => {
    const q = new EffectQueue('replace');
    const supersededRan = vi.fn();
    const a = q.push('a', abortable);
    const b = q.push('b', async () => {
      supersededRan();
    });

    await q.cancelAll();

    await Promise.all([a, b]);
    expect(supersededRan).not.toHaveBeenCalled();
    expect(q.current).toBeNull();
  });

  it('cancelAll is not terminal — a later push still runs', async () => {
    const q = new EffectQueue('queue');
    const a = q.push('a', abortable);
    await q.cancelAll();
    await a;

    const ran = vi.fn();
    await q.push('b', async () => {
      ran();
    });
    expect(ran).toHaveBeenCalled();
  });

  it('cancelAll aborts in-flight concurrent effects', async () => {
    const q = new EffectQueue('concurrent');
    const aborted = vi.fn();
    const run = (signal: AbortSignal) => {
      signal.addEventListener('abort', aborted);
      return abortable(signal);
    };
    const both = Promise.all([q.push('a', run), q.push('b', run)]);

    await q.cancelAll();

    await both;
    expect(aborted).toHaveBeenCalledTimes(2);
    expect(q.current).toBeNull();
  });

  it('current names the most recently started effect still running', async () => {
    const q = new EffectQueue('concurrent');
    const release: Array<() => void> = [];
    const run = () => new Promise<void>((r) => release.push(r));

    expect(q.current).toBeNull();
    const a = q.push('a', run);
    expect(q.current).toBe('a');
    const b = q.push('b', run);
    expect(q.current).toBe('b');
    expect(release).toHaveLength(2);

    release[1]?.();
    await b;
    expect(q.current).toBe('a');
    release[0]?.();
    await a;
    expect(q.current).toBeNull();
  });

  it('replace starts the new effect only after the aborted one has torn down', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((r) => {
          signal.addEventListener('abort', () => {
            setTimeout(() => {
              order.push('a:torn-down');
              r();
            }, 10);
          });
        }),
    );
    const b = q.push('b', async () => {
      order.push('b:started');
    });

    await Promise.all([a, b]);
    expect(order).toEqual(['a:torn-down', 'b:started']);
  });

  it('replace starts the new effect even when the aborted one rejects', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push(
      'a',
      (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => {
            order.push('a:failed');
            reject(new Error('teardown failed'));
          });
        }),
    );
    const b = q.push('b', async () => {
      order.push('b:started');
    });

    await expect(a).rejects.toThrow('teardown failed');
    await b;
    expect(order).toEqual(['a:failed', 'b:started']);
  });

  it('replace supersedes an effect that has not started yet', async () => {
    const q = new EffectQueue('replace');
    const order: string[] = [];
    const a = q.push('a', (signal) => {
      order.push('a:started');
      return new Promise<void>((r) => {
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            order.push('a:torn-down');
            r();
          }, 10);
        });
      });
    });
    const b = q.push('b', async () => {
      order.push('b:started');
    });
    const c = q.push('c', async () => {
      order.push('c:started');
    });

    await expect(b).resolves.toBeUndefined();
    await Promise.all([a, c]);

    expect(order).toEqual(['a:started', 'a:torn-down', 'c:started']);
    expect(q.current).toBeNull();
  });

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
    // Boxed, not a bare `let`: TypeScript narrows a local assigned only inside a callback to
    // `never`, and reading `.aborted` off it stops compiling.
    const seen: { signal: AbortSignal | null } = { signal: null };

    const done = q.push(
      'a',
      (signal) => {
        seen.signal = signal;
        return abortable(signal);
      },
      ctrl.signal,
    );
    await Promise.resolve();

    ctrl.abort();
    await expect(done).resolves.toBeUndefined();
    expect(seen.signal?.aborted).toBe(true);

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
});
