import { specOf } from '@core/render/looks.js';
import type { LoadedFont } from '@core/text/font.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '@core/text/glyphs.js';
import type { Orbit } from '@shared/orbit.js';
import {
  type OverAccess,
  useOrbitView,
  useSurface,
  useSurfaceCanvas,
  useSurfaceTile,
  useTileId,
  useTrialHistory,
} from '@weasel-js/labkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { labFont } from './font.js';
import { labHistory } from './history.js';
import { lettersOf, type PanelMode, type RampSource } from './panels.js';
import { drawn } from './readout.js';
import { buildCell, type Cell } from './render/cell.js';
import { rampOverride } from './render/ramp.js';
import { buildSkeleton } from './render/skeleton.js';
import { sharedRenderer } from './renderer.js';
import { lookOf, sharedFrom, specOfShared } from './shared.js';

const TILE = 'panel';

export interface PanelProps {
  letter: string;
  mode: PanelMode;
  source: RampSource;
  over: OverAccess | undefined;
  /** Where the panel's camera opens, which the fit sizes the letter against. */
  home: Orbit;
}

/** One panel: a trial's tile of the lab's shared surface, drawn from the shared spec under the trial's camera. */
export function Panel({ letter: typed, mode, source, over, home: opening }: PanelProps) {
  useTrialHistory(labHistory);
  const tileId = useTileId(TILE);
  const attachTile = useSurfaceTile(TILE);
  const surface = useSurface();
  // Under the trial DOM, so the pane's label and readout sit over the letter.
  const canvas = useSurfaceCanvas('under');
  const orbit = useOrbitView();
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    labFont().then(setFont, (err: unknown) => console.error('tube lab: font failed', err));
  }, []);

  const shared = useMemo(() => sharedFrom(over?.read), [over]);
  const spec = useMemo(() => specOfShared(shared), [shared]);
  const lookName = lookOf(shared);
  const bloom = shared.bloom !== false;
  const letter = lettersOf(typed)[0] ?? '';
  const key = `${letter}|${mode}|${source}|${lookName}|${JSON.stringify(spec)}`;

  // Read by the painter, which runs outside render.
  const latest = useRef({ key, spec, lookName, bloom, font, letter, mode, source, orbit, opening });
  latest.current = { key, spec, lookName, bloom, font, letter, mode, source, orbit, opening };

  useEffect(() => {
    if (!canvas) return;
    const { lab, fit } = sharedRenderer(canvas);
    let cell: Cell | null = null;
    // Gutters lie outside every scissor, so a re-tile strands the old panels' pixels there.
    const unclear = surface.registerClear(tileId, (size) => {
      fit(size);
      lab.clear();
    });
    const unpaint = surface.registerPainter(tileId, (rect, frame) => {
      const now = latest.current;
      if (fit(frame.size)) surface.invalidateAll();
      if (!now.font || now.letter === '') return;
      if (!cell || cell.key !== now.key) {
        cell?.dispose();
        const look = { ...specOf(now.lookName), decoration: now.spec };
        if (now.mode === 'skeleton') {
          const shapes = glyphToShapes(now.font.font, now.letter, 1);
          const skeleton = buildSkeleton(shapes, now.spec, DEFAULT_GLYPH_OPTIONS.depth);
          const built = buildCell({
            letter: now.letter,
            look,
            font: now.font,
            environment: lab.environmentTexture,
            content: skeleton.object,
          });
          const inner = built.dispose;
          built.dispose = () => {
            inner();
            skeleton.dispose();
          };
          cell = built;
          setSummary(skeleton.report.summary);
        } else {
          const ramp = now.mode === 'ramp' ? rampOverride(now.source) : null;
          cell = buildCell({
            letter: now.letter,
            look,
            font: now.font,
            environment: lab.environmentTexture,
            ...(ramp ? { tubeMaterial: ramp.material } : null),
          });
          ramp?.fit(cell.pivot);
          setSummary('');
        }
        cell.key = now.key;
      }
      cell.pose(rect.width / rect.height, now.orbit.camera ?? now.opening, now.opening);
      drawn.canvas = canvas;
      drawn.cells.set(tileId, cell);
      drawn.rects.set(tileId, rect);
      lab.draw([
        { rect, scene: cell.scene, camera: cell.camera, bloom: cell.bloomable && now.bloom },
      ]);
    });
    return () => {
      unpaint();
      unclear();
      cell?.dispose();
      drawn.cells.delete(tileId);
      drawn.rects.delete(tileId);
    };
  }, [canvas, surface, tileId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: each of these changes what the panel shows; the painter reads them from `latest`
  useEffect(() => {
    surface.invalidate(tileId);
  }, [surface, tileId, key, bloom, font, orbit.camera]);

  const { viewportRef, home } = orbit;
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      attachTile(el);
      viewportRef(el);
    },
    [attachTile, viewportRef],
  );

  return (
    <div className="panel" ref={attach}>
      <button
        type="button"
        className="panel__home"
        aria-label={`reset the ${letter} ${mode} view`}
        onClick={home}
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 8a6 6 0 1 1-1.8-4.3" />
          <path d="M12.2 3.7 8.9 3.1M12.2 3.7 11.5 6.6" />
        </svg>
      </button>
      {summary ? <p className="panel__readout">{summary}</p> : null}
    </div>
  );
}
