import type { DataCluster, DataEdge, DataNode, DiagramData, Row } from '@weasel-js/diagram';
import { layerPatch } from './composition.js';
import { entriesOf, type LabConfig, type LayerEntry, toLayer } from './config.js';
import { PARAMS } from './patches.js';

export type Wrapper = 'roving' | 'intermittent';
export type Stage = 'enter' | 'active' | 'exit';

/** What a node of the diagram stands for. */
export type Part =
  | { kind: 'patch'; layer: string }
  | { kind: 'wrapper'; layer: string; wrapper: Wrapper }
  | { kind: 'pool'; layer: string }
  | { kind: 'word' }
  | { kind: 'motion'; stage: Stage };

/** Inner to outer, the order `emit` nests them in. */
export const WRAPPERS: readonly Wrapper[] = ['roving', 'intermittent'];
export const STAGES: readonly Stage[] = ['enter', 'active', 'exit'];

/** The prefix of a layer row's group id. */
export const GROUP_OF_LAYER = 'layer:';
const GROUP = GROUP_OF_LAYER;

export function idOf(part: Part): string {
  switch (part.kind) {
    case 'patch':
    case 'pool':
      return `${part.kind}:${part.layer}`;
    case 'wrapper':
      return `${part.wrapper}:${part.layer}`;
    case 'word':
      return 'word';
    case 'motion':
      return `motion:${part.stage}`;
  }
}

export function partOf(id: string): Part | null {
  if (id === 'word') return { kind: 'word' };
  const at = id.indexOf(':');
  if (at < 0) return null;
  const head = id.slice(0, at);
  const rest = id.slice(at + 1);
  if (head === 'patch' || head === 'pool') return { kind: head, layer: rest };
  if ((WRAPPERS as readonly string[]).includes(head)) {
    return { kind: 'wrapper', layer: rest, wrapper: head as Wrapper };
  }
  if (head === 'motion' && (STAGES as readonly string[]).includes(rest)) {
    return { kind: 'motion', stage: rest as Stage };
  }
  return null;
}

/** The layer a row's group stands for, as `onReorder` reports the rows. */
export function layerOfGroup(groupId: string): string | null {
  return groupId.startsWith(GROUP) ? groupId.slice(GROUP.length) : null;
}

/** The wrappers a layer has switched on, inner to outer. Lamp takes no roving. */
export function wrappersOf(entry: LayerEntry): Wrapper[] {
  return WRAPPERS.filter((w) => {
    if (w === 'roving' && entry.kind === 'lamp') return false;
    return (entry[w] as { on?: boolean } | undefined)?.on === true;
  });
}

const POOLS: Record<string, string> = { run: 'runs', body: 'bodies', chunk: 'chunks' };

function patchLines(entry: LayerEntry): string[] {
  const lines: string[] = [entry.kind];
  if (entry.kind !== 'draft') {
    if (entry.kind === 'lamp') lines.push(`source ${entry.lampSource}`);
    lines.push(...PARAMS[entry.kind].map((p) => `${p.key} ${entry[p.key]}`));
  }
  if (!entry.enabled) lines.push('off');
  return lines;
}

function wrapperLines(entry: LayerEntry, wrapper: Wrapper): string[] {
  const w = entry[wrapper] as Record<string, number> & { spell: number; calm: number };
  if (wrapper === 'roving') return [wrapper, `dwell ${w.dwell} · ${w.epochs} epochs`];
  return [wrapper, `${w.spell / 1000}s on · ${w.calm / 1000}s calm · ${w.bouts} bouts`];
}

function poolLines(entry: LayerEntry): string[] {
  const amount = entry.amount as number;
  const share = amount >= 1 ? 'all' : `${Math.round(amount * 100)}%`;
  return [`${POOLS[entry.target as string] ?? entry.target} · ${share}`];
}

/** Why a layer will do nothing, which the patch itself never says, pinned to the node at fault. */
export interface Warning {
  at: 'patch' | 'pool' | Wrapper;
  text: string;
}

