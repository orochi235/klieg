import { clamp01 } from '../easing.js';
import type { Signal } from './signal.js';
import { falloff, inkCenter } from './source.js';
import type { PartInfo } from './types.js';

export interface KicksSpec {
  /** How far a kick reaches, in em of layout space. Default 0.4. */
  radius?: number;
  /** Milliseconds a part takes to drain from 1 back to 0. Default 500; 0 lasts one frame. */
  recoverMs?: number;
}

/** A signal your code pokes: each `kick` lifts the parts near a point, which then recover. */
export interface Kicks extends Signal {
  /** `at` is in the word's layout space — `pointOn(...).inWord`. `energy` is 0..1, default 1. */
  kick(at: { x: number; y: number }, energy?: number): void;
}

/** Kicks held for parts not yet asked about. Past this the oldest are dropped. */
const KEPT = 64;

/**
 * Events your code reports — a spark landing, a knock — as a signal: a kick lifts every part
 * within `radius` of its point to `energy` on `near`'s falloff, and the lift drains away at
 * `recoverMs` per unit. Overlapping kicks keep whichever reads higher rather than adding up.
 *
 * Kicks land on the next frame a part is asked about, and state advances once per `FrameCtx.now`
 * as `dwell`'s does. A part first asked about after a kick never sees it. Under reduced motion a
 * lift lasts the one frame it lands in.
 */
export function kicks(spec: KicksSpec = {}): Kicks {
  const radius = spec.radius ?? 0.4;
  const recoverMs = spec.recoverMs ?? 500;
  const queue: { seq: number; x: number; y: number; energy: number }[] = [];
  let latest = 0;
  const held = new WeakMap<PartInfo, { now: number; k: number; seq: number }>();

  const signal = ((_t, part, ctx) => {
    const last = held.get(part);
    if (!last) {
      held.set(part, { now: ctx.now, k: 0, seq: latest });
      return 0;
    }
    if (last.now === ctx.now) return last.k;

    const ms = Math.max(0, ctx.now - last.now);
    last.k = Number.isFinite(ctx.dt) && recoverMs > 0 ? Math.max(0, last.k - ms / recoverMs) : 0;
    if (last.seq < latest) {
      const c = inkCenter(part.ink);
      for (const kick of queue) {
        if (kick.seq <= last.seq) continue;
        const k = kick.energy * falloff(Math.hypot(c.x - kick.x, c.y - kick.y), radius);
        if (k > last.k) last.k = k;
      }
      last.seq = latest;
    }
    last.now = ctx.now;
    return last.k;
  }) as Kicks;

  signal.kick = (at, energy = 1) => {
    const e = Number.isFinite(energy) ? clamp01(energy) : 0;
    if (e <= 0 || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
    queue.push({ seq: ++latest, x: at.x, y: at.y, energy: e });
    if (queue.length > KEPT) queue.shift();
  };
  return signal;
}
