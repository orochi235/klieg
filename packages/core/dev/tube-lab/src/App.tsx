import { specOf } from '@core/render/looks.js';
import type { LoadedFont } from '@core/text/font.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '@core/text/glyphs.js';
import { LabRenderer, type PanelDraw } from '@shared/lab-renderer.js';
import { orbitPose } from '@shared/orbit.js';
import { LightboxLayers, SurfaceContext, useTiledSurface, Workspace } from '@weasel-js/labkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { labFont } from './font.js';
import { initialView, PanelTile, type View } from './PanelTile.js';
import type { RampSource } from './panels.js';
import { Rail } from './Rail.js';
import { buildCell, type Cell } from './render/cell.js';
import { rampOverride } from './render/ramp.js';
import { buildSkeleton } from './render/skeleton.js';
import { type LabState, useLabState } from './state.js';

export function App({ legacy }: { legacy: Parameters<typeof useLabState>[0] }) {
  const state: LabState = useLabState(legacy);
  const { panels, spec, lookName, bloom, views } = state;
  const look = useMemo(() => specOf(lookName), [lookName]);
  // Bloom stays out of the key: the renderer reads it per draw, so toggling it costs a draw.
  const specKey = `${JSON.stringify(spec)}|${lookName}`;
  const ids = useMemo(() => panels.map((p) => p.id), [panels]);

  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const labRef = useRef<LabRenderer | null>(null);
  const cellsRef = useRef(new Map<string, Cell>());
  // Read by the frame loop, which runs outside render.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  const sized = useRef({ w: 0, h: 0, dpr: 0 });
  /** Set by a change to what every panel shows, so the next frame draws them all. */
  const stale = useRef(true);
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});

  const setReport = useCallback((id: string, summary: string) => {
    setReports((prev) => (prev[id] === summary ? prev : { ...prev, [id]: summary }));
  }, []);

  useEffect(() => {
    labFont().then(setFont, (err: unknown) => console.error('tube lab: font failed', err));
  }, []);

  // `fit` is absolute, so the view can be re-applied any number of times without compounding.
  const pose = useCallback((cell: Cell, view: View, aspect: number) => {
    const { rotation, zoom, position } = orbitPose(view);
    cell.pivot.rotation.copy(rotation);
    cell.fit(aspect, zoom);
    cell.pivot.position.copy(position);
  }, []);

  // Tiles are positioned by the grid, so the surface reads their rects from the DOM and keeps
  // reading while they move. A tuning tool has no use for an idle 60fps: it calls back only on a
  // frame something was invalidated for.
  const surface = useTiledSurface({
    onFrame: ({ dirty, rects, retiled, size, dpr }) => {
      const lab = labRef.current;
      if (!lab || !font) return;
      const { width: w, height: h } = size;
      const was = sized.current;
      const resized = was.w !== w || was.h !== h || was.dpr !== dpr;
      // Sizing the buffer blanks it, and a re-tile strands the old panels' pixels in the gutters:
      // either owes every panel a draw. Any other frame draws its dirty panels and skips the
      // clear, because every other panel's pixels have to survive in the framebuffer.
      const all = stale.current || retiled || resized;
      stale.current = false;
      if (resized) {
        sized.current = { w, h, dpr };
        lab.resize(w, h);
      }
      if (all) lab.clear();

      const draws: PanelDraw[] = [];
      const live = new Set<string>();
      for (const record of panels) {
        const id = record.id;
        live.add(id);
        const rect = rects.get(id);
        if (!rect || !(all || dirty.has(id))) continue;
        const key = `${id}|${record.mode}|${record.letter}|${record.source}|${specKey}`;
        let cell = cellsRef.current.get(id);
        if (!cell || cell.key !== key) {
          cell?.dispose();
          if (record.mode === 'skeleton') {
            const shapes = glyphToShapes(font.font, record.letter, 1);
            const skeleton = buildSkeleton(shapes, spec, DEFAULT_GLYPH_OPTIONS.depth);
            cell = buildCell({
              meta: record,
              look: { ...look, decoration: spec },
              font,
              environment: lab.environmentTexture,
              content: skeleton.object,
            });
            const inner = cell.dispose;
            cell.dispose = () => {
              inner();
              skeleton.dispose();
            };
            setReport(id, skeleton.report.summary);
          } else {
            const ramp = record.mode === 'ramp' ? rampOverride(record.source) : null;
            cell = buildCell({
              meta: record,
              look: { ...look, decoration: spec },
              font,
              environment: lab.environmentTexture,
              ...(ramp ? { tubeMaterial: ramp.material } : null),
            });
            ramp?.fit(cell.pivot);
            setReport(id, '');
          }
          cell.key = key;
          cellsRef.current.set(id, cell);
        }
        // Against the id, not the cell: a cell is rebuilt on every spec change, and a slider drag
        // must not walk every panel back to head-on.
        pose(cell, viewsRef.current[id] ?? initialView(record.pose), rect.w / rect.h);
        draws.push({
          rect,
          scene: cell.scene,
          camera: cell.camera,
          bloom: cell.bloomable && bloom,
        });
      }
      for (const [id, cell] of cellsRef.current) {
        if (live.has(id)) continue;
        cell.dispose();
        cellsRef.current.delete(id);
        setReport(id, '');
      }
      lab.draw(draws);
    },
  });
  const { invalidate, invalidateAll, containerRef } = surface;

  // The canvas is the surface container rather than the stage: a lightbox lifts it to cover the
  // window, and the panels then have to be measured against where it went.
  useEffect(() => {
    if (!canvas) return;
    containerRef(canvas);
    const lab = new LabRenderer(canvas);
    labRef.current = lab;
    sized.current = { w: 0, h: 0, dpr: 0 };
    const cells = cellsRef.current;
    return () => {
      for (const cell of cells.values()) cell.dispose();
      cells.clear();
      lab.dispose();
      labRef.current = null;
      containerRef(null);
    };
  }, [canvas, containerRef]);
  const below = useMemo(() => [canvas], [canvas]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: each of these changes what every panel shows; none is a value this reads
  useEffect(() => {
    stale.current = true;
    invalidateAll();
  }, [invalidateAll, font, panels, specKey, bloom, state.epoch]);

  const { setView: storeView, setPanels } = state;
  const setView = useCallback(
    (id: string, view: View) => {
      storeView(id, view);
      invalidate(id);
    },
    [storeView, invalidate],
  );

  const setSource = useCallback(
    (id: string, source: RampSource) => {
      setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, source } : p)));
    },
    [setPanels],
  );

  return (
    <div className="lab">
      <div className="stage">
        <canvas className="stage__canvas" ref={setCanvas} />
        <SurfaceContext.Provider value={surface}>
          <LightboxLayers below={below}>
            <Workspace
              ids={ids}
              resizable
              reorderable
              onReorder={state.reorder}
              layout={state.layout}
              onLayoutChange={state.setLayout}
              gap={6}
            >
              {panels.map((record) => (
                <PanelTile
                  key={record.id}
                  record={record}
                  view={views[record.id]}
                  summary={reports[record.id]}
                  onSource={setSource}
                  onView={setView}
                />
              ))}
            </Workspace>
          </LightboxLayers>
        </SurfaceContext.Provider>
      </div>
      <Rail
        spec={spec}
        onSpec={state.setSpec}
        look={lookName}
        onLook={state.changeLook}
        bloom={bloom}
        onBloom={state.setBloom}
        letters={state.letters}
        onLetters={state.applyLetters}
        onAddPanel={state.addPanel}
        onReset={state.reset}
      />
    </div>
  );
}
