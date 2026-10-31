import type { LoadedFont } from '@core/text/font.js';
import {
  CanvasStackContext,
  defineInstrument,
  Legend,
  Readout,
  type ReadoutRow,
} from '@weasel-js/labkit';
import { type CSSProperties, useContext, useEffect, useRef } from 'react';
import type * as THREE from 'three';
import { type Config, config, requestOf } from './config.js';
import { INK, shownLegend } from './legend.js';
import { Minimap } from './Minimap.js';
import { NODE_KEY, STAGE_NODES } from './pipeline.js';
import { buildScene, type CornerScene, type GlyphBounds } from './scene.js';

/** Set by `main` once the font has loaded; the instrument model is synchronous. */
let font: LoadedFont;

export function provideFont(loaded: LoadedFont): void {
  font = loaded;
}

function stroke(
  ctx: CanvasRenderingContext2D,
  points: THREE.Vector3[],
  center: THREE.Vector3,
  color: string,
  width: number,
): void {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x - center.x, p.y - center.y);
    else ctx.lineTo(p.x - center.x, p.y - center.y);
  });
  ctx.strokeStyle = color;
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
  center: THREE.Vector3,
  color: string,
  width: number,
): void {
  if (points.length === 1) dot(ctx, points[0] as THREE.Vector3, center, color, width);
  else stroke(ctx, points, center, color, width);
}

