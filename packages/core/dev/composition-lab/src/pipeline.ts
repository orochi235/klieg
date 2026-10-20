import type { DataEdge, DataGroup, DataNode, DiagramData } from '@weasel-js/diagram';
import { entriesOf, type LabConfig, type LayerEntry } from './config.js';
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

const GROUP = 'layer:';

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

function poolLines(entry: LayerEntry, warnings: string[]): string[] {
  const amount = entry.amount as number;
  const share = amount >= 1 ? 'all' : `${Math.round(amount * 100)}%`;
  return [`${POOLS[entry.target as string] ?? entry.target} · ${share}`, ...warnings];
}

/** The composition as a left-to-right wiring diagram: a row per layer into the word, and the word's motions. */
export function diagramOf(
  config: LabConfig,
  warnings: (entry: LayerEntry) => string[],
): DiagramData {
  const nodes: DataNode[] = [{ id: 'word', lines: [config.text, config.look] }];
  const edges: DataEdge[] = [];
  const groups: DataGroup[] = [];
  const join = (from: string, to: string) => edges.push({ id: `${from}→${to}`, from, to });

  for (const entry of entriesOf(config)) {
    const layer = entry.id;
    const row = [
      { id: idOf({ kind: 'patch', layer }), lines: patchLines(entry) },
      ...wrappersOf(entry).map((wrapper) => ({
        id: idOf({ kind: 'wrapper', layer, wrapper }),
        lines: wrapperLines(entry, wrapper),
      })),
      { id: idOf({ kind: 'pool', layer }), lines: poolLines(entry, warnings(entry)) },
    ];
    nodes.push(...row);
    const ids = row.map((n) => n.id);
    let from = ids[0] as string;
    for (const to of [...ids.slice(1), 'word']) {
      join(from, to);
      from = to;
    }
    groups.push({ id: `${GROUP}${layer}`, members: ids });
  }
  groups.push({ id: 'layers', members: groups.map((g) => g.id), reorder: 'y' });

  for (const stage of STAGES)
    nodes.push({ id: idOf({ kind: 'motion', stage }), lines: [stage, config[stage]] });
  join('motion:enter', 'motion:active');
  join('motion:active', 'motion:exit');
  join('motion:exit', 'word');

  return { nodes, edges, groups };
}
