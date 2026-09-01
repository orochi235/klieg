import type { PathSource } from '@core/render/tube/generators.js';
import { CUT_REPAIR_IDS } from '@core/render/tube/repairs.js';
import { DEFAULT_REJOIN, REJOINS, type Rejoin } from '@core/render/tube/runs.js';
import { TUBE_STAGES, type TubeStageId } from '@core/render/tube/stages.js';
import type { LoadedFont } from '@core/text/font.js';
import {
  as2DView,
  CanvasStackContext,
  defineInstrument,
  type ViewTransform,
} from '@weasel-js/labkit';
import { type RefObject, useContext, useEffect, useRef, useState } from 'react';
import type * as THREE from 'three';
import { Legend } from './LegendPanel.js';
import { INK, layerDrew } from './legend.js';
import { NODE_KEY, STAGE_NODES, TOGGLE_GROUPS } from './pipeline.js';
import { buildScene, type CornerMark, type CornerScene, type GlyphBounds } from './scene.js';
import { isTubeLook, type TubeLook } from './spec.js';

interface Config {
  letter: string;
  look: TubeLook;
  source: string;
  corner: number;
  rejoin: string;
  drawAt: string;
  subject: string;
  /** One key per stage and, from Task 13, per repair — `stage:<id>` and `repair:<id>`. */
  [stageOrRepair: string]: unknown;
}

function requestOf(config: Config) {
  return {
    letter: config.letter.slice(0, 1) || 'B',
    look: isTubeLook(config.look) ? config.look : 'piping',
    source: config.source as PathSource,
    corner: Math.max(0, Math.round(config.corner) - 1),
    rejoin: (REJOINS.includes(config.rejoin as Rejoin) ? config.rejoin : DEFAULT_REJOIN) as Rejoin,
    stages: new Set(TUBE_STAGES.map((s) => s.id).filter((id) => config[`stage:${id}`] !== false)),
    drawAt: (TUBE_STAGES.some((t) => t.id === config.drawAt)
      ? config.drawAt
      : 'sweep') as TubeStageId,
    repairs: new Set(CUT_REPAIR_IDS.filter((id) => config[`repair:${id}`] !== false)),
    subject: (config.subject === 'letter' ? 'letter' : 'corner') as 'corner' | 'letter',
  };
}

/**
 * One switch per repair id, in registry order. `stretch` is in two groups under two labels but is
 * one `CutRepairId`, and `repairs` is a set of ids — two switches would be wired to one wire.
 */
function repairSwitches() {
  const seen = new Set<string>();
  return TOGGLE_GROUPS.flatMap((group) =>
    group.ids
      .filter((id) => !seen.has(id))
      .map((id) => {
        seen.add(id);
        return {
          key: `repair:${id}`,
          label: `${group.label} · ${id}`,
          type: 'checkbox' as const,
          default: true,
        };
      }),
  );
}

/** Set by `main` once the font has loaded; the instrument model is synchronous. */
let font: LoadedFont;

export function provideFont(loaded: LoadedFont): void {
  font = loaded;
}

type Draw = (
  ctx: CanvasRenderingContext2D,
  args: { state: CornerScene; config: Config; zoom: number },
) => void;

/** Declares a canvas layer that tells the legend it painted. */
function layer(id: string, draw: Draw): { id: string; draw: Draw } {
  return {
    id,
    draw: (ctx, args) => {
      layerDrew(id);
      draw(ctx, args);
    },
  };
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

/**
 * A ghost's geometry, however short: a run of vertices strokes, a single one draws as a dot. The
 * radius is the stroke's own width — both are already in the glyph's units, which the camera scales.
 */
function mark(
  ctx: CanvasRenderingContext2D,
  points: THREE.Vector3[],
  centre: THREE.Vector3,
  colour: string,
  width: number,
): void {
  if (points.length === 1) dot(ctx, points[0] as THREE.Vector3, centre, colour, width);
  else stroke(ctx, points, centre, colour, width);
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
 * What the main canvas frames, in glyph space. Layers draw `state.centre` at the world origin with
 * y flipped, and the camera puts world point `p` at `pan + zoom * p`, so inverting the middle of
 * the canvas — screen `(width / 2, height / 2)` — gives the glyph point at the centre of the view.
 */
function framedBy(scene: CornerScene, view: ViewTransform, width: number, height: number) {
  const halfW = width / 2 / view.zoom;
  const halfH = height / 2 / view.zoom;
  const cx = scene.centre.x + halfW - view.pan.x / view.zoom;
  const cy = scene.centre.y - halfH + view.pan.y / view.zoom;
  return { cx, cy, halfW, halfH };
}

/**
 * The box of the overlay this element sits in. That overlay covers the canvas stack, so its size is
 * what the main view frames.
 */
function useHostSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const host = ref.current?.parentElement;
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
  }, [ref]);
  return size;
}

/**
 * Seeds the pan to the middle of the canvas. labkit's `initialView` is fixed at definition time and
 * it offers no size-aware view hook, so a pan of exactly zero — what `initialView` and Reset both
 * leave behind — stands in for "not centred yet".
 */