function dot(
  ctx: CanvasRenderingContext2D,
  p: THREE.Vector3,
  center: THREE.Vector3,
  color: string,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(p.x - center.x, p.y - center.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/** What the view opens on, and what `subject: 'corner'` goes back to. */
const CORNER_ZOOM = 1600;

/** How much of the canvas a fitted whole letter fills. */
const FIT = 0.9;

/**
 * The zoom a subject wants. A corner is a fixed magnification — the floor circle has to read at
 * true scale — while a letter is whatever fits the canvas it is in.
 */
function zoomFor(
  subject: Config['subject'],
  bounds: GlyphBounds,
  size: { width: number; height: number },
): number {
  if (subject !== 'letter') return CORNER_ZOOM;
  const w = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const h = Math.max(bounds.maxY - bounds.minY, 1e-6);
  return FIT * Math.min(size.width / w, size.height / h);
}

/**
 * Re-zooms when the subject changes; the scene puts either subject at the world origin, so only
 * the zoom differs between them.
 */
function SubjectZoom({
  subject,
  bounds,
  setView,
}: {
  subject: Config['subject'];
  bounds: GlyphBounds;
  setView: (next: unknown) => void;
}) {
  const size = useContext(CanvasStackContext)?.surface?.size;
  const shown = useRef(subject);
  useEffect(() => {
    if (shown.current === subject || !size || size.width === 0) return;
    shown.current = subject;
    setView({ zoom: zoomFor(subject, bounds, size), pan: { x: 0, y: 0 } });
  }, [subject, bounds, size, setView]);
  return null;
}

function measureRows(state: CornerScene): ReadoutRow[] {
  // Keyed by position: `subject: 'letter'` carries one `run ships at` per run at the same value.
  const measures = state.measures.map(
    (m, i): ReadoutRow => ({
      key: `measure:${i}`,
      label: m.label,
      value: m.value,
      ...(m.bad ? { grade: 'danger' as const } : {}),
    }),
  );
  const ghosts = state.ghosts
    .filter((g) => !g.ran)
    .map(
      (g, i): ReadoutRow => ({
        key: `ghost:${i}`,
        label: g.side ? `${g.id} · ${g.side}` : g.id,
        value: `off — ${g.added.length} added, ${g.removed.length} removed`,
      }),
    );
  return [...measures, ...ghosts];
}

export const junction = defineInstrument<CornerScene, Config>({
  name: 'junction',
  config,

  initialState: (config) => buildScene(font, requestOf(config)),
  onConfigChange: (config) => buildScene(font, requestOf(config)),

  canvas: {
    worldSpec: { origin: { x: 0.5, y: 0.5 }, yAxis: 'up' },
    initialView: { zoom: CORNER_ZOOM, pan: { x: 0, y: 0 } },
    layers: [
      {
        id: 'glyph',
        draw: (ctx, { state, zoom }) => {
          // Every front path, counters included — `contour` draws only the path the selected
          // corner sits on, so without this the rest of the letter is invisible while tuning.
          for (const path of state.outline) {
            stroke(ctx, path.points, state.center, INK.glyph, 1 / zoom);
          }
        },
      },
      {
        id: 'floor',
        draw: (ctx, { state, zoom }) => {
          ctx.beginPath();
          ctx.arc(0, 0, state.rhoMin, 0, Math.PI * 2);
          ctx.strokeStyle = INK.floor;
          ctx.lineWidth = 1 / zoom;
          ctx.setLineDash([4 / zoom, 5 / zoom]);
          ctx.stroke();
          ctx.setLineDash([]);
        },
      },
      {
        id: 'contour',
        draw: (ctx, { state, zoom }) => {
          stroke(ctx, state.contour, state.center, INK.contour, 1.2 / zoom);
          stroke(ctx, state.replaced, state.center, INK.replaced, 8 / zoom);
        },
      },
      {
        id: 'staged',
        draw: (ctx, { state, zoom }) => {
          for (const span of state.staged) {
            stroke(ctx, span, state.center, INK.staged, 1.6 / zoom);
          }
        },
      },
      {
        id: 'built',
        draw: (ctx, { state, zoom }) => {
          for (const run of state.carried) {
            const ink = run.side === 'after' ? INK.builtAfter : INK.built;
            stroke(ctx, run.points, state.center, ink, 2.6 / zoom);
            run.points.forEach((p, i) => {
              if (run.authored[i]) dot(ctx, p, state.center, INK.authored, 2.2 / zoom);
            });
          }
        },
      },
      {
        id: 'ghost',
        draw: (ctx, { state, zoom }) => {
          for (const ghost of state.ghosts) {
            if (ghost.ran) continue;
            // A one-vertex site is most of them — `stretch` drops a single vertex per corner —
            // and a one-point polyline strokes nothing, so the readout would name a ghost the
            // canvas never drew.
            mark(ctx, ghost.removed, state.center, INK.removed, 7 / zoom);
            ctx.setLineDash([4 / zoom, 4 / zoom]);
            mark(ctx, ghost.added, state.center, INK.added, 2.4 / zoom);
            ctx.setLineDash([]);
          }
        },
      },
      {
        id: 'repair',
        draw: (ctx, { state, zoom }) => {
          for (const site of state.ghosts) {
            if (!site.ran) continue;
            // Same dash grammar the ghost layer uses — solid removed, dashed added — in the one
            // ink, so a site reads as what a repair did rather than what one would do.
            mark(ctx, site.removed, state.center, INK.drawn, 7 / zoom);
            ctx.setLineDash([4 / zoom, 4 / zoom]);
            mark(ctx, site.added, state.center, INK.drawn, 2.4 / zoom);
            ctx.setLineDash([]);
          }
        },
      },
    ],
  },

  layers: { ids: ['glyph', 'floor', 'contour', 'staged', 'built', 'ghost', 'repair'] },

  render: ({ state, config, setConfig, trial }) => {
    const request = requestOf(config);
    const legend = shownLegend(new Set(trial.visibleLayers), state);
    return (
      <>
        <SubjectZoom subject={request.subject} bounds={state.bounds} setView={trial.setView} />
        <div className="junction" style={{ '--ink': INK.staged } as CSSProperties}>
          <ol className="junction__pipeline">
            {STAGE_NODES.map((node) => {
              const off = state.skipped.includes(node.id);
              const shown = node.id === request.drawAt;
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
          <Readout rows={measureRows(state)} />
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
          selected={Math.min(request.corner, Math.max(0, state.cornerCount - 1)) + 1}
          onPick={(ordinal) => setConfig('corner', ordinal)}
        />
        {legend.length > 0 && <Legend className="legend" entries={legend} />}
      </>
    );
  },
});
