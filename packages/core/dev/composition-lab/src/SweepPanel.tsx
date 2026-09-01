import type { FrameCtx, PartInfo } from '@core/effects/types.js';
import { useState } from 'react';
import type { Composition } from './composition.js';
import { PARAMS } from './pieces.js';
import { PASS_SAMPLES, runSweep, type SweepResult } from './sweep.js';

export interface SweepPanelProps {
  composition: Composition;
  parts: readonly PartInfo[];
  ctx: FrameCtx;
}

const COLUMNS = [
  ['darkShare', 'dark'],
  ['longestLitMs', 'lit ms'],
  ['coverage', 'cover'],
  ['meanTenureMs', 'tenure'],
  ['meanJumpParts', 'jump'],
  ['meanLight', 'light'],
] as const;

/** On demand rather than live: a run rebuilds the frame once per step, which a slider drag would
 * do on every pointermove. */
export function Sweep({ composition, parts, ctx }: SweepPanelProps) {
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
  // previous kind — sweeping it would write a key the new piece never reads.
  const active = params.some((p) => p.key === param) ? param : '';
  const rows = result?.rows.map((row, i) => ({ key: `${i}:${row.value}`, row })) ?? [];

  return (
    <div className="cl-panel">
      <h2>param sweep</h2>
      <div className="cl-row">
        <select value={layer?.id ?? ''} onChange={(e) => setLayerId(e.target.value)}>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.kind}
            </option>
          ))}
        </select>
        <select value={active} onChange={(e) => setParam(e.target.value)}>
          <option value="">param…</option>
          {params.map((p) => (
            <option key={p.key} value={p.key}>
              {p.key}
            </option>
          ))}
        </select>
      </div>
      <div className="cl-row">
        <span>min</span>
        <input type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} />
        <span>max</span>
        <input type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} />
        <span>steps</span>
        <input type="number" value={steps} onChange={(e) => setSteps(Number(e.target.value))} />
      </div>
      <div className="cl-row">
        <button
          type="button"
          disabled={!layer || !active}
          onClick={() =>
            layer &&
            setResult(
              runSweep(composition, layer.id, active, min, max, steps, parts, PASS_SAMPLES, ctx),
            )
          }
        >
          run
        </button>
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