export function warningsOf(
  entry: LayerEntry,
  counts: Record<string, number>,
  look: string,
  gradient: boolean,
): Warning[] {
  const out: Warning[] = [];
  const target = entry.target as string;
  if (counts[target] === 0) out.push({ at: 'pool', text: `no ${target} parts` });
  if (entry.kind === 'chase' && !gradient) {
    out.push({ at: 'patch', text: `${look} has no gradient` });
  }
  const bouts = entry.intermittent as { on?: boolean } | undefined;
  if (bouts?.on && entry.kind !== 'draft' && layerPatch(toLayer(entry)) === null) {
    out.push({ at: 'intermittent', text: 'spell under one pass' });
  }
  return out;
}

const atOf = (id: string): Warning['at'] | null => {
  const part = partOf(id);
  if (part?.kind === 'patch' || part?.kind === 'pool') return part.kind;
  return part?.kind === 'wrapper' ? part.wrapper : null;
};

/** A node's readout, with the warnings about it after, in bold. */
function withWarnings(id: string, lines: string[], warnings: Warning[]): DataNode {
  const mine = warnings.filter((w) => w.at === atOf(id));
  if (mine.length === 0) return { id, lines };
  const rows: Row[] = [
    ...lines.map((text): Row => ({ kind: 'label', text })),
    ...mine.map((w): Row => ({ kind: 'label', text: w.text, style: { bold: true } })),
  ];
  return { id, rows };
}

/** Every node a warning is pinned to, to outline. */
export function warnedIds(
  config: LabConfig,
  warnings: (entry: LayerEntry) => Warning[],
): Set<string> {
  const ids = new Set<string>();
  for (const entry of entriesOf(config)) {
    for (const w of warnings(entry)) {
      const part: Part =
        w.at === 'patch' || w.at === 'pool'
          ? { kind: w.at, layer: entry.id }
          : { kind: 'wrapper', layer: entry.id, wrapper: w.at };
      ids.add(idOf(part));
    }
  }
  return ids;
}

/** The composition as a left-to-right wiring diagram: a row per layer into the word, and the word's motions. */
export function diagramOf(
  config: LabConfig,
  warnings: (entry: LayerEntry) => Warning[],
): DiagramData {
  const nodes: DataNode[] = [{ id: 'word', lines: [config.text, config.look] }];
  const edges: DataEdge[] = [];
  const clusters: DataCluster[] = [];
  const join = (from: string, to: string) => edges.push({ id: `${from}→${to}`, from, to });

  for (const entry of entriesOf(config)) {
    const layer = entry.id;
    const said = warnings(entry);
    const row = [
      withWarnings(idOf({ kind: 'patch', layer }), patchLines(entry), said),
      ...wrappersOf(entry).map((wrapper) =>
        withWarnings(idOf({ kind: 'wrapper', layer, wrapper }), wrapperLines(entry, wrapper), said),
      ),
      withWarnings(idOf({ kind: 'pool', layer }), poolLines(entry), said),
    ];
    nodes.push(...row);
    const ids = row.map((n) => n.id);
    let from = ids[0] as string;
    for (const to of [...ids.slice(1), 'word']) {
      join(from, to);
      from = to;
    }
    clusters.push({ id: `${GROUP}${layer}`, members: ids });
  }
  clusters.push({ id: 'layers', members: clusters.map((g) => g.id), reorder: 'y' });

  for (const stage of STAGES)
    nodes.push({ id: idOf({ kind: 'motion', stage }), lines: [stage, config[stage]] });
  join('motion:enter', 'motion:active');
  join('motion:active', 'motion:exit');
  join('motion:exit', 'word');

  return { nodes, edges, clusters };
}

/** Every node of a layer that is switched off, to draw dimmed. */
export function offIds(config: LabConfig): Set<string> {
  const ids = new Set<string>();
  for (const entry of entriesOf(config)) {
    if (entry.enabled) continue;
    const layer = entry.id;
    ids.add(idOf({ kind: 'patch', layer }));
    for (const wrapper of wrappersOf(entry)) ids.add(idOf({ kind: 'wrapper', layer, wrapper }));
    ids.add(idOf({ kind: 'pool', layer }));
  }
  return ids;
}

/** Where the + that adds a layer stands: under the last layer's row, or above the motions. */
export function addAnchor(config: LabConfig): { target: string; side: 'bottom' | 'top' } {
  const last = entriesOf(config).at(-1);
  return last
    ? { target: `${GROUP_OF_LAYER}${last.id}`, side: 'bottom' }
    : { target: idOf({ kind: 'motion', stage: 'enter' }), side: 'top' };
}
