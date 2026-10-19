import { specOf } from '@core/render/looks.js';
import type { TubeSpec } from '@core/render/tube/index.js';
import type { LoadedFont } from '@core/text/font.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '@core/text/glyphs.js';
import { LabBar } from '@shared/LabBar.js';
import { LabRenderer, type PanelDraw } from '@shared/lab-renderer.js';
import { HOME, orbitPose } from '@shared/orbit.js';
import {
  Orbit,
  type OrbitProps,
  SurfaceContext,
  TileGrip,
  useSurfaceTile,
  useTiledSurface,
  Workspace,
} from '@weasel-js/labkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { labFont } from './font.js';
import {
  type PanelMode,
  type PanelRecord,
  type Pose,
  RAMP_SOURCES,
  type RampSource,
  reconcileLetters,
} from './panels.js';
import { clear, save, type WorkspaceLayout } from './persist.js';
import { Rail } from './Rail.js';
import { buildCell, type Cell } from './render/cell.js';
import { rampOverride } from './render/ramp.js';
import { buildSkeleton } from './render/skeleton.js';
import { type TubeLook, tubeSpecOf } from './spec.js';

let nextPanel = 0;

/**
 * A fresh id, never recycled: a view is held against it, and a new panel inheriting a dead one's
 * turn and zoom is indistinguishable from a bug in the pose.
 */
export function mintPanelId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let id = `n${nextPanel++}`;
  while (used.has(id)) id = `n${nextPanel++}`;
  return id;
}

/** How a panel is being looked at: labkit's orbit camera. In memory only, unlike the layout. */
type View = OrbitProps['view'];

const HEAD_ON: View = { ...HOME, near: 0.1, far: 100 };

/** The turned pose's yaw, with enough pitch to show a planar loop ring as an ellipse. */
const TURNED: View = { ...HEAD_ON, yaw: (-30 * Math.PI) / 180, pitch: (13 * Math.PI) / 180 };

function initialView(pose: Pose): View {
  return pose === 'turned' ? TURNED : HEAD_ON;
}

/** A zoom from half size to four times, as a dolly. */
const LIMITS = { minDistance: HOME.distance / 4, maxDistance: HOME.distance * 2 };

interface PanelTileProps {
  record: PanelRecord;
  summary: string | undefined;
  onSource: (id: string, source: RampSource) => void;
  onView: (id: string, view: View) => void;
}

