import type { PathSource } from '@core/render/tube/generators.js';
import type { LoadedFont } from '@core/text/font.js';
import { defineInstrument } from '@weasel-js/labkit';
import type * as THREE from 'three';
import { buildScene, type CornerScene, REPAIRS, type Repair } from './scene.js';
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

  render: ({ state }) => (
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
  ),
});
