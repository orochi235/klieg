import type { PartInfo } from '@core/effects/types.js';
import { useEffect, useRef } from 'react';
import type { Channel } from './Plot.js';
import type { PassSamples } from './sample.js';

export interface SwatchProps {
  samples: PassSamples;
  parts: readonly PartInfo[];
  channel: Channel;
  /** 0..1 within the pass. */
  at: number;
}

/** Multiplicative channels rest at 1, so their interesting direction is downward. */
const RESTS_AT_ONE = new Set<Channel>(['gain', 'scale']);

/**
 * One cell per part at its ink centre in em space, tinted by the channel at the playhead. Parts
 * overlap: every run of a letter reports that letter's ink box, so a tube look draws many cells on
 * one letter and the brightest wins.
 */
export function Swatch({ samples, parts, channel, at }: SwatchProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 600;
    const h = 150;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);
    if (parts.length === 0) return;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of parts) {
      minX = Math.min(minX, p.ink.minX);
      maxX = Math.max(maxX, p.ink.maxX);
      minY = Math.min(minY, p.ink.minY);
      maxY = Math.max(maxY, p.ink.maxY);
    }
    // A single-line sign has real height but a collapsed pool would divide by zero.
    const spanX = Math.max(1e-6, maxX - minX);
    const spanY = Math.max(1e-6, maxY - minY);

    const column = Math.min(samples.samples - 1, Math.max(0, Math.round(at * samples.samples)));
    // Color has no magnitude, so it borrows gain's row -- and must borrow gain's rest-at-1 too, or
    // an untouched part (gain 1) reads as maximally lit instead of as no effect.
    const source = channel === 'color' ? 'gain' : channel;
    const rest = RESTS_AT_ONE.has(source) ? 1 : 0;

    // Deviation is relative to the brightest sample anywhere in the pass, not this column alone --
    // a per-column peak would make the hottest part full brightness in every frame, so scrubbing
    // to a dim moment would still read as blazing.
    let peak = 0;
    for (let i = 0; i < parts.length; i++) {
      const row = samples[source][i];
      if (!row) continue;
      for (let j = 0; j < samples.samples; j++) {
        peak = Math.max(peak, Math.abs((row[j] as number) - rest));
      }
    }

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i] as PartInfo;
      const row = samples[source][i];
      if (!row) continue;
      const value = row[column] as number;
      const amount = peak < 1e-6 ? 0 : Math.min(1, Math.abs(value - rest) / peak);
      const cx = (((p.ink.minX + p.ink.maxX) / 2 - minX) / spanX) * (w - 20) + 10;
      const cy = h - 10 - (((p.ink.minY + p.ink.maxY) / 2 - minY) / spanY) * (h - 20);
      g.fillStyle =
        amount < 0.002
          ? 'rgba(126,136,150,0.25)'
          : `rgba(255,${Math.round(179 - amount * 110)},${Math.round(71 - amount * 40)},${0.25 + amount * 0.75})`;
      g.beginPath();
      g.arc(cx, cy, p.kind === 'body' ? 7 : 4, 0, Math.PI * 2);
      g.fill();
    }
  }, [samples, parts, channel, at]);

  return (
    <div className="cl-panel">
      <h2>
        swatch <span className="cl-note">{channel} at the playhead, in em</span>
      </h2>
      <canvas ref={ref} />
    </div>
  );
}