function PanelTile({ record, summary, onSource, onView }: PanelTileProps) {
  const { id, letter, mode, pose, source } = record;
  // The body under the bar, so the canvas is scissored to the box the orbit measures its gestures on.
  const tile = useSurfaceTile(id);
  const [view, setView] = useState(() => initialView(pose));
  useEffect(() => onView(id, view), [onView, id, view]);
  const home = useCallback(() => initialView(pose), [pose]);
  return (
    <div className="panel">
      <TileGrip className="panel__bar">
        <span className="panel__letter">{letter}</span>
        <span className="panel__mode">{mode}</span>
        {mode === 'ramp' ? (
          <select value={source} onChange={(e) => onSource(id, e.target.value as RampSource)}>
            {RAMP_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : null}
      </TileGrip>
      <div className="panel__body" ref={tile}>
        <Orbit view={view} onViewChange={setView} home={home} limits={LIMITS}>
          <button
            type="button"
            className="panel__reset"
            aria-label={`reset the ${letter} ${pose} ${mode} view`}
            onClick={() => setView(home())}
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
        </Orbit>
      </div>
    </div>
  );
}

export interface AppProps {
  panels: PanelRecord[];
  layout: WorkspaceLayout;
  letters: string;
  spec: TubeSpec;
  look: TubeLook;
}

export function App({
  panels: initialPanels,
  layout: initialLayout,
  letters: initialLetters,
  spec: initialSpec,
  look: initialLook,
}: AppProps) {
  const [panels, setPanels] = useState(initialPanels);
  const [layout, setLayout] = useState(initialLayout);
  const [letters, setLetters] = useState(initialLetters);
  const [spec, setSpec] = useState(initialSpec);
  const [lookName, setLookName] = useState(initialLook);
  const [bloom, setBloom] = useState(true);
  const look = useMemo(() => specOf(lookName), [lookName]);
  // Bloom stays out of the key: the renderer reads it per draw, so toggling it costs a draw.
  const specKey = `${JSON.stringify(spec)}|${lookName}`;
  const ids = useMemo(() => panels.map((p) => p.id), [panels]);

  /** Changing look reseeds the rail, so the controls keep reading as that look's own tuning. */
  const changeLook = useCallback((next: TubeLook) => {
    setLookName(next);
    setSpec(tubeSpecOf(next));
  }, []);

  const applyLetters = useCallback((next: string) => {
    setLetters(next);
    setPanels((prev) => {
      const { add, remove } = reconcileLetters(prev, next);
      const dropped = new Set(remove);
      const kept = prev.filter((p) => !dropped.has(p.id));
      const taken = kept.map((p) => p.id);
      const added = add.map((meta) => {
        const id = mintPanelId(taken);
        taken.push(id);
        return { id, ...meta };
      });
      return [...kept, ...added];
    });
  }, []);

  /** The rail's own add: one panel, outside the letters reconcile. */
  const addPanel = useCallback((letter: string, mode: PanelMode) => {
    setPanels((prev) => [
      ...prev,
      { id: mintPanelId(prev.map((p) => p.id)), letter, mode, pose: 'head-on', source: 'depth' },
    ]);
  }, []);

  const setSource = useCallback((id: string, source: RampSource) => {
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, source } : p)));
  }, []);

  const reorder = useCallback((next: readonly string[]) => {
    setPanels((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      const ordered = next.flatMap((id) => byId.get(id) ?? []);
      // A drop reports every id, but trust the panels rather than the report: anything the grid
      // did not name would otherwise vanish from the lab entirely.
      return ordered.length === prev.length ? ordered : prev;
    });
  }, []);

  useEffect(() => {
    let timer = 0;
    const flush = () => {
      timer = 0;
      save(panels, layout, letters, spec, lookName);
    };
    // Clear before flushing, or the armed timer fires later and writes this closure's stale values.
    const flushPending = () => {
      if (!timer) return;
      clearTimeout(timer);
      flush();
    };
    timer = window.setTimeout(flush, 200);
    // A reload does not unmount, so the cleanup alone would drop a drag made inside the window.
    window.addEventListener('pagehide', flushPending);
    return () => {
      window.removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, [panels, layout, letters, spec, lookName]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labRef = useRef<LabRenderer | null>(null);
  const cellsRef = useRef(new Map<string, Cell>());
  const views = useRef(new Map<string, View>());
  const sized = useRef({ w: 0, h: 0, ratio: 0 });
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The canvas spans `.stage` and sits behind the grid rather than inside its zone, so the zone's
    // `overflow: hidden` never reaches it. Each panel's measured rect scissors its own draw.
    const lab = new LabRenderer(canvas);
    labRef.current = lab;
    const cells = cellsRef.current;
    return () => {
      for (const cell of cells.values()) cell.dispose();
      cells.clear();
      lab.dispose();
      labRef.current = null;
    };
  }, []);

  // `fit` is absolute, so the view can be re-applied any number of times without compounding.
  const pose = useCallback((cell: Cell, id: string, aspect: number) => {
    const { rotation, zoom, position } = orbitPose(views.current.get(id) ?? HEAD_ON);
    cell.pivot.rotation.copy(rotation);
    cell.fit(aspect, zoom);
    cell.pivot.position.copy(position);
  }, []);

  // Tiles are positioned by the grid, so the surface reads their rects from the DOM and keeps
  // reading while they move. A tuning tool has no use for an idle 60fps: it calls back only on a
  // frame something was invalidated for.
  const surface = useTiledSurface({
    onFrame: ({ dirty, rects, retiled }) => {
      const lab = labRef.current;
      const stage = stageRef.current;
      if (!lab || !stage || !font) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const ratio = globalThis.devicePixelRatio ?? 1;
      const was = sized.current;
      const resized = was.w !== w || was.h !== h || was.ratio !== ratio;
      // Sizing the buffer blanks it, and a re-tile strands the old panels' pixels in the gutters:
      // either owes every panel a draw. Any other frame draws its dirty panels and skips the
      // clear, because every other panel's pixels have to survive in the framebuffer.
      const all = stale.current || retiled || resized;
      stale.current = false;
      if (resized) {
        sized.current = { w, h, ratio };
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
        // Against the id, not the cell: a cell is rebuilt on every spec change, and a slider drag
        // must not walk every panel back to head-on. Ids are never recycled, so this is safe.
        if (!views.current.has(id)) views.current.set(id, initialView(record.pose));
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
        pose(cell, id, rect.w / rect.h);
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
        views.current.delete(id);
        setReport(id, '');
      }
      lab.draw(draws);
    },
  });
  const { invalidate, invalidateAll, containerRef } = surface;

  const attachStage = useCallback(
    (el: HTMLDivElement | null) => {
      stageRef.current = el;
      containerRef(el);
    },
    [containerRef],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: each of these changes what every panel shows; none is a value this reads
  useEffect(() => {
    stale.current = true;
    invalidateAll();
  }, [invalidateAll, font, panels, specKey, bloom]);

  const setView = useCallback(
    (id: string, view: View) => {
      views.current.set(id, view);
      invalidate(id);
    },
    [invalidate],
  );

  return (
    <div className="lab">
      <LabBar lab="tube-lab" />
      <div className="stage" ref={attachStage}>
        <canvas ref={canvasRef} />
        <SurfaceContext.Provider value={surface}>
          <Workspace
            ids={ids}
            resizable
            reorderable
            onReorder={reorder}
            layout={layout}
            onLayoutChange={setLayout}
            gap={6}
          >
            {panels.map((record) => (
              <PanelTile
                key={record.id}
                record={record}
                summary={reports[record.id]}
                onSource={setSource}
                onView={setView}
              />
            ))}
          </Workspace>
        </SurfaceContext.Provider>
      </div>
      <Rail
        spec={spec}
        onSpec={setSpec}
        look={lookName}
        onLook={changeLook}
        bloom={bloom}
        onBloom={setBloom}
        letters={letters}
        onLetters={applyLetters}
        onAddPanel={addPanel}
        onReset={() => {
          clear();
          location.reload();
        }}
      />
    </div>
  );
}
