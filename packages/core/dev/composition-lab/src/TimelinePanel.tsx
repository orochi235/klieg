import { useEffect, useRef } from 'react';
import type { Composition } from './composition.js';
import { type Lane, timelineOf } from './timeline.js';

export interface TimelineProps {
  composition: Composition;
  /** How far past `hold` the transport runs. */
  tailMs: number;
  elapsed: number;
  onSeek: (to: number) => void;
}

const LANE_H = 18;
const GAP = 4;
const LABEL_W = 150;

const INK = {
  track: '#11141a',
  edge: '#262b33',
  pass: 'rgba(90,169,230,0.22)',
  passEdge: '#5aa9e6',
  over: 'rgba(255,179,71,0.16)',
  overEdge: '#ffb347',
  tail: 'rgba(126,136,150,0.13)',
  dim: '#7e8896',
  head: '#ffb347',
};

function drawLane(g: CanvasRenderingContext2D, lane: Lane, y: number, x: number, w: number): void {
  g.fillStyle = INK.track;
  g.fillRect(x, y, w, LANE_H);
  g.strokeStyle = INK.edge;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, LANE_H - 1);

  const fill = lane.overruns ? INK.over : INK.pass;
  const edge = lane.overruns ? INK.overEdge : INK.passEdge;
  // No blocks means they were closer together than they read; the lane says so as one band.
  const blocks = lane.blocks.length > 0 ? lane.blocks : [{ at: 0, width: 1 }];
  for (const block of blocks) {
    g.fillStyle = fill;
    g.fillRect(x + block.at * w, y + 2, block.width * w, LANE_H - 4);
    if (lane.blocks.length === 0) continue;
    g.fillStyle = edge;
    g.fillRect(x + block.at * w, y + 2, 1.5, LANE_H - 4);
  }

  g.fillStyle = INK.dim;
  g.font = '11px ui-monospace, Menlo, monospace';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  g.fillText(lane.label, x - 8, y + LANE_H / 2, LABEL_W - 12);
  g.textAlign = 'left';
}

/**
 * The fire's own clock, a lane per enabled layer. Every panel below this one describes a single
 * pass; this is the one that says how much of that pass the fire is long enough to play.
 */
export function Timeline({ composition, tailMs, elapsed, onSeek }: TimelineProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const line = timelineOf(composition, tailMs);
  const { lanes, spanMs, holdAt } = line;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth || 600;
    const h = Math.max(LANE_H, lanes.length * (LANE_H + GAP));
    canvas.width = w * devicePixelRatio;
    canvas.height = h * devicePixelRatio;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.clearRect(0, 0, w, h);

    const x = LABEL_W;
    const track = Math.max(1, w - LABEL_W);

    for (let i = 0; i < lanes.length; i++) {
      drawLane(g, lanes[i] as Lane, i * (LANE_H + GAP), x, track);
    }

    // The tail the transport runs past `hold`, hatched rather than filled: nothing is scheduled
    // there, it is only where an exit becomes visible.
    g.fillStyle = INK.tail;
    g.fillRect(x + holdAt * track, 0, (1 - holdAt) * track, h);

    g.strokeStyle = INK.dim;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x + holdAt * track, 0);
    g.lineTo(x + holdAt * track, h);
    g.stroke();
    g.setLineDash([]);

    g.strokeStyle = INK.head;
    g.beginPath();
    const head = Math.min(1, elapsed / spanMs);
    g.moveTo(x + head * track, 0);
    g.lineTo(x + head * track, h);
    g.stroke();
  }, [lanes, spanMs, holdAt, elapsed]);

  const seek = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.buttons === 0 && e.type === 'pointermove') return;
    const box = e.currentTarget.getBoundingClientRect();
    const track = Math.max(1, box.width - LABEL_W);
    const at = (e.clientX - box.left - LABEL_W) / track;
    onSeek(Math.max(0, Math.min(1, at)) * spanMs);
  };

  const over = lanes.filter((l) => l.overruns);

  return (
    <div className="cl-panel">
      <h2>timeline</h2>
      {lanes.length === 0 ? (
        <p className="cl-note">no enabled layer builds a piece, so there is nothing to lay out</p>
      ) : (
        <canvas ref={ref} onPointerDown={seek} onPointerMove={seek} />
      )}
      <p className="cl-note">
        0 to {(spanMs / 1000).toFixed(1)}s, hold at {((spanMs * holdAt) / 1000).toFixed(1)}s. A
        block is one pass; a lane says the piece ran, not that a part moved.
      </p>
      {over.map((lane) => (
        <p className="cl-warn" key={lane.id}>
          {lane.label}: one pass is {(lane.passMs / 1000).toFixed(1)}s —{' '}
          {(lane.shareOfPass * 100).toFixed(1)}% of it plays
        </p>
      ))}
    </div>
  );
}
