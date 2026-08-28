import { specOf } from '@core/render/looks.js';
import type { TubeSpec } from '@core/render/tube/index.js';
import type { LoadedFont } from '@core/text/font.js';
import { DEFAULT_GLYPH_OPTIONS, glyphToShapes } from '@core/text/glyphs.js';
import { Workspace } from '@weasel-js/labkit';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import { LabRenderer, type PanelDraw, type PanelRect } from './render/lab.js';
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

/** How a panel is being looked at. In memory only, unlike the layout. */
interface View {
  yaw: number;
  pitch: number;
  zoom: number;
}

const HEAD_ON: View = { yaw: 0, pitch: 0, zoom: 1 };

/** The turned pose's yaw, with enough pitch to show a planar loop ring as an ellipse. */
const TURNED: View = { yaw: (30 * Math.PI) / 180, pitch: (13 * Math.PI) / 180, zoom: 1 };

function initialView(pose: Pose): View {
  return pose === 'turned' ? TURNED : HEAD_ON;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

/** Measured in Chrome: a mouse notch is a `deltaY` of ~100; a pinch streams a few per event. */
const WHEEL_STEP = 500;
const PINCH_STEP = 100;

/** Long enough to outlast a tile's own move, short enough that a stuck layout stops costing frames. */
const SETTLE_FRAMES = 40;

interface ViewProps {
  'data-view': string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}

interface PanelTileProps {
  record: PanelRecord;
  summary: string | undefined;
  onSource: (id: string, source: RampSource) => void;
  viewProps: (id: string, pose: Pose) => ViewProps;
  onReset: (id: string, pose: Pose) => void;
  /** Hands the panel's own element up, so the lab can scissor the canvas to where it sits. */
  onMount: (id: string, element: HTMLDivElement | null) => void;
}

function PanelTile({ record, summary, onSource, viewProps, onReset, onMount }: PanelTileProps) {
  const { id, letter, mode, pose, source } = record;
  return (
    <div
      className="panel"
      ref={(el) => {
        onMount(id, el);
      }}
    >
      <div className="panel__bar">
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
      </div>
      <div className="panel__body" {...viewProps(id, pose)}>
        <button
          type="button"
          className="panel__reset"
          aria-label={`reset the ${letter} ${pose} ${mode} view`}
          // The button sits on the drag surface: without this a click starts a turn instead.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onReset(id, pose)}
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
  const elements = useRef(new Map<string, HTMLDivElement>());
  const rects = useRef(new Map<string, PanelRect>());
  const observer = useRef<ResizeObserver | null>(null);
  const measureFrame = useRef(0);
  const quiet = useRef(0);
  const oneFrame = useRef(0);
  const dirty = useRef<string | null>(null);
  const frame = useRef(0);
  const latest = useRef<() => void>(() => {});
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [reports, setReports] = useState<Record<string, string>>({});
  /** Bumped when a tile moves or resizes; the draw effect reads the rects themselves from a ref. */
  const [placed, setPlaced] = useState(0);

  const setReport = useCallback((id: string, summary: string) => {
    setReports((prev) => (prev[id] === summary ? prev : { ...prev, [id]: summary }));
  }, []);

  useEffect(() => {
    labFont().then(setFont, (err: unknown) => console.error('tube lab: font failed', err));
  }, []);

  /**
   * Tiles are positioned by the grid, so their rects are read from the DOM rather than handed over.
   * A seam drag resizes two tiles and a reorder moves several without resizing any, so every tile
   * is re-measured whenever one of them reports.
   */
  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return false;
    const base = stage.getBoundingClientRect();
    let changed = false;
    for (const [id, el] of elements.current) {
      const box = el.getBoundingClientRect();
      const next: PanelRect = {
        x: box.left - base.left,
        y: box.top - base.top,
        w: box.width,
        h: box.height,
      };
      const prev = rects.current.get(id);
      if (
        prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.w === next.w &&
        prev.h === next.h
      ) {
        continue;
      }
      rects.current.set(id, next);
      changed = true;
    }
    for (const id of [...rects.current.keys()]) {
      if (elements.current.has(id)) continue;
      rects.current.delete(id);
      changed = true;
    }
    if (changed) setPlaced((n) => n + 1);
    return changed;
  }, []);

  /**
   * Measures until the rects hold still. The canvas cannot tween with the DOM, so it has to land
   * where the tiles land: a size change is observed, but a tile that only moves reports nothing.
   */
  const scheduleMeasure = useCallback(() => {
    if (measureFrame.current) {
      quiet.current = 0;
      return;
    }
    quiet.current = 0;
    let frames = 0;
    const step = () => {
      quiet.current = measure() ? 0 : quiet.current + 1;
      frames += 1;
      if (quiet.current >= 2 || frames > SETTLE_FRAMES) {
        measureFrame.current = 0;
        return;
      }
      measureFrame.current = requestAnimationFrame(step);
    };
    measureFrame.current = requestAnimationFrame(step);
  }, [measure]);

  useEffect(() => {
    const ro = new ResizeObserver(scheduleMeasure);
    observer.current = ro;
    for (const el of elements.current.values()) ro.observe(el);
    const stage = stageRef.current;
    if (stage) ro.observe(stage);
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, [scheduleMeasure]);

  const mountTile = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      const known = elements.current.get(id);
      if (known && known !== el) observer.current?.unobserve(known);
      if (el) {
        elements.current.set(id, el);
        observer.current?.observe(el);
      } else {
        elements.current.delete(id);
      }
      scheduleMeasure();
    },
    [scheduleMeasure],
  );

  // A tile that only moves reports nothing, so re-measure whenever the arrangement itself changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ids and layout are the signal that tiles moved, not values this reads
  useEffect(scheduleMeasure, [scheduleMeasure, ids, layout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // The canvas spans `.stage` and sits behind the grid rather than inside its zone, so the zone's
    // `overflow: hidden` never reaches it. Each panel's measured rect scissors its own draw.
    const lab = new LabRenderer(canvas);
    labRef.current = lab;
    const cells = cellsRef.current;
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (oneFrame.current) cancelAnimationFrame(oneFrame.current);
      if (measureFrame.current) cancelAnimationFrame(measureFrame.current);
      frame.current = 0;
      oneFrame.current = 0;
      measureFrame.current = 0;
      for (const cell of cells.values()) cell.dispose();
      cells.clear();
      lab.dispose();
      labRef.current = null;
    };
  }, []);

  // A tuning tool has no use for an idle 60fps: one draw per change, coalesced into a frame.
  const drawAll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      latest.current();
    });
  }, []);

  // `fit` is absolute, so the view can be re-applied any number of times without compounding.
  const pose = useCallback((cell: Cell, id: string, aspect: number) => {
    const view = views.current.get(id) ?? HEAD_ON;
    cell.pivot.rotation.set(view.pitch, view.yaw, 0);
    cell.fit(aspect, view.zoom);
  }, []);

  // The only draw that skips `clear()`: every other panel's pixels have to survive in the
  // framebuffer. The frame reads `dirty` when it runs, so a burst coalesces onto the newest state.
  const drawOne = useCallback(
    (id: string) => {
      dirty.current = id;
      if (oneFrame.current) return;
      oneFrame.current = requestAnimationFrame(() => {
        oneFrame.current = 0;
        const target = dirty.current;
        dirty.current = null;
        const lab = labRef.current;
        if (!target || !lab) return;
        const cell = cellsRef.current.get(target);
        const rect = rects.current.get(target);
        if (!cell || !rect) return;
        pose(cell, target, rect.w / rect.h);
        lab.draw([
          { rect, scene: cell.scene, camera: cell.camera, bloom: cell.bloomable && bloom },
        ]);
      });
    },
    [bloom, pose],
  );

  const resetView = useCallback(
    (id: string, pose: Pose) => {
      views.current.set(id, initialView(pose));
      drawOne(id);
    },
    [drawOne],
  );

  const viewProps = useCallback(
    (id: string, pose: Pose): ViewProps => ({
      'data-view': id,
      onPointerDown: (event) => {
        event.stopPropagation();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        let last = { x: event.clientX, y: event.clientY };
        const move = (e: PointerEvent) => {
          const view = views.current.get(id) ?? HEAD_ON;
          // A half turn across the panel's own width, so the gesture scales with the panel.
          const span = Math.max(1, target.clientWidth);
          views.current.set(id, {
            ...view,
            yaw: view.yaw + ((e.clientX - last.x) / span) * Math.PI,
            pitch: view.pitch + ((e.clientY - last.y) / span) * Math.PI,
          });
          last = { x: e.clientX, y: e.clientY };
          drawOne(id);
        };
        const up = () => {
          if (target.hasPointerCapture(event.pointerId))
            target.releasePointerCapture(event.pointerId);
          target.removeEventListener('pointermove', move);
          target.removeEventListener('pointerup', up);
          target.removeEventListener('pointercancel', up);
          target.removeEventListener('lostpointercapture', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
        // Capture can go without a pointerup — a re-render that replaces the panel is enough — and
        // after that neither move nor up fires here, so a buttonless hover keeps turning the letter.
        target.addEventListener('lostpointercapture', up);
      },
      onDoubleClick: () => resetView(id, pose),
    }),
    [drawOne, resetView],
  );

  // React attaches wheel passively at its root, where preventDefault does nothing and a trackpad
  // pinch zooms the whole page instead of the letter. Hence a listener of our own on the stage.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const id = (event.target as Element | null)
        ?.closest('[data-view]')
        ?.getAttribute('data-view');
      if (!id) return;
      event.preventDefault();
      const view = views.current.get(id) ?? HEAD_ON;
      // ctrlKey is how a macOS trackpad pinch reaches the page.
      const step = event.ctrlKey ? PINCH_STEP : WHEEL_STEP;
      const zoom = view.zoom * Math.exp(-event.deltaY / step);
      views.current.set(id, { ...view, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) });
      drawOne(id);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [drawOne]);

  // The frame calls the newest body, never the one that queued it: coalescing on the call would
  // drop the later layout and leave the canvas at rects nothing reschedules.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `placed` is the signal that measured rects changed; the rects are read from a ref
  useEffect(() => {
    latest.current = () => {
      const lab = labRef.current;
      const stage = stageRef.current;
      if (!lab || !stage || !font) return;
      lab.resize(stage.clientWidth, stage.clientHeight);
      lab.clear();

      const draws: PanelDraw[] = [];
      const live = new Set<string>();
      for (const record of panels) {
        const rect = rects.current.get(record.id);
        if (!rect) continue;
        const id = record.id;
        const key = `${id}|${record.mode}|${record.letter}|${record.source}|${specKey}`;
        live.add(id);
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
    };
    drawAll();
  }, [drawAll, font, panels, placed, spec, specKey, look, bloom, setReport, pose]);

  return (
    <div className="lab">
      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} />
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
              viewProps={viewProps}
              onReset={resetView}
              onMount={mountTile}
            />
          ))}
        </Workspace>
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
