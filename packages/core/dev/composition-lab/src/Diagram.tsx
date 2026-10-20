import { DiagramView, type DiagramViewApi, diagramScene } from '@weasel-js/diagram';
import { registerCanvasFont } from '@weasel-js/font';
import { useEffect, useMemo, useRef, useState } from 'react';
import { entriesOf } from './config.js';
import { useLab, useSampled } from './hooks.js';
import { warningsOf } from './LayersControl.js';
import { NodeCard } from './NodeCard.js';
import { hasGradient } from './patches.js';
import { diagramOf, partOf } from './pipeline.js';
import { poolCounts } from './pool.js';

registerCanvasFont('sans-serif');

const FONT = { fontFamily: 'sans-serif', fontSize: 12 } as const;

/** The composition as a wiring diagram, and where its layers and motions are edited. */
export function Diagram() {
  const { config, composition } = useLab();
  const { parts } = useSampled();
  const counts = poolCounts(parts);
  const gradient = hasGradient(composition.look);
  const [picked, setPicked] = useState<string | null>(null);
  const view = useRef<DiagramViewApi | null>(null);

  const data = diagramOf(config, (entry) => warningsOf(entry, counts, composition.look, gradient));
  const ids = data.nodes.map((n) => n.id);
  // For headless driving, which clicks a node by its id through `rectOf`.
  useEffect(() => {
    const probe = globalThis as { kliegDiagram?: { view: typeof view; ids: string[] } };
    const mine = { view, ids };
    probe.kliegDiagram = mine;
    return () => {
      if (probe.kliegDiagram === mine) delete probe.kliegDiagram;
    };
  });
  const key = JSON.stringify(data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the data's content.
  const specs = useMemo(
    () => diagramScene(data, { font: FONT, layoutOptions: { direction: 'right' } }),
    [key],
  );

  const part = picked ? partOf(picked) : null;
  const stale = part && 'layer' in part && !entriesOf(config).some((e) => e.id === part.layer);
  const overlays =
    part && !stale && part.kind !== 'word' && picked
      ? [
          {
            target: picked,
            placement: { side: 'right' as const, align: 'start' as const },
            offset: 8,
            content: <NodeCard part={part} />,
          },
        ]
      : [];

  return (
    <div className="cl-diagram">
      <DiagramView
        ref={view}
        specs={specs}
        selected={picked}
        onSelect={(id) => setPicked(id && partOf(id) ? id : null)}
        overlays={overlays}
        anchor="start"
      />
    </div>
  );
}
