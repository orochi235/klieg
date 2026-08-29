import { EffectFrame, planEffects } from '@core/effects/frame.js';
import type { FrameCtx } from '@core/effects/types.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Composition, toFireOptions } from './composition.js';
import { CHANNELS, type Channel, Plot } from './Plot.js';
import { Preview } from './Preview.js';
import { restore, save } from './persist.js';
import { poolCounts, syntheticPool } from './pool.js';
import { Rail } from './Rail.js';
import { Raster } from './Raster.js';
import { samplePass } from './sample.js';

/** How far past `hold` the transport runs, so an exit is visible. */
const TAIL_MS = 2000;

/** The lab's own frame context. A pointer panel replaces this when `lamp` arrives. */
const CTX: FrameCtx = { pointer: null, pointerInWord: null, dt: 16.7 };

export function App() {
  const [composition, setComposition] = useState<Composition>(restore);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const [channel, setChannel] = useState<Channel>('gain');
  const [focus, setFocus] = useState(0);
  const last = useRef(performance.now());
  const span = composition.hold + TAIL_MS;

  const parts = useMemo(() => syntheticPool(24, 7), []);

  /** Rows the raster draws: the kinds some enabled layer targets, or the whole pool when none do. */
  const rows = useMemo(() => {
    const kinds = new Set(composition.effects.filter((l) => l.enabled).map((l) => l.target));
    return parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => kinds.size === 0 || kinds.has(part.kind))
      .map(({ index }) => index);
  }, [composition, parts]);

  /** A shorter row list can strand `focus` past its end, so clamp rather than index out. */
  const row = Math.min(focus, Math.max(0, rows.length - 1));
  const focused = parts[rows[row] ?? 0];
  const label = focused ? `${focused.kind} ${focused.index}` : 'no part';

  const sampled = useMemo(() => {
    const specs = toFireOptions(composition).effects ?? [];
    const frame = new EffectFrame(planEffects(specs, parts));
    const pass = Math.max(1, ...specs.map((s) => (s.piece as { duration: number }).duration));
    return { pass, data: samplePass(frame, parts, pass, 600, CTX) };
  }, [composition, parts]);

  useEffect(() => {
    save(composition);
  }, [composition]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setElapsed((e) => {
        const next = e + dt;
        // Wrapping is a backward seek, so it needs the same remount a scrub back does.
        if (next >= span) setEpoch((n) => n + 1);
        return next % span;
      });
      raf = requestAnimationFrame(tick);
    };
    last.current = performance.now();
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, span]);

  /** A backward seek needs a rebuilt fire, so it bumps the epoch the preview is keyed on. */
  const seek = (to: number) => {
    setPlaying(false);
    if (to < elapsed) setEpoch((n) => n + 1);
    setElapsed(to);
  };

  return (
    <div className="cl-shell">
      <aside className="cl-rail">
        <Rail composition={composition} onChange={setComposition} counts={poolCounts(parts)} />
      </aside>
      <main className="cl-main">
        <section className="cl-preview">
          <Preview key={epoch} composition={composition} elapsed={elapsed} />
        </section>
        <section className="cl-transport">
          <button type="button" onClick={() => setPlaying((p) => !p)}>
            {playing ? 'pause' : 'play'}
          </button>
          <input
            type="range"
            min={0}
            max={span}
            step={10}
            value={elapsed}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="cl-tag">
            {(elapsed / 1000).toFixed(2)}s / {(span / 1000).toFixed(1)}s
          </span>
        </section>
        <section className="cl-panels">
          <Raster samples={sampled.data} rows={rows} at={(elapsed % sampled.pass) / sampled.pass} />
          <div className="cl-row">
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={Math.max(0, rows.length - 1)}
              step={1}
              value={row}
              onChange={(e) => setFocus(Number(e.target.value))}
            />
            <output>{label}</output>
          </div>
          <Plot
            samples={sampled.data}
            channel={channel}
            part={rows[row] ?? 0}
            label={label}
            at={(elapsed % sampled.pass) / sampled.pass}
          />
        </section>
      </main>
    </div>
  );
}
