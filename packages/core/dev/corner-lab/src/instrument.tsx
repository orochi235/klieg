import type { PathSource } from '@core/render/tube/generators.js';
import type { LoadedFont } from '@core/text/font.js';
import { CanvasStackContext, defineInstrument, type ViewTransform } from '@weasel-js/labkit';
import { useContext, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import {
  buildScene,
  type CornerMark,
  type CornerScene,
  type GlyphBounds,
  REPAIRS,
  type Repair,
} from './scene.js';
import { isTubeLook, type TubeLook } from './spec.js';

interface Config {
  letter: string;
  look: TubeLook;
  source: string;
  corner: number;
  repair: string;
}

const INK = {
  contour: '#7d7f86',
  built: '#4d8fe0',
  builtAfter: '#a855f7',
  authored: '#2aa87a',
  drawn: '#e08a20',
  replaced: 'rgba(255, 107, 96, 0.28)',
  floor: '#9a9ca3',
  bad: '#d1453b',
  frame: 'rgba(154, 156, 163, 0.9)',
};

function requestOf(config: Config) {
  return {
    letter: config.letter.slice(0, 1) || 'B',
    look: isTubeLook(config.look) ? config.look : 'piping',
    source: config.source as PathSource,
    corner: Math.max(0, Math.round(config.corner) - 1),
    repair: (REPAIRS.includes(config.repair as Repair) ? config.repair : 'built') as Repair,
  };
}

/** Set by `main` once the font has loaded; the instrument model is synchronous. */
let font: LoadedFont;

export function provideFont(loaded: LoadedFont): void {
  font = loaded;
}

/**
 * Puts world origin at the middle of the view. `initialView.pan` is in screen pixels, which an
 * instrument cannot know when it is written, so centring has to happen where the size is known.
 * The offset is in world units so the camera's own scale is not applied twice.
 */
function centred(ctx: CanvasRenderingContext2D, zoom: number, paint: () => void): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.translate(ctx.canvas.width / dpr / 2 / zoom, ctx.canvas.height / dpr / 2 / zoom);
  paint();
  ctx.restore();
}

