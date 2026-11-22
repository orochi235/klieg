import type { LoadedFont } from '@core/text/font.js';
import { LabRenderer, type PanelDraw } from '@shared/lab-renderer.js';
import { LABS, labHref, labPages } from '@shared/pages.js';
import {
  LabShell,
  LightboxLayers,
  SurfaceContext,
  useSurfaceTile,
  useTiledSurface,
  Workspace,
} from '@weasel-js/labkit';
import { Button } from '@weasel-js/ui/components/Button';
import { Input } from '@weasel-js/ui/components/Input';
import { Switch } from '@weasel-js/ui/components/Switch';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCell, type GalleryCell } from './cell.js';
import { labFont } from './font.js';
import { lookFor, VARIANTS, type Variant } from './variants.js';

const IDS = VARIANTS.map((variant) => variant.id);

function Tile({ variant }: { variant: Variant }) {
  const body = useSurfaceTile(variant.id);
  return (
    <div className="tile">
      <div className="tile__bar">{variant.label}</div>
      <div className="tile__body" ref={body} />
    </div>
  );
}

export function App() {
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [letter, setLetter] = useState('S');
  const [bloom, setBloom] = useState(true);
  const [running, setRunning] = useState(true);
  const [fault, setFault] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const labRef = useRef<LabRenderer | null>(null);
  const cells = useRef(new Map<string, GalleryCell>());
  const sized = useRef({ w: 0, h: 0, dpr: 0 });
  const elapsed = useRef(0);
  const bloomRef = useRef(bloom);
  bloomRef.current = bloom;

  useEffect(() => {
    labFont().then(setFont, (err: unknown) => console.error('tube gallery: font failed', err));
  }, []);

  // Every cell sweeps on every frame, so a frame draws them all and clears the whole buffer first.
  const surface = useTiledSurface({
    onFrame: ({ rects, size, dpr }) => {
      const lab = labRef.current;
      if (!lab) return;
      const was = sized.current;
      if (was.w !== size.width || was.h !== size.height || was.dpr !== dpr) {
        sized.current = { w: size.width, h: size.height, dpr };
        lab.resize(size.width, size.height);
      }
      lab.clear();
      const panels: PanelDraw[] = [];
      for (const id of IDS) {
        const cell = cells.current.get(id);
        const rect = rects.get(id);
        if (!cell || !rect || rect.width < 2 || rect.height < 2) continue;
        cell.advance(elapsed.current);
        cell.fit(rect.width / rect.height);
        panels.push({ rect, scene: cell.scene, camera: cell.camera, bloom: bloomRef.current });
      }
      lab.draw(panels);
    },
  });
  const { containerRef, invalidateAll } = surface;

  // The canvas is the surface container rather than the stage: a lightbox lifts it to cover the
  // window, and the tiles then have to be measured against where it went.
  useEffect(() => {
    if (!canvas) return;
    containerRef(canvas);
    const lab = new LabRenderer(canvas);
    labRef.current = lab;
    sized.current = { w: 0, h: 0, dpr: 0 };
    const built = cells.current;
    return () => {
      for (const cell of built.values()) cell.dispose();
      built.clear();
      lab.dispose();
      labRef.current = null;
      containerRef(null);
    };
  }, [canvas, containerRef]);

  useEffect(() => {
    const lab = labRef.current;
    if (!canvas || !lab || !font) return;
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
    invalidateAll();
  }, [canvas, font, letter, invalidateAll]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: bloom is read per draw; a change only owes one
  useEffect(() => invalidateAll(), [bloom, invalidateAll]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (last > 0) elapsed.current += now - last;
      last = now;
      invalidateAll();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, invalidateAll]);

  const below = useMemo(() => [canvas], [canvas]);

  const rail = (
    <div className="rail">
      <div className="rail__letter">
        <Input label="letter" orientation="row" value={letter} maxLength={1} onChange={setLetter} />
      </div>
      <Switch isSelected={bloom} onChange={setBloom}>
        bloom
      </Switch>
      <Button size="sm" onClick={() => setRunning((on) => !on)}>
        {running ? 'pause' : 'play'}
      </Button>
      <p className="rail__note">
        {VARIANTS.length} variants, one GL context. Every cell sweeps its own hue.
      </p>
      {fault ? <p className="rail__fault">{fault}</p> : null}
    </div>
  );

  return (
    <LabShell
      title={LABS['tube-gallery'].label}
      pages={labPages()}
      path={labHref('tube-gallery')}
      mode="dark"
      footer={rail}
    >
      <div className="stage">
        <canvas className="stage__canvas" ref={setCanvas} />
        <SurfaceContext.Provider value={surface}>
          <LightboxLayers below={below}>
            <Workspace ids={IDS} gap={6} padding={6}>
              {VARIANTS.map((variant) => (
                <Tile key={variant.id} variant={variant} />
              ))}
            </Workspace>
          </LightboxLayers>
        </SurfaceContext.Provider>
      </div>
    </LabShell>
  );
}
