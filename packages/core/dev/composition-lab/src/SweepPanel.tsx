import type { Host, PartInfo } from '@core/effects/types.js';
import { Button, NumberField, Select } from '@weasel-js/ui';
import { useState } from 'react';
import type { Composition } from './composition.js';
import { PARAMS } from './patches.js';
import { runSweep, type SweepResult } from './sweep.js';

export interface SweepPanelProps {
  composition: Composition;
  parts: readonly PartInfo[];
  host: Host;
}

const COLUMNS = [
  ['darkShare', 'dark share'],
  ['longestLitMs', 'lit ms'],
  ['coverage', 'cover'],
  ['meanTenureMs', 'tenure'],
  ['meanJumpParts', 'jump'],
  ['meanLight', 'light'],
] as const;

/** On demand rather than live: a run rebuilds the frame once per step, which a slider drag would
 * do on every pointermove. */
export function Sweep({ composition, parts, host }: SweepPanelProps) {
  // Enabled only: `toFireOptions` drops the rest, so a sweep of a disabled layer would tabulate
  // six unmoved columns as a finding about the param.
  const layers = composition.effects.filter((l) => l.enabled && l.kind !== 'draft');
  const [layerId, setLayerId] = useState('');
  const [param, setParam] = useState('');
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(1);
  const [steps, setSteps] = useState(5);
  const [result, setResult] = useState<SweepResult | null>(null);

  const layer = layers.find((l) => l.id === layerId) ?? layers[0];
  const params = layer && layer.kind !== 'draft' ? PARAMS[layer.kind] : [];
  // The selection falls back when a layer is deleted, so a held param name can belong to the
  // previous kind — sweeping it would write a key the new patch never reads.
  const active = params.some((p) => p.key === param) ? param : '';
  const rows = result?.rows.map((row, i) => ({ key: `${i}:${row.value}`, row })) ?? [];

  return (
    <div className="cl-section">
      <div className="cl-row">
        <Select
          aria-label="layer"
          selectedKey={layer?.id ?? null}
          onSelectionChange={setLayerId}
          options={layers.map((l) => ({ value: l.id, label: l.kind }))}
        />
        <Select
          aria-label="param"
          placeholder="param…"
          selectedKey={active || null}
          onSelectionChange={setParam}
          options={params.map((p) => ({ value: p.key, label: p.key }))}
        />
      </div>
      <div className="cl-row">
        <NumberField label="min" orientation="row" hideSteppers value={min} onChange={setMin} />
        <NumberField label="max" orientation="row" hideSteppers value={max} onChange={setMax} />
        <NumberField
          label="steps"
          orientation="row"
          hideSteppers
          minValue={1}
          step={1}
          value={steps}
          onChange={setSteps}
        />
      </div>
      <div className="cl-row">
        <Button
          size="sm"
          disabled={!layer || !active}
          onClick={() =>
            layer &&
            setResult(runSweep(composition, layer.id, active, min, max, steps, parts, host))
          }
        >
          run
        </Button>
      </div>
      {result ? (
        <div className="cl-scroll">
          <table className="cl-table">
            <thead>
              <tr>
                <th>{result.param}</th>
                {COLUMNS.map(([key, label]) => (
                  <th key={key} className={result.flat.includes(key) ? 'cl-flat' : undefined}>
                    {label}
                    {result.flat.includes(key) ? ' ·' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, row }) => (
                <tr key={key}>
                  <td>{row.value.toFixed(3)}</td>
                  {COLUMNS.map(([column]) => (
                    <td key={column}>{row[column].toFixed(3)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {result && result.flat.length > 0 ? (
        <p className="cl-note">
          · marks a column this sweep never moved — which is a finding about the param, not a
          missing measurement
        </p>
      ) : null}
    </div>
  );
}
