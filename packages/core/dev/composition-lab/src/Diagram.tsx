import { DiagramView, type DiagramViewApi, diagramScene } from '@weasel-js/diagram';
import { registerCanvasFont } from '@weasel-js/font';
import { Button } from '@weasel-js/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { layerPatch } from './composition.js';
import { asEffects, entriesOf, KINDS, type LayerEntry, toLayer } from './config.js';
import { addLayer, insertable, insertWrapper, reorder } from './edits.js';
import { useLab, useSampled } from './hooks.js';
import { NodeCard } from './NodeCard.js';
import { hasGradient } from './patches.js';
import { diagramOf, GROUP_OF_LAYER, layerOfGroup, type Part, partOf } from './pipeline.js';
import { poolCounts } from './pool.js';

registerCanvasFont('sans-serif');

const FONT = { fontFamily: 'sans-serif', fontSize: 12 } as const;

/** The composition as a wiring diagram, and where its layers and motions are edited. */
export function Diagram() {
  const { config, setConfig, composition } = useLab();
  const { parts } = useSampled();
  const counts = poolCounts(parts);
  const gradient = hasGradient(composition.look);
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
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

  const entries = entriesOf(config);
  const write = (next: LayerEntry[]) => setConfig('effects', asEffects(next));

  const part = picked ? partOf(picked) : null;
  const stale = part && 'layer' in part && !entries.some((e) => e.id === part.layer);
  const card =
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

  // Sticky: `onHover` reports null once the pointer reaches the + itself.
  const between = hovered ? endsOf(hovered) : null;
  const entry = between && entries.find((e) => e.id === between.layer);
  const offered = entry && between ? insertable(entry, between.from, between.to) : [];
  const plus =
    hovered && entry && offered.length > 0
      ? [
          {
            target: hovered,
            key: 'insert',
            content: (
              <div className="cl-plus">
                {offered.map((w) => (
                  <Button
                    key={w}
                    size="sm"
                    onClick={() => {
                      write(insertWrapper(entries, entry.id, w));
                      setHovered(null);
                    }}
                  >
                    + {w}
                  </Button>
                ))}
              </div>
            ),
          },
        ]
      : [];

  const last = entries.at(-1);
  const add = [
    {
      target: last ? `${GROUP_OF_LAYER}${last.id}` : 'motion:enter',
      key: 'add',
      placement: { side: last ? ('bottom' as const) : ('top' as const), align: 'start' as const },
      offset: 8,
      content: (
        <div className="cl-plus">
          {KINDS.map((kind) => (
            <Button key={kind} size="sm" onClick={() => write(addLayer(entries, kind))}>
              + {kind}
            </Button>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="cl-diagram">
      <DiagramView
        ref={view}
        specs={specs}
        selected={picked}
        onSelect={(id) => setPicked(id && partOf(id) ? id : null)}
        pickEdges
        onHover={(id) => {
          if (id !== null) setHovered(endsOf(id) ? id : null);
        }}
        onReorder={({ group, order }) => {
          if (group !== 'layers') return;
          write(
            reorder(
              entries,
              order.flatMap((g) => layerOfGroup(g) ?? []),
            ),
          );
        }}
        overlays={[...plus, ...add, ...card]}
        anchor="start"
      />
    </div>
  );
}

/** The two nodes of a layer's row an edge joins, or null for any other edge. */
function endsOf(edgeId: string): { layer: string; from: Part; to: Part } | null {
  const [a, b] = edgeId.split('→');
  const from = a ? partOf(a) : null;
  const to = b ? partOf(b) : null;
  if (!from || !to || !('layer' in from) || !('layer' in to) || from.layer !== to.layer)
    return null;
  return { layer: from.layer, from, to };
}

/** Why a layer will do nothing, which the patch itself never says. */
function warningsOf(
  entry: LayerEntry,
  counts: Record<string, number>,
  look: string,
  gradient: boolean,
) {
  const out: string[] = [];
  const target = entry.target as string;
  if (counts[target] === 0) out.push(`this pool has no ${target} parts, so the layer does nothing`);
  if (entry.kind === 'chase' && !gradient) {
    out.push(`the ${look} look declares no gradient, so the layer does nothing`);
  }
  const bouts = entry.intermittent as { on?: boolean } | undefined;
  if (bouts?.on && entry.kind !== 'draft' && layerPatch(toLayer(entry)) === null) {
    out.push(`bout spell is shorter than one pass of ${entry.kind}, so the layer does not build`);
  }
  return out;
}
