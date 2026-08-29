import { useEffect, useRef } from 'react';
import type { PassSamples } from './sample.js';

export type Channel = 'gain' | 'scale' | 'dark' | 'crawl';

export const CHANNELS: Channel[] = ['gain', 'scale', 'dark', 'crawl'];

export interface PlotProps {
  samples: PassSamples;
  channel: Channel;
  /** Which part's row to draw, as an index into `samples`. */
  part: number;
  /** How to name that part to a reader. A pool index is not what the rail calls it. */
  label: string;
  at: number;
}

export function Plot({ samples, channel, part, label, at }: PlotProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const row = samples[channel][part];

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !row) return;
    const w = canvas.clientWidth || 600;
    const h = 110;
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);

    let lo = Math.min(...row);
    let hi = Math.max(...row);
    // A flat channel would divide by zero and draw nothing; show it as a line at its own value.
    if (hi - lo < 1e-9) {
      lo -= 0.5;
      hi += 0.5;
    }

    g.strokeStyle = '#ffb347';
    g.beginPath();
    for (let s = 0; s < row.length; s++) {
      const y = h - 3 - (((row[s] as number) - lo) / (hi - lo)) * (h - 6);
      const x = (s / (row.length - 1)) * w;
      if (s === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    g.strokeStyle = '#5aa9e6';
    g.beginPath();
    g.moveTo(at * w, 0);
    g.lineTo(at * w, h);
    g.stroke();
  }, [row, at]);

  const range = row ? `${Math.min(...row).toFixed(3)} … ${Math.max(...row).toFixed(3)}` : 'no data';
  return (
    <div className="cl-panel">
      <h2>
        {channel} — {label} <span className="cl-note">{range}</span>
      </h2>
      <canvas ref={ref} />
    </div>
  );
}