function CentreView({ view, setView }: { view: unknown; setView: (next: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useHostSize(ref);
  const current = as2DView(view);
  const zoom = current?.zoom ?? null;
  const offCentre = current !== null && (current.pan.x !== 0 || current.pan.y !== 0);
  useEffect(() => {
    if (zoom === null || offCentre || size.width === 0) return;
    setView({ zoom, pan: { x: size.width / 2, y: size.height / 2 } });
  }, [zoom, offCentre, size, setView]);
  return <div ref={ref} hidden />;
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
  const size = useHostSize(boxRef);
  const dpr = window.devicePixelRatio || 1;

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
    rejoin: DEFAULT_REJOIN,
    drawAt: 'sweep',
    ...Object.fromEntries(TUBE_STAGES.map((stage) => [`stage:${stage.id}`, true])),
    ...Object.fromEntries(CUT_REPAIR_IDS.map((id) => [`repair:${id}`, true])),
    subject: 'corner',
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
      key: 'rejoin',
      label: 'rejoin',
      type: 'select',
      default: DEFAULT_REJOIN,
      options: REJOINS.map((r) => ({ value: r, label: r })),
    },
    ...TUBE_STAGES.map((stage) => ({
      key: `stage:${stage.id}`,
      label: `run · ${stage.label}`,
      type: 'checkbox' as const,
      default: true,
    })),
    {
      key: 'drawAt',
      label: 'draw at',
      type: 'select',
      default: 'sweep',
      options: TUBE_STAGES.map((s) => ({ value: s.id, label: s.label })),
    },
    ...repairSwitches(),
    {
      key: 'subject',
      label: 'subject',
      type: 'select',
      default: 'corner',
      options: [
        { value: 'corner', label: 'one corner' },
        { value: 'letter', label: 'whole letter' },
      ],
    },
  ],

  initialState: (config) => buildScene(font, requestOf(config)),
  onConfigChange: (config) => buildScene(font, requestOf(config)),

  canvas: {
    initialView: { zoom: 1600, pan: { x: 0, y: 0 } },
    layers: [
      layer('glyph', (ctx, { state, zoom }) => {
        // Every front path, counters included — `contour` draws only the path the selected
        // corner sits on, so without this the rest of the letter is invisible while tuning.
        for (const path of state.outline) {
          stroke(ctx, path.points, state.centre, INK.glyph, 1 / zoom);
        }
      }),
      layer('floor', (ctx, { state, zoom }) => {
        ctx.beginPath();
        ctx.arc(0, 0, state.rhoMin, 0, Math.PI * 2);
        ctx.strokeStyle = INK.floor;
        ctx.lineWidth = 1 / zoom;
        ctx.setLineDash([4 / zoom, 5 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }),
      layer('contour', (ctx, { state, zoom }) => {
        stroke(ctx, state.contour, state.centre, INK.contour, 1.2 / zoom);
        stroke(ctx, state.replaced, state.centre, INK.replaced, 8 / zoom);
      }),
      layer('staged', (ctx, { state, zoom }) => {
        for (const span of state.staged) {
          stroke(ctx, span, state.centre, INK.staged, 1.6 / zoom);
        }
      }),
      layer('built', (ctx, { state, zoom }) => {
        for (const run of state.carried) {
          const ink = run.side === 'after' ? INK.builtAfter : INK.built;
          stroke(ctx, run.points, state.centre, ink, 2.6 / zoom);
          run.points.forEach((p, i) => {
            if (run.authored[i]) dot(ctx, p, state.centre, INK.authored, 2.2 / zoom);
          });
        }
      }),
      layer('ghost', (ctx, { state, zoom }) => {
        for (const ghost of state.ghosts) {
          if (ghost.ran) continue;
          // A one-vertex site is most of them — `stretch` drops a single vertex per corner —
          // and a one-point polyline strokes nothing, so the readout would name a ghost the
          // canvas never drew.
          mark(ctx, ghost.removed, state.centre, INK.removed, 7 / zoom);
          ctx.setLineDash([4 / zoom, 4 / zoom]);
          mark(ctx, ghost.added, state.centre, INK.added, 2.4 / zoom);
          ctx.setLineDash([]);
        }
      }),
      layer('repair', (ctx, { state, zoom }) => {
        for (const site of state.ghosts) {
          if (!site.ran) continue;
          // Same dash grammar the ghost layer uses — solid removed, dashed added — in the one
          // ink, so a site reads as what a repair did rather than what one would do.
          mark(ctx, site.removed, state.centre, INK.drawn, 7 / zoom);
          ctx.setLineDash([4 / zoom, 4 / zoom]);
          mark(ctx, site.added, state.centre, INK.drawn, 2.4 / zoom);
          ctx.setLineDash([]);
        }
      }),
    ],
  },

  layers: { ids: ['glyph', 'floor', 'contour', 'staged', 'built', 'ghost', 'repair'] },

  render: ({ state, config, setConfig, setState, trial }) => (
    <>
      <CentreView view={trial.view} setView={trial.setView} />
      <div className="junction">
        <ol className="junction__pipeline">
          {STAGE_NODES.map((node) => {
            const off = state.skipped.includes(node.id);
            const shown = node.id === requestOf(config).drawAt;
            return (
              <li
                key={NODE_KEY(node)}
                className={`stagechip${off ? ' stagechip--off' : ''}${shown ? ' stagechip--shown' : ''}`}
                title={off ? `${node.label} — switched off` : node.label}
              >
                <span className="stagechip__name">{node.label}</span>
              </li>
            );
          })}
        </ol>
        <dl className="junction__measures">
          {/* Keyed by position: `subject: 'letter'` carries one `run ships at` per run at the same
              value, so neither the label nor the pair is unique. The list is rebuilt whole on every
              config change and holds no state, so there is nothing for a stable key to preserve. */}
          {state.measures.map((m, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the only identity a measure has
            <div className={m.bad ? 'measure measure--bad' : 'measure'} key={`${m.label}:${i}`}>
              <dt>{m.label}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
          {state.ghosts
            .filter((g) => !g.ran)
            .map((g, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: many sites share an id and a side
              <div className="measure" key={`${g.id}:${g.side ?? '-'}:${i}`}>
                <dt>{g.side ? `${g.id} · ${g.side}` : g.id}</dt>
                <dd>{`off — ${g.added.length} added, ${g.removed.length} removed`}</dd>
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
      <Legend scene={state} />
    </>
  ),
});
