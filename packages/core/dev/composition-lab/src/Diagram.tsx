import {
  DEFAULT_NODE_STYLE,
  DiagramView,
  type DiagramViewApi,
  diagramScene,
  type NodeStyle,
} from '@weasel-js/diagram';
import { registerCanvasFont } from '@weasel-js/font';
import { Button } from '@weasel-js/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { asEffects, entriesOf, KINDS, type LayerEntry } from './config.js';
import { addLayer, insertable, insertWrapper, reorder } from './edits.js';
import { useLab, useSampled } from './hooks.js';
import { NodeCard } from './NodeCard.js';
import { hasGradient } from './patches.js';
import {
  addAnchor,
  diagramOf,
  layerOfGroup,
  offIds,
  type Part,
  partOf,
  warnedIds,
  warningsOf,
} from './pipeline.js';
import { poolCounts } from './pool.js';

registerCanvasFont('sans-serif');

const FONT = { fontFamily: 'sans-serif', fontSize: 12 } as const;

/** A layer that is switched off: still drawn, dimmed and dashed. */
const OFF: NodeStyle = { fill: '#232a31', stroke: '#56606a', text: '#87939e', dash: [4, 3] };

/** A node a warning is pinned to: the reason the layer does nothing. */
const WARNED: NodeStyle = { ...DEFAULT_NODE_STYLE, stroke: '#e5484d', strokeWidth: 2 };

/** The composition as a wiring diagram, and where its layers and motions are edited. */
export function Diagram() {
  const { config, setConfig, composition } = useLab();
  const { parts } = useSampled();
  const counts = poolCounts(parts);
  const gradient = hasGradient(composition.look);
  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const view = useRef<DiagramViewApi | null>(null);

  const warnings = (entry: LayerEntry) => warningsOf(entry, counts, composition.look, gradient);
  const data = diagramOf(config, warnings);
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
  const off = offIds(config);
  const warned = warnedIds(config, warnings);
  const key = JSON.stringify([data, [...off], [...warned]]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the data's content.
  const specs = useMemo(
    () =>
      diagramScene(data, {
        font: FONT,
        layoutOptions: { direction: 'right' },
        nodeStyle: (n) => (off.has(n.id) ? OFF : warned.has(n.id) ? WARNED : undefined),
      }),
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

  const anchor = addAnchor(config);
  const add = [
    {
      target: anchor.target,
      key: 'add',
      placement: { side: anchor.side, align: 'start' as const },
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
    <div className="cl-diagram" onPointerLeave={() => setHovered(null)}>
      <DiagramView
        ref={view}
        specs={specs}
        selected={picked}
        onSelect={(id) => setPicked(id && partOf(id) ? id : null)}
        pickEdges
        onHover={(id) => {
          if (id !== null) setHovered(endsOf(id) ? id : null);
        }}
        onReorder={({ parent, order }) => {
          if (parent !== 'layers') return;
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
