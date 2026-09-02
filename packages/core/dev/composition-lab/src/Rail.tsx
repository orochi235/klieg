import type { PartKind } from '@core/effects/types.js';
import { LOOK_NAMES } from '@core/index.js';
import type { LookName } from '@core/render/looks.js';
import {
  type Composition,
  type EffectLayer,
  type IntermittentWrap,
  layerPiece,
  type PoolSource,
  type RovingWrap,
} from './composition.js';
import { emit } from './emit.js';
import {
  defaultParams,
  hasGradient,
  type LampSourceKind,
  PARAMS,
  type PieceKind,
} from './pieces.js';

/** Whether the real pool the rail asked for is what the panels are actually drawing. */
export type RealPoolStatus = 'ready' | 'loading' | 'failed';

export interface RailProps {
  composition: Composition;
  onChange: (next: Composition) => void;
  counts: Record<PartKind, number>;
  realPoolStatus: RealPoolStatus;
}

const KINDS: PieceKind[] = ['flicker', 'hue', 'chase', 'lamp', 'draft'];

/** What a new draft opens on: a piece that builds, so the pane starts from working code. */
const DRAFT_SOURCE = `return {
  duration: 1400,
  at: (t, part) => ({
    gain: 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * (t + part.at))),
  }),
};`;

const layerBuilds = (layer: EffectLayer): boolean => layerPiece(layer) !== null;

export function Rail({ composition, onChange, counts, realPoolStatus }: RailProps) {
  const gradient = hasGradient(composition.look);

  const setLayer = (id: string, patch: Partial<EffectLayer>) =>
    onChange({
      ...composition,
      effects: composition.effects.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });

  const setRoving = (layer: EffectLayer, patch: Partial<RovingWrap>) =>
    setLayer(layer.id, { roving: { ...(layer.roving as RovingWrap), ...patch } });

  const setBouts = (layer: EffectLayer, patch: Partial<IntermittentWrap>) =>
    setLayer(layer.id, { intermittent: { ...(layer.intermittent as IntermittentWrap), ...patch } });

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
          ...(kind === 'lamp' ? { lampSource: 'fixed' as LampSourceKind } : {}),
          ...(kind === 'draft' ? { source: DRAFT_SOURCE } : {}),
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
      <label
        className="cl-row"
        title="Which pool the panels below describe. Real follows the text and look above; synthetic is a fixed 24-run, 7-letter stand-in for exercising a kind this look does not build."
      >
        <span>source</span>
        <select
          value={composition.pool}
          onChange={(e) => onChange({ ...composition, pool: e.target.value as PoolSource })}
        >
          <option value="real">real</option>
          <option value="synthetic">synthetic</option>
        </select>
      </label>
      {composition.pool === 'real' && realPoolStatus !== 'ready' ? (
        <p className="cl-warn">
          {realPoolStatus === 'loading'
            ? 'font still loading — panels are drawing the synthetic pool for now'
            : 'font failed to load — panels are drawing the synthetic pool'}
        </p>
      ) : null}
      <p className="cl-note">
        run {counts.run}, body {counts.body}, chunk {counts.chunk}
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
              <option value="chunk">chunk</option>
            </select>
          </label>
          {counts[layer.target] === 0 ? (
            <p className="cl-warn">
              this pool has no {layer.target} parts — the layer does nothing
            </p>
          ) : null}
          {layer.kind === 'chase' && !gradient ? (
            <p className="cl-warn">
              the {composition.look} look declares no gradient — the layer does nothing
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

          {layer.kind === 'lamp' ? (
            <label
              className="cl-row"
              title="fixed parks the lamp at x,y. orbit walks a circle of radius sweep around it, on the layer's own duration."
            >
              <span>source</span>
              <select
                value={layer.lampSource ?? 'fixed'}
                onChange={(e) =>
                  setLayer(layer.id, { lampSource: e.target.value as LampSourceKind })
                }
              >
                <option value="fixed">fixed</option>
                <option value="orbit">orbit</option>
              </select>
            </label>
          ) : null}

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

          {layer.kind === 'lamp' ? (
            <p className="cl-note">
              roving substitutes a part index and leaves x/y alone, so it cannot carry a lamp
            </p>
          ) : (
            <>
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
            </>
          )}

          <label
            className="cl-row"
            title="Runs the layer in bouts and swallows it between them. The inner keeps running against the clock, so a bout opens wherever it happens to be."
          >
            <input
              type="checkbox"
              checked={layer.intermittent !== undefined}
              onChange={(e) =>
                setLayer(layer.id, {
                  intermittent: e.target.checked
                    ? { spell: 4200, calm: 2000, bouts: 3 }
                    : undefined,
                })
              }
            />
            <span>intermittent</span>
          </label>
          {layer.intermittent ? (
            <>
              <label
                className="cl-row"
                title="Milliseconds of one bout. Shorter than one inner pass and the layer will not build at all — the piece throws rather than showing a sliver."
              >
                <span>bout spell</span>
                <input
                  type="range"
                  min={200}
                  max={20000}
                  step={100}
                  value={layer.intermittent.spell}
                  onChange={(e) => setBouts(layer, { spell: Number(e.target.value) })}
                />
                <output>{layer.intermittent.spell}</output>
              </label>
              <label
                className="cl-row"
                title="Milliseconds held quiet between bouts. At 0 the wrapper is a pass-through, so the layer just runs continuously until this is above zero."
              >
                <span>bout calm</span>
                <input
                  type="range"
                  min={0}
                  max={30000}
                  step={100}
                  value={layer.intermittent.calm}
                  onChange={(e) => setBouts(layer, { calm: Number(e.target.value) })}
                />
                <output>{layer.intermittent.calm}</output>
              </label>
              <label
                className="cl-row"
                title="Bouts to a pass, and so how long the wrapper's own loop runs before it repeats. The pass rounds to a whole number of inner passes, so the count it actually produces can drift from this value."
              >
                <span>bouts</span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={layer.intermittent.bouts}
                  onChange={(e) => setBouts(layer, { bouts: Number(e.target.value) })}
                />
                <output>{layer.intermittent.bouts}</output>
              </label>
              {layerBuilds(layer) ? null : (
                <p className="cl-warn">
                  bout spell is shorter than one pass of {layer.kind} — the layer does not build
                </p>
              )}
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

      <h2>emit</h2>
      <button type="button" onClick={() => void navigator.clipboard.writeText(emit(composition))}>
        copy fire() call
      </button>
      <pre className="cl-emit">{emit(composition)}</pre>
    </>
  );
}
