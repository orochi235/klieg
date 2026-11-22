import { CanvasStackContext, labScreenToWorld } from '@weasel-js/labkit';
import { useContext, useEffect, useRef } from 'react';
import { INK } from './legend.js';
import type { CornerMark, CornerScene, GlyphBounds } from './scene.js';

/** Matched by `.cornermap__canvas` in styles.css. */
const MAP_SIZE = 160;
const MAP_PAD = 12;
const MAP_HIT = 9;

interface MapPoint {
  x: number;
  y: number;
}

/** Fits the glyph into the minimap square, y flipped to screen. */
function mapProject(bounds: GlyphBounds): (x: number, y: number) => MapPoint {
  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const scale = (MAP_SIZE - MAP_PAD * 2) / Math.max(w, h);
  const left = (MAP_SIZE - w * scale) / 2 - bounds.minX * scale;
  const bottom = (MAP_SIZE + h * scale) / 2 + bounds.minY * scale;
  return (x, y) => ({ x: left + x * scale, y: bottom - y * scale });
}

/** What the main canvas frames, in glyph space: the layers draw `scene.center` at world (0,0). */
interface Framed {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

function diamond(ctx: CanvasRenderingContext2D, p: MapPoint, r: number): void {
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - r);
  ctx.lineTo(p.x + r, p.y);
  ctx.lineTo(p.x, p.y + r);
  ctx.lineTo(p.x - r, p.y);
  ctx.closePath();
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  scene: CornerScene,
  selected: number,
  framed: Framed | null,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
  const to = mapProject(scene.bounds);

  ctx.strokeStyle = INK.contour;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  for (const { points, closed } of scene.outline) {
    if (points.length < 2) continue;
    ctx.beginPath();
    points.forEach((p, i) => {
      const at = to(p.x, p.y);
      if (i === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  if (framed) {
    const lo = to(framed.cx - framed.halfW, framed.cy + framed.halfH);
    const hi = to(framed.cx + framed.halfW, framed.cy - framed.halfH);
    ctx.strokeStyle = INK.frame;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(lo.x, lo.y, hi.x - lo.x, hi.y - lo.y);
    ctx.setLineDash([]);
  }

  for (const mark of scene.corners) {
    const at = to(mark.at.x, mark.at.y);
    ctx.fillStyle = mark.split ? INK.builtAfter : INK.built;
    if (mark.split) {
      diamond(ctx, at, 3.6);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(at.x, at.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    if (mark.ordinal === selected) {
      ctx.beginPath();
      ctx.arc(at.x, at.y, 6.5, 0, Math.PI * 2);
      ctx.strokeStyle = INK.drawn;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
  }
}

export function Minimap({
  scene,
  selected,
  onPick,
}: {
  scene: CornerScene;
  selected: number;
  onPick: (ordinal: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stack = useContext(CanvasStackContext);
  const size = stack?.surface?.size;
  const dpr = window.devicePixelRatio || 1;

  let framed: Framed | null = null;
  if (stack && size && size.width > 0) {
    const mid = labScreenToWorld(
      { x: size.width / 2, y: size.height / 2 },
      stack.view,
      stack.frame,
    );
    const halfW = size.width / 2 / stack.view.zoom;
    const halfH = size.height / 2 / stack.view.zoom;
    framed = { cx: scene.center.x + mid.x, cy: scene.center.y + mid.y, halfW, halfH };
  }

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) drawMap(ctx, scene, selected, framed, dpr);
  });

  const pick = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const to = mapProject(scene.bounds);
    let nearest: CornerMark | null = null;
    let best = MAP_HIT;
    for (const mark of scene.corners) {
      const at = to(mark.at.x, mark.at.y);
      const away = Math.hypot(at.x - x, at.y - y);
      if (away <= best) {
        best = away;
        nearest = mark;
      }
    }
    if (nearest) onPick(nearest.ordinal);
  };

  const step = (by: number) => {
    const next = selected + by;
    if (next >= 1 && next <= scene.corners.length) onPick(next);
  };

  return (
    // Stops the pointer reaching the canvas stack under it, which would pan the main view.
    <div className="cornermap" onPointerDown={(e) => e.stopPropagation()}>
      <canvas
        ref={canvasRef}
        className="cornermap__canvas"
        width={Math.round(MAP_SIZE * dpr)}
        height={Math.round(MAP_SIZE * dpr)}
        tabIndex={0}
        aria-label={`glyph minimap: corner ${selected} of ${scene.corners.length}, arrow keys to step`}
        title="every hard corner of the glyph — click one to inspect it"
        onClick={(e) => pick(e.clientX, e.clientY)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(-1);
          else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step(1);
          else return;
          e.preventDefault();
        }}
      />
    </div>
  );
}
