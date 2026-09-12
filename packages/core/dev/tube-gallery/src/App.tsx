import type { LoadedFont } from '@core/text/font.js';
import { LabBar } from '@shared/LabBar.js';
import { LabRenderer, type PanelDraw, type PanelRect } from '@shared/lab-renderer.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { buildCell, type GalleryCell } from './cell.js';
import { labFont } from './font.js';
import { lookFor, VARIANTS } from './variants.js';

export function App() {
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [letter, setLetter] = useState('S');
  const [bloom, setBloom] = useState(true);
  const [running, setRunning] = useState(true);
  const [fault, setFault] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const labRef = useRef<LabRenderer | null>(null);
  const cells = useRef(new Map<string, GalleryCell>());
  const tiles = useRef(new Map<string, HTMLDivElement>());
  const rects = useRef(new Map<string, PanelRect>());
  const frame = useRef(0);
  const last = useRef(0);
  const elapsed = useRef(0);

  // Read by the frame, which subscribes once: putting them in the deps would tear the loop down
  // and restart the clock every time a switch moved.
  const live = useRef({ bloom, running });
  live.current = { bloom, running };

  useEffect(() => {
    labFont().then(setFont, (err: unknown) => console.error('tube gallery: font failed', err));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const lab = new LabRenderer(canvas);
    labRef.current = lab;
    const built = cells.current;
    return () => {
      for (const cell of built.values()) cell.dispose();
      built.clear();
      lab.dispose();
      labRef.current = null;
    };
  }, []);

  /** Every tile's box in the stage's own space, which is the space the canvas is scissored in. */
  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const base = stage.getBoundingClientRect();
    labRef.current?.resize(base.width, base.height);
    for (const [id, el] of tiles.current) {
      const body = el.querySelector('.tile__body') ?? el;
      const box = body.getBoundingClientRect();
      rects.current.set(id, {
        x: box.left - base.left,
        y: box.top - base.top,
        w: box.width,
        h: box.height,
      });
    }
  }, []);

  useEffect(() => {
    const lab = labRef.current;
    if (!lab || !font) return;
    const built = cells.current;
    for (const cell of built.values()) cell.dispose();
    built.clear();
    const char = [...letter][0] ?? 'S';
    try {
      for (const variant of VARIANTS) {
        built.set(
          variant.id,
          buildCell({
            letter: char,
            look: lookFor(variant),
            font,
            environment: lab.environmentTexture,
          }),
        );
      }
      setFault(null);
    } catch (err) {
      setFault(err instanceof Error ? err.message : String(err));
    }
    measure();
  }, [font, letter, measure]);

  useEffect(() => {
    const observer = new ResizeObserver(measure);
    const stage = stageRef.current;
    if (stage) observer.observe(stage);
    for (const el of tiles.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    const tick = (now: number) => {
      frame.current = requestAnimationFrame(tick);
      const lab = labRef.current;
      if (!lab) return;
      const dt = last.current > 0 ? now - last.current : 0;
      last.current = now;
      if (live.current.running) elapsed.current += dt;

      const panels: PanelDraw[] = [];
      for (const variant of VARIANTS) {
        const cell = cells.current.get(variant.id);
        const rect = rects.current.get(variant.id);
        if (!cell || !rect || rect.w < 2 || rect.h < 2) continue;
        cell.advance(elapsed.current, dt);
        cell.fit(rect.w / rect.h);
        panels.push({ rect, scene: cell.scene, camera: cell.camera, bloom: live.current.bloom });
      }
      lab.clear();
      lab.draw(panels);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      last.current = 0;
    };
  }, []);

  const mountTile = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) tiles.current.set(id, el);
    else tiles.current.delete(id);
  }, []);

  return (
    <div className="lab">
      <LabBar lab="tube-gallery" />
      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} />
        <div className="grid">
          {VARIANTS.map((variant) => (
            <div
              className="tile"
              key={variant.id}
              ref={(el) => {
                mountTile(variant.id, el);
              }}
            >
              <div className="tile__bar">{variant.label}</div>
              <div className="tile__body" />
            </div>
          ))}
        </div>
      </div>
      <div className="rail">
        <label>
          letter
          <input
            type="text"
            value={letter}
            maxLength={1}
            onChange={(event) => setLetter(event.target.value)}
          />
        </label>
        <label>
          bloom
          <input
            type="checkbox"
            checked={bloom}
            onChange={(event) => setBloom(event.target.checked)}
          />
        </label>
        <button type="button" onClick={() => setRunning((on) => !on)}>
          {running ? 'pause' : 'play'}
        </button>
        <p className="rail__note">
          {VARIANTS.length} variants, one GL context. Every cell sweeps its own hue.
        </p>
        {fault ? <p className="rail__fault">{fault}</p> : null}
      </div>
    </div>
  );
}
