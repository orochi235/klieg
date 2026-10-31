import type { PathSource } from '@core/render/tube/generators.js';
import { DEFAULT_HAIRPIN, HAIRPIN_SHAPES, type HairpinShape } from '@core/render/tube/index.js';
import { CUT_REPAIR_IDS, type CutRepairId } from '@core/render/tube/repairs.js';
import { DEFAULT_REJOIN, REJOINS } from '@core/render/tube/runs.js';
import { TUBE_STAGES, type TubeStageId } from '@core/render/tube/stages.js';
import { type ConfigOf, f } from '@weasel-js/labkit';
import { TOGGLE_GROUPS } from './pipeline.js';
import { TUBE_LOOKS, type TubeLook } from './spec.js';

type Switch = ReturnType<typeof f.boolean>;

/**
 * One switch per repair id, in registry order. `stretch` is in two groups under two labels but is
 * one `CutRepairId`, and `repairs` is a set of ids — two switches would be wired to one wire.
 */
function repairSwitches(): Record<CutRepairId, Switch> {
  const out: Partial<Record<CutRepairId, Switch>> = {};
  for (const group of TOGGLE_GROUPS) {
    for (const id of group.ids) out[id] ??= f.boolean(true).label(`${group.label} · ${id}`);
  }
  return out as Record<CutRepairId, Switch>;
}

const stageSwitches = Object.fromEntries(
  TUBE_STAGES.map((stage) => [stage.id, f.boolean(true).label(stage.label)]),
) as Record<TubeStageId, Switch>;

export const config = f.schema({
  letter: f.string('B').maxLength(1).label('letter'),
  look: f.enum<TubeLook>('piping', TUBE_LOOKS).label('look'),
  source: f.enum<PathSource>('direct', ['direct', 'exact', 'field']).label('path source'),
  corner: f.number(1).range(1, 24).step(1).label('corner'),
  rejoin: f.enum(DEFAULT_REJOIN, REJOINS).label('rejoin'),
  stages: f.group(stageSwitches).label('run'),
  drawAt: f
    .enum<TubeStageId>(
      'sweep',
      TUBE_STAGES.map((s) => ({ value: s.id, label: s.label })),
    )
    .label('draw at'),
  repairs: f.group(repairSwitches()).label('repairs'),
  // Neither shipped look weights a hairpin, so without this the `hairpin` repair toggle beside
  // it is a switch with nothing on the other end.
  hairpin: f.number(0).range(0, 1).step(0.05).label('hairpin weight'),
  hairpinShape: f.enum<HairpinShape>(DEFAULT_HAIRPIN, HAIRPIN_SHAPES).label('hairpin shape'),
  subject: f
    .enum<'corner' | 'letter'>('corner', [
      { value: 'corner', label: 'one corner' },
      { value: 'letter', label: 'whole letter' },
    ])
    .label('subject'),
});

export type Config = ConfigOf<typeof config>;

export function requestOf(config: Config) {
  return {
    letter: config.letter.slice(0, 1) || 'B',
    look: config.look,
    source: config.source,
    corner: Math.max(0, Math.round(config.corner) - 1),
    rejoin: config.rejoin,
    stages: new Set(TUBE_STAGES.map((s) => s.id).filter((id) => config.stages[id] !== false)),
    drawAt: config.drawAt,
    repairs: new Set(CUT_REPAIR_IDS.filter((id) => config.repairs[id] !== false)),
    hairpin: Math.max(0, Math.min(1, config.hairpin)),
    hairpinShape: config.hairpinShape,
    subject: config.subject,
  };
}
