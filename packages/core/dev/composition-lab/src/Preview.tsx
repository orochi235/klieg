import { createKlieg, ManualClock } from '@core/index.js';
import { useEffect, useRef, useState } from 'react';
import { type Composition, toFireOptions } from './composition.js';
import { fontUrl } from './font.js';

export interface PreviewProps {
  composition: Composition;
  /** Milliseconds into the fire. A move back rebuilds the fire and jumps to it. */
  elapsed: number;
}

/**
 * A real fire on a clock the lab owns. Seeking backward rebuilds and jumps straight to the target
 * in one advance, which `spikes/seek-rebuild/` measures as byte-identical to playing there at
 * 60fps. Seeking forward just advances, because the rebuild is the expensive half.
 *
 * An element placement is its own parent, so it takes `el` and refuses `target`.
 */
export function Preview({ composition, elapsed }: PreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<{ clock: ManualClock; at: number; live: boolean } | null>(null);
  const latest = useRef(elapsed);
  latest.current = elapsed;
  // A fire only runs forward, so a move back (a scrub, or a loop starting over) rebuilds it.
  const [epoch, setEpoch] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `epoch` only asks for the rebuild
  useEffect(() => {
    const target = host.current;
    if (!target) return;

    const mine = { clock: new ManualClock(), at: 0, live: false };
    const subscribe = mine.clock.subscribe.bind(mine.clock);
    // A fire draws only on a tick and takes its start time when it subscribes, which is after its
    // font loads. The clock holds at 0 until then, so a paused transport still gets its frame.
    mine.clock.subscribe = (fn) => {
      const off = subscribe(fn);
      queueMicrotask(() => {
        if (rig.current !== mine || mine.live) return;
        mine.live = true;
        mine.clock.advance(latest.current);
        mine.at = latest.current;
      });
      return off;
    };
    const instance = createKlieg({
      clock: mine.clock,
      fonts: { display: fontUrl },
      placement: { kind: 'element', el: target },
      // The box is the whole picture here, not a column in a page with a text edge to meet.
      framing: { width: 0.9, height: 0.7, align: 'center' },
    });
    rig.current = mine;
    void instance.fire(composition.text, toFireOptions(composition)).catch(() => {});

    // A fire fits the word to its box once, when it starts, so a box that changes size (a second
    // trial narrowing this one) gets a new fire rather than a word that overflows or shrinks.
    const fitted = { width: target.clientWidth, height: target.clientHeight };
    let wait = 0;
    const observer = new ResizeObserver(() => {
      if (target.clientWidth === fitted.width && target.clientHeight === fitted.height) return;
      clearTimeout(wait);
      wait = window.setTimeout(() => setEpoch((n) => n + 1), 150);
    });
    observer.observe(target);

    return () => {
      clearTimeout(wait);
      observer.disconnect();
      rig.current = null;
      instance.destroy();
    };
  }, [composition, epoch]);

  useEffect(() => {
    const r = rig.current;
    if (!r?.live) return;
    if (elapsed < r.at) {
      r.live = false;
      setEpoch((n) => n + 1);
      return;
    }
    r.clock.advance(elapsed - r.at);
    r.at = elapsed;
  }, [elapsed]);

  return <div className="cl-preview-host" ref={host} />;
}
