import { TrialTransport, useTrialClock, useTrialOrbit } from '@weasel-js/labkit';
import { Select } from '@weasel-js/ui';
import { useEffect, useMemo } from 'react';
import { TAIL_MS } from './config.js';
import { useFocus, useLab, useRunTime, useSampled } from './hooks.js';
import { orbitTransform } from './orbit.js';
import { CHANNELS, type Channel } from './Plot.js';
import { Preview } from './Preview.js';
import { poolCounts } from './pool.js';
import { Raster } from './Raster.js';
import { Timeline } from './TimelinePanel.js';

/** The trial: the running sign, then the two panels that share the transport's time axis. */
export function Body() {
  const { composition, config, setConfig } = useLab();
  const clock = useTrialClock();
  const t = useRunTime();
  const sampled = useSampled();
  const focus = useFocus();
  const span = composition.hold + TAIL_MS;
  const camera = useTrialOrbit()?.camera;
  const transform = useMemo(() => (camera ? orbitTransform(camera) : undefined), [camera]);

  useEffect(() => {
    if (clock && clock.duration !== span) clock.duration = span;
  }, [clock, span]);

  const seek = (to: number) => {
    if (!clock) return;
    clock.rate = 0;
    clock.seek(to);
  };

  const counts = poolCounts(sampled.parts);
  const at = (t % sampled.pass) / sampled.pass;

  return (
    <div className="cl-body">
      <Preview composition={composition} elapsed={t} transform={transform} />
      <TrialTransport />
      <Timeline composition={composition} tailMs={TAIL_MS} elapsed={t} onSeek={seek} />
      <div className="cl-panel">
        <p className="cl-note">
          {composition.pool} pool: run {counts.run}, body {counts.body}, chunk {counts.chunk}
          {focus.fallback ? ' (the font failed to load, so this is the synthetic pool)' : ''}
        </p>
        <Raster samples={sampled.data} rows={focus.rows} at={at} kinds={focus.kinds} />
        <div className="cl-row">
          <Select<Channel>
            label="channel"
            orientation="row"
            width="fit"
            selectedKey={config.channel}
            onSelectionChange={(c) => setConfig('channel', c)}
            options={CHANNELS.map((c) => ({ value: c, label: c }))}
          />
          <Select
            label="part"
            orientation="row"
            width="fit"
            selectedKey={String(focus.row)}
            onSelectionChange={(r) => setConfig('part', Number(r))}
            options={focus.rows.map((index, r) => ({
              value: String(r),
              label: labelOf(sampled.parts[index]),
            }))}
          />
        </div>
      </div>
    </div>
  );
}

export function labelOf(part: { kind: string; index: number } | undefined): string {
  return part ? `${part.kind} ${part.index}` : 'no part';
}
