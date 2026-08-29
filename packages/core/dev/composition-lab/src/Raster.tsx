import { useEffect, useRef } from 'react';
import type { PassSamples } from './sample.js';

export interface RasterProps {
  samples: PassSamples;
  /** Part indices to draw, in order. A kind no layer targets is not evidence of anything. */
  rows: number[];
  /** 0..1 within the pass, drawn as a playhead. */
  at: number;
}

/**
 * Lit is background and a drop is warm. An untouched row is struck through, because "never dark"
 * and "never addressed" look identical otherwise and only one of them is a bug.
 */
export function Raster({ samples, rows, at }: RasterProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 600;
    const h = Math.max(60, rows.length * 7);
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);

    const rh = h / Math.max(1, rows.length);
    const cw = Math.max(1, w / samples.samples);
    for (let r = 0; r < rows.length; r++) {
      const part = rows[r] as number;
      const row = samples.gain[part] as number[];
      for (let s = 0; s < samples.samples; s++) {
        const gain = row[s] as number;
        if (gain > 0.999) continue;
        g.fillStyle = `rgb(255,${Math.round(90 + gain * 90)},${Math.round(40 + gain * 40)})`;
        g.fillRect((s / samples.samples) * w, r * rh, cw, Math.max(1, rh - 1));
      }
      if (!samples.touched[part]) {
        g.fillStyle = 'rgba(120,130,145,0.3)';
        g.fillRect(0, r * rh + rh / 2 - 0.5, w, 1);
      }
    }

    g.strokeStyle = '#5aa9e6';
    g.beginPath();
    g.moveTo(at * w, 0);
    g.lineTo(at * w, h);
    g.stroke();
  }, [samples, rows, at]);

  const untouched = rows.filter((r) => !samples.touched[r]).length;
  return (
    <div className="cl-panel">
      <h2>
        part &times; time
        {untouched > 0 ? (
          <span className="cl-warn">
            {' '}
            — {untouched} of {rows.length} never touched
          </span>
        ) : null}
      </h2>
      <canvas ref={ref} />
    </div>
  );
}
