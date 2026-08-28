import {
  CORNER_REPAIRS,
  type CutRepairId,
  DECISION_REPAIRS,
  type RepairEntry,
  SPAN_REPAIRS,
} from '@core/render/tube/repairs.js';
import { TUBE_STAGES, type TubeStageId } from '@core/render/tube/stages.js';

export interface StageNode {
  kind: 'stage';
  id: TubeStageId;
  label: string;
}

export interface RepairNode {
  kind: 'repair';
  id: CutRepairId;
  label: string;
  /** The stage this hangs off, and the level it runs at within it. */
  stage: TubeStageId;
  level: RepairEntry['level'];
}

export type PipelineNode = StageNode | RepairNode;

/** `from` feeds `to`; a repair's edge points at the stage it runs inside. */
export interface PipelineEdge {
  from: string;
  to: string;
}

const keyOf = (node: PipelineNode) =>
  node.kind === 'stage' ? `stage:${node.id}` : `repair:${node.level}:${node.id}`;

export const STAGE_NODES: StageNode[] = TUBE_STAGES.map((s) => ({
  kind: 'stage',
  id: s.id,
  label: s.label,
}));

export const REPAIR_NODES: RepairNode[] = [
  ...DECISION_REPAIRS,
  ...CORNER_REPAIRS,
  ...SPAN_REPAIRS,
].map((r) => ({ kind: 'repair', id: r.id, label: r.label, stage: r.stage, level: r.level }));

export const PIPELINE_NODES: PipelineNode[] = [...STAGE_NODES, ...REPAIR_NODES];

export const PIPELINE_EDGES: PipelineEdge[] = [
  ...STAGE_NODES.slice(1).map((node, i) => ({
    from: keyOf(STAGE_NODES[i] as StageNode),
    to: keyOf(node),
  })),
  ...REPAIR_NODES.map((node) => ({ from: keyOf(node), to: `stage:${node.stage}` })),
];

export const NODE_KEY = keyOf;

/**
 * The repair toggles, grouped the way they run. `stretch` appears twice under two levels and two
 * labels but is one `CutRepairId`: the gate cannot separate them, and a panel that pretended
 * otherwise would show two switches wired to one wire.
 */
export const TOGGLE_GROUPS: { level: RepairEntry['level']; label: string; ids: CutRepairId[] }[] = [
  { level: 'decision', label: 'strategy', ids: [...new Set(DECISION_REPAIRS.map((r) => r.id))] },
  {
    level: 'corner',
    label: 'inside the corner',
    ids: [...new Set(CORNER_REPAIRS.map((r) => r.id))],
  },
  { level: 'span', label: 'across spans', ids: [...new Set(SPAN_REPAIRS.map((r) => r.id))] },
];
