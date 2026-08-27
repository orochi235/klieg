import type { PartKind } from '@core/effects/types.js';
import { LOOK_NAMES } from '@core/index.js';
import type { LookName } from '@core/render/looks.js';
import type { Composition, EffectLayer, RovingWrap } from './composition.js';
import { defaultParams, PARAMS, type PieceKind } from './pieces.js';

export interface RailProps {
  composition: Composition;
  onChange: (next: Composition) => void;
  counts: Record<PartKind, number>;
}

const KINDS: PieceKind[] = ['flicker', 'hue', 'chase'];

export function Rail({ composition, onChange, counts }: RailProps) {
  const setLayer = (id: string, patch: Partial<EffectLayer>) =>
    onChange({
      ...composition,
      effects: composition.effects.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });

  const setRoving = (layer: EffectLayer, patch: Partial<RovingWrap>) =>
    setLayer(layer.id, { roving: { ...(layer.roving as RovingWrap), ...patch } });

  const add = (kind: PieceKind) =>
    onChange({
      ...composition,
      effects: [
        ...composition.effects,
        {
          id: `${kind}-${composition.effects.length}-${Math.round(performance.now())}`,
          kind,
          enabled: true,
          params: defaultParams(kind),
          target: 'run',
          amount: 1,
          seed: 0,
        },
      ],
    });

  return (
    <>
      <h2>word</h2>
      <label className="cl-row">
        <span>text</span>
        <input
          value={composition.text}
          onChange={(e) => onChange({ ...composition, text: e.target.value })}
        />
      </label>
      <label className="cl-row">
        <span>look</span>
        <select
          value={composition.look}
          onChange={(e) => onChange({ ...composition, look: e.target.value as LookName })}
        >
          {LOOK_NAMES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="cl-row">
        <span>hold</span>
        <input
          type="range"
          min={1000}
          max={30000}
          step={500}
          value={composition.hold}
          onChange={(e) => onChange({ ...composition, hold: Number(e.target.value) })}
        />
        <output>{composition.hold}</output>
      </label>

      <h2>pool</h2>
      <p className="cl-note">
        run {counts.run}, body {counts.body}
      </p>

      <h2>layers</h2>
      {composition.effects.map((layer) => (
        <div className="cl-layer" key={layer.id}>
          <div className="cl-row">
            <input
              type="checkbox"
              checked={layer.enabled}
              onChange={(e) => setLayer(layer.id, { enabled: e.target.checked })}
            />
            <strong>{layer.kind}</strong>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...composition,
                  effects: composition.effects.filter((l) => l.id !== layer.id),
                })
              }
            >
              &times;
            </button>
          </div>

          <label
            className="cl-row"
            title="Which pool this layer draws from. A kind the look does not build is an empty pool, and the layer silently does nothing."
          >
            <span>target</span>
            <select
              value={layer.target}
              onChange={(e) => setLayer(layer.id, { target: e.target.value as PartKind })}
            >
              <option value="run">run</option>
              <option value="body">body</option>
            </select>
          </label>
          {counts[layer.target] === 0 ? (
            <p className="cl-warn">
              this pool has no {layer.target} parts — the layer does nothing
            </p>
          ) : null}

          <label
            className="cl-row"
            title="Share of the pool this layer drives. roving wants 1: it picks its holder from the whole pool, so against a subset the fault lands where nothing is driven."
          >
            <span>amount</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layer.amount}
              onChange={(e) => setLayer(layer.id, { amount: Number(e.target.value) })}
            />
            <output>{layer.amount.toFixed(2)}</output>
          </label>

          {layer.kind === 'draft'
            ? null
            : PARAMS[layer.kind].map((p) => (
                <label className="cl-row" key={p.key} title={p.hint}>
                  <span>{p.key}</span>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={layer.params[p.key] ?? p.value}
                    onChange={(e) =>
                      setLayer(layer.id, {
                        params: { ...layer.params, [p.key]: Number(e.target.value) },
                      })
                    }
                  />
                  <output>{layer.params[p.key] ?? p.value}</output>
                </label>
              ))}

          <label
            className="cl-row"
            title="Moves this layer's affliction from part to part. Its pass is many inner passes long, so a short hold may never reach a second handover."
          >
            <input
              type="checkbox"
              checked={layer.roving !== undefined}
              onChange={(e) =>
                setLayer(layer.id, {
                  roving: e.target.checked ? { dwell: 3200, seed: 0, epochs: 96 } : undefined,
                })
              }
            />
            <span>roving</span>
          </label>
          {layer.roving ? (
            <>
              <label
                className="cl-row"
                title="Roughly how long one part keeps the fault. This picks WHO flickers, never how much — that is unrest."
              >
                <span>dwell</span>
                <input
                  type="range"
                  min={400}
                  max={9000}
                  step={100}
                  value={layer.roving.dwell}
                  onChange={(e) => setRoving(layer, { dwell: Number(e.target.value) })}
                />
                <output>{layer.roving.dwell}</output>
              </label>
              <label
                className="cl-row"
                title="Handovers to a pass, and so the ceiling on how many parts a pass can reach before it loops. Below the pool size, some parts never take the fault at all."
              >
                <span>epochs</span>
                <input
                  type="range"
                  min={4}
                  max={192}
                  step={4}
                  value={layer.roving.epochs}
                  onChange={(e) => setRoving(layer, { epochs: Number(e.target.value) })}
                />
                <output>{layer.roving.epochs}</output>
              </label>
            </>
          ) : null}
        </div>
      ))}

      <div className="cl-row">
        {KINDS.map((k) => (
          <button type="button" key={k} onClick={() => add(k)}>
            + {k}
          </button>
        ))}
      </div>
    </>
  );
}
