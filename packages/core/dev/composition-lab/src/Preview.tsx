import { createKlieg, ManualClock } from '@core/index.js';
import { useEffect, useRef } from 'react';
import { type Composition, toFireOptions } from './composition.js';
import { fontUrl } from './font.js';

export interface PreviewProps {
  composition: Composition;
  /** Milliseconds into the fire. Never decreases within one mount; a backward seek remounts. */
  elapsed: number;
}

/**
 * A real fire on a clock the lab owns. Seeking backward remounts and jumps straight to the target
 * in one advance, which `spikes/seek-rebuild/` measures as byte-identical to playing there at
 * 60fps. Seeking forward just advances, because the rebuild is the expensive half.
 *
 * An element placement is its own parent, so it takes `el` and refuses `target`.
 */
export function Preview({ composition, elapsed }: PreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const rig = useRef<{ clock: ManualClock; at: number } | null>(null);

  useEffect(() => {
    const target = host.current;
    if (!target) return;

    const clock = new ManualClock();
    const instance = createKlieg({ clock, fontUrl, placement: { kind: 'element', el: target } });
    rig.current = { clock, at: 0 };
    void instance.fire(composition.text, toFireOptions(composition)).catch(() => {});

    return () => {
      rig.current = null;
      instance.destroy();
    };
  }, [composition]);

  useEffect(() => {
    const r = rig.current;
    if (!r || elapsed < r.at) return;
    r.clock.advance(elapsed - r.at);
    r.at = elapsed;
  }, [elapsed]);

  return <div className="cl-preview-host" ref={host} />;
}
