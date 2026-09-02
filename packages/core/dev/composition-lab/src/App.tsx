import { EffectFrame, planEffects } from '@core/effects/frame.js';
import type { FrameCtx, PartInfo } from '@core/effects/types.js';
import { type LoadedFont, loadFont } from '@core/text/font.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Composition, toFireOptions } from './composition.js';
import { fontUrl } from './font.js';
import { CHANNELS, type Channel, Plot } from './Plot.js';
import { Preview } from './Preview.js';
import { restore, save } from './persist.js';
import { poolCounts, realPool, syntheticPool } from './pool.js';
import { Rail, type RealPoolStatus } from './Rail.js';
import { Raster } from './Raster.js';
import { Swatch } from './Swatch.js';
import { Sweep } from './SweepPanel.js';
import { PASS_SAMPLES, samplePass } from './sample.js';

import { Tenure } from './TenurePanel.js';

/** How far past `hold` the transport runs, so an exit is visible. */
const TAIL_MS = 2000;

/** The lab's own frame context. There is no pointer surface: `pointerFrame` needs a `PlacedWord`
 * only the running fire has, and both lamp sources on offer ignore the cursor. */
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

  const [font, setFont] = useState<LoadedFont | null>(null);
  const [fontError, setFontError] = useState(false);

  useEffect(() => {
    let live = true;
    void loadFont(fontUrl).then(
      (f) => {
        if (live) setFont(f);
      },
      () => {
        if (live) setFontError(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const realPoolStatus: RealPoolStatus = font ? 'ready' : fontError ? 'failed' : 'loading';

  const synthetic = useMemo(() => syntheticPool(24, 7), []);

  /**
   * The real pool needs a font: synthetic stands in while it loads, however long that takes, and
   * permanently if the load fails.
   */
  const parts: PartInfo[] = useMemo(() => {
    if (composition.pool === 'synthetic' || !font) return synthetic;
    return realPool(composition.text, font, composition.look);
  }, [composition.pool, composition.text, composition.look, font, synthetic]);

  /** Kinds some enabled layer targets; empty when none do. */
  const enabledTargets = useMemo(
    () => new Set(composition.effects.filter((l) => l.enabled).map((l) => l.target)),
    [composition.effects],
  );

  /** Rows the raster draws: the kinds some enabled layer targets, or the whole pool when none do. */
  const rows = useMemo(() => {
    return parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => enabledTargets.size === 0 || enabledTargets.has(part.kind))
      .map(({ index }) => index);
  }, [enabledTargets, parts]);

  /** A shorter row list can strand `focus` past its end, so clamp rather than index out. */
  const row = Math.min(focus, Math.max(0, rows.length - 1));
  const focused = parts[rows[row] ?? 0];
  const label = focused ? `${focused.kind} ${focused.index}` : 'no part';

  const sampled = useMemo(() => {
    const specs = toFireOptions(composition).effects ?? [];
    const frame = new EffectFrame(planEffects(specs, parts));
    const pass = Math.max(1, ...specs.map((s) => (s.piece as { duration: number }).duration));
    return { pass, data: samplePass(frame, parts, pass, PASS_SAMPLES, CTX) };
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
        <Rail
          composition={composition}
          onChange={setComposition}
          counts={poolCounts(parts)}
          realPoolStatus={realPoolStatus}
        />
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
        <section className="cl-deck">
          <div className="cl-span2">
            <Raster
              samples={sampled.data}
              rows={rows}
              at={(elapsed % sampled.pass) / sampled.pass}
              kinds={[...enabledTargets]}
            />
          </div>
          <div className="cl-row cl-span2">
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
          <Swatch
            samples={sampled.data}
            parts={parts}
            channel={channel}
            at={(elapsed % sampled.pass) / sampled.pass}
          />
          <Tenure samples={sampled.data} parts={parts} pass={sampled.pass} />
          <Sweep composition={composition} parts={parts} ctx={CTX} />
        </section>
      </main>
    </div>
  );
}