function stroke(
  ctx: CanvasRenderingContext2D,
  points: THREE.Vector3[],
  centre: THREE.Vector3,
  colour: string,
  width: number,
): void {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = p.x - centre.x;
    const y = centre.y - p.y;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

function dot(
  ctx: CanvasRenderingContext2D,
  p: THREE.Vector3,
  centre: THREE.Vector3,
  colour: string,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(p.x - centre.x, centre.y - p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

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

/**
 * What the main canvas frames, in glyph space. Its layers draw relative to `state.centre` with the
 * world origin at the middle of the view, so the pan is what the camera has moved off that corner.
 */
function framedBy(scene: CornerScene, view: ViewTransform, width: number, height: number) {
  const halfW = width / 2 / view.zoom;
  const halfH = height / 2 / view.zoom;
  const cx = scene.centre.x - view.pan.x / view.zoom;
  const cy = scene.centre.y + view.pan.y / view.zoom;
  return { cx, cy, halfW, halfH };
}

type Framed = ReturnType<typeof framedBy>;

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

function Minimap({
  scene,
  selected,
  onPick,
}: {
  scene: CornerScene;
  selected: number;
  onPick: (ordinal: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stack = useContext(CanvasStackContext);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const dpr = window.devicePixelRatio || 1;

  // The overlay this sits in covers the canvas stack, so its box is what the main view frames.
  useEffect(() => {
    const host = boxRef.current?.parentElement;
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      setSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const framed =
    stack && size.width > 0 ? framedBy(scene, stack.view, size.width, size.height) : null;

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
    <div className="cornermap" ref={boxRef} onPointerDown={(e) => e.stopPropagation()}>
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

export const junction = defineInstrument<CornerScene, Config>({
  name: 'junction',

  defaultConfig: () => ({
    letter: 'B',
    look: 'piping',
    source: 'direct',
    corner: 1,
    repair: 'built',
  }),

  configSchema: () => [
    { key: 'letter', label: 'letter', type: 'text', default: 'B', maxLength: 1 },
    {
      key: 'look',
      label: 'look',
      type: 'select',
      default: 'piping',
      options: [
        { value: 'piping', label: 'piping' },
        { value: 'tubing', label: 'tubing' },
      ],
    },
    {
      key: 'source',
      label: 'path source',
      type: 'select',
      default: 'direct',
      options: [
        { value: 'direct', label: 'direct' },
        { value: 'exact', label: 'exact' },
        { value: 'field', label: 'field' },
      ],
    },
    { key: 'corner', label: 'corner', type: 'slider', default: 1, min: 1, max: 24, step: 1 },
    {
      key: 'repair',
      label: 'repair',
      type: 'select',
      default: 'built',
      options: REPAIRS.map((r) => ({ value: r, label: r })),
    },
  ],

  initialState: (config) => buildScene(font, requestOf(config)),
  onConfigChange: (config) => buildScene(font, requestOf(config)),

  canvas: {
    initialView: { zoom: 1600, pan: { x: 0, y: 0 } },
    layers: [
      {
        id: 'floor',
        draw: (ctx, { state, zoom }) =>
          centred(ctx, zoom, () => {
            ctx.beginPath();
            ctx.arc(0, 0, state.rhoMin, 0, Math.PI * 2);
            ctx.strokeStyle = INK.floor;
            ctx.lineWidth = 1 / zoom;
            ctx.setLineDash([4 / zoom, 5 / zoom]);
            ctx.stroke();
            ctx.setLineDash([]);
          }),
      },
      {
        id: 'contour',
        draw: (ctx, { state, zoom }) =>
          centred(ctx, zoom, () => {
            stroke(ctx, state.contour, state.centre, INK.contour, 1.2 / zoom);
            stroke(ctx, state.replaced, state.centre, INK.replaced, 8 / zoom);
          }),
      },
      {
        id: 'built',
        draw: (ctx, { state, zoom }) =>
          centred(ctx, zoom, () => {
            for (const run of state.carried) {
              const ink = run.side === 'after' ? INK.builtAfter : INK.built;
              stroke(ctx, run.points, state.centre, ink, 2.6 / zoom);
              run.points.forEach((p, i) => {
                if (run.authored[i]) dot(ctx, p, state.centre, INK.authored, 2.2 / zoom);
              });
            }
          }),
      },
      {
        id: 'repair',
        draw: (ctx, { state, zoom }) =>
          centred(ctx, zoom, () => {
            if (state.drawn) stroke(ctx, state.drawn, state.centre, INK.drawn, 3 / zoom);
          }),
      },
    ],
  },

  layers: { ids: ['floor', 'contour', 'built', 'repair'] },

  render: ({ state, config, setConfig, setState }) => (
    <>
      <div className="junction">
        <dl className="junction__measures">
          {state.measures.map((m) => (
            <div className={m.bad ? 'measure measure--bad' : 'measure'} key={m.label}>
              <dt>{m.label}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
        </dl>
        <ul className="junction__profile">
          {state.profile.map((p) => (
            <li
              key={p.at}
              className={p.rho < state.rhoMin / state.radius ? 'tick tick--under' : 'tick'}
              title={`${p.at} from the corner: ${p.rho.toFixed(2)}r`}
            >
              {Number.isFinite(p.rho) ? p.rho.toFixed(1) : '—'}
            </li>
          ))}
        </ul>
      </div>
      <Minimap
        scene={state}
        selected={Math.min(requestOf(config).corner, Math.max(0, state.cornerCount - 1)) + 1}
        onPick={(ordinal) => {
          // `setConfig` from a render context does not run `onConfigChange`, so the scene the
          // control panel would rebuild has to be built here.
          setConfig('corner', ordinal);
          setState(buildScene(font, requestOf({ ...config, corner: ordinal })));
        }}
      />
    </>
  ),
});
