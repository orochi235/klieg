import { Slider } from '@weasel-js/ui/components/Slider';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import type {
  CornerWeights,
  GradientSpec,
  PathSource,
  SurfaceKind,
  TubeSpec,
} from '../../../src/render/tube/index.js';
import { lettersOf, MODES, type PanelMode } from './panels.js';
import { TUBE_LOOKS, type TubeLook } from './spec.js';

/** The spec fields a slider drives. Every one of them is a number in `TubeSpec`. */
type NumberKey =
  | 'radius'
  | 'bend'
  | 'segments'
  | 'spacing'
  | 'level'
  | 'blockout'
  | 'runs'
  | 'minRun'
  | 'amplitude'
  | 'wallDepth'
  | 'wallRise';

/** Sliders are integers; `scale` is what divides one back into the spec's own units. */
interface NumberField {
  key: NumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  scale: number;
  /** What the builder uses when the spec omits the field, which is what the slider must read. */
  unset?: number;
  /** Values the drag catches on, in the slider's own integer units. */
  stops?: number[];
  /** Shown on hover. What the field does, and what it interacts with badly. */
  hint?: string;
}

const TUBE_FIELDS: NumberField[] = [
  {
    key: 'radius',
    label: 'radius',
    min: 1,
    max: 120,
    step: 1,
    scale: 1000,
    hint: 'Tube radius in em. Held exactly — the corner stage bends the path to carry it.',
  },
  {
    key: 'bend',
    label: 'bend',
    min: 125,
    max: 400,
    step: 5,
    scale: 100,
    unset: 2,
    hint: 'Minimum bend radius, as a multiple of radius, floored at 1.25. Sets the fillet setback rather than the corner classification: raise it and more fillets are rejected, so more corners break and the runs floor rises to meet it. Watch the skeleton panel\u2019s rejected-fillet count, not its corner count.',
  },
  {
    key: 'segments',
    label: 'ring segments',
    min: 3,
    max: 32,
    step: 1,
    scale: 1,
    hint: 'Sides of the tube\u2019s circular cross-section, around the tube rather than along it. Inscribed in the radius, so fewer segments make a genuinely thinner tube: 3 is 83% of the round width, 8 is 97%. Flat emissive hides the faceting, so this reads only as glow.',
  },
  {
    key: 'spacing',
    label: 'spacing',
    min: 2,
    max: 80,
    step: 1,
    scale: 1000,
    hint: 'Arc length in em between points along the centerline, along the tube rather than around it. Load-bearing: bend radius is measured from it, so coarse spacing hides corners entirely.',
  },
  {
    key: 'level',
    label: 'level',
    min: -120,
    max: 120,
    step: 1,
    scale: 1000,
    stops: [0],
    hint: 'Isocontour level in em: negative insets, 0 rides the outline, positive stands off. Topological rather than a scale — contours merge, counters close and thin strokes vanish as it moves, so the contour count steps instead of sliding. 0 is the only level with a geometric meaning.',
  },
  {
    key: 'blockout',
    label: 'blockout',
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    unset: 0,
    hint: 'How often a corner that would cut instead carries the tube past the light unlit. Those runs never light whatever `lit` picks, so blockout caps what `lit` can reach: at 0.7 the most `lit` can do is 92% of tubing\u2019s length.',
  },
  {
    key: 'runs',
    label: 'runs',
    min: 1,
    max: 24,
    step: 1,
    scale: 1,
    hint: 'Requested runs per glyph, not a count. Bounded below by the corner count — a corner that breaks is a cut, asked for or not — and above by min run. Usually pinned across most of its range, and at bend 4 pinned across all of it.',
  },
  {
    key: 'minRun',
    label: 'min run',
    min: 0,
    max: 300,
    step: 5,
    scale: 1000,
    hint: 'Runs shorter than this are dropped and left dark. The ceiling `runs` pushes against from above.',
  },
  {
    key: 'amplitude',
    label: 'amplitude',
    min: 0,
    max: 80,
    step: 1,
    scale: 1000,
    hint: 'How far a front or back run wanders off its flat plane, in em. Applied after the corner stage, so it is the one thing that can re-bend a run nothing checks again. 0 is exactly planar.',
  },
  {
    key: 'wallDepth',
    label: 'wall depth',
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    unset: 0.5,
    stops: [50],
    hint: 'Where a wall run sits in the extruded side, 0 back to 1 front. Depth plus rise is clamped to the depth, so 0.5 is the only setting whose rise swings symmetrically — off centre, half the perimeter flattens against the clamp. Needs `wall` in surfaces.',
  },
  {
    key: 'wallRise',
    label: 'wall rise',
    min: 0,
    max: 100,
    step: 1,
    scale: 100,
    hint: 'Peak-to-peak depth swing along a wall run, as a fraction of depth — one sine cycle per trip around the perimeter, so the tube weaves front to back along the letter\u2019s edge. 0 is a flat band. Needs `wall` in surfaces.',
  },
];

/** `field` is what every published look was tuned against; the other two are candidates. */
const PATH_SOURCES: PathSource[] = ['field', 'exact', 'direct'];

/** The three kinds `surfacesOf` actually produces; `connector` is a count, not a surface. */
const SURFACE_KINDS: SurfaceKind[] = ['front', 'back', 'wall'];

/** The domains, plus the `off` the spec spells as no `gradient` field at all. */
const GRADIENT_DOMAINS = ['off', 'run', 'letter', 'runIndex', 'surface', 'axis', 'radial'] as const;
type GradientChoice = (typeof GRADIENT_DOMAINS)[number];

const GRADIENT_MODES: GradientSpec['mode'][] = ['replace', 'modulate'];

/** What a sweep switched on from `off` starts with, and what the count slider seeds a new stop from. */
const GRADIENT_STOPS = [0xff2d95, 0x2de0ff, 0xffd14a];

const STOP_LABELS = ['stop 1', 'stop 2', 'stop 3'];

const STOPS_HINT =
  'Colours the sweep runs through. Under `modulate` these are multipliers: a stop below #555 reads as a dead tube rather than a shaded one.';

/** The one meaningful number behind two weights: 1 is every corner breaking, 0 every corner bending. */
function cornerMix(weights: CornerWeights): number {
  const total = weights.break + weights.connect;
  return total > 0 ? weights.break / total : 1;
}

function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function unhex(value: string): number {
  return Number.parseInt(value.slice(1), 16);
}

interface Deferred<T> {
  /** What the control displays: the draft while it is being dragged, the spec's own value after. */
  shown: T;
  edit(next: T): void;
  commit(): void;
}

/**
 * A control whose value reaches the spec on release rather than on every input event. One spec
 * change rebuilds all sixteen cells, so writing through per input turns a drag into a lockup.
 */
function useDeferred<T>(value: T, onCommit: (next: T) => void): Deferred<T> {
  const [draft, setDraft] = useState<T | null>(null);
  const [seen, setSeen] = useState(value);
  const pending = useRef<T | null>(null);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };

  // A value from elsewhere — the look picker reseeding every field — outranks a draft, which would
  // otherwise leave the control reading as the old look's number.
  if (seen !== value) {
    setSeen(value);
    setDraft(null);
    pending.current = null;
  }

  const commit = useCallback(() => {
    const next = pending.current;
    pending.current = null;
    setDraft(null);
    if (next !== null && next !== latest.current.value) latest.current.onCommit(next);
  }, []);

  return {
    shown: draft ?? value,
    edit(next: T) {
      pending.current = next;
      setDraft(next);
    },
    commit,
  };
}

interface RangeProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  /** Values the drag catches on, in the slider's own integer units. */
  stops?: number[];
  hint?: string;
  onCommit: (next: number) => void;
}

function Range({ label, min, max, step, value, disabled, stops, hint, onCommit }: RangeProps) {
  const { shown, edit, commit } = useDeferred(value, onCommit);
  // A detent worth 3% of the track: narrower is unhittable at this width, wider swallows the
  // values next to the stop and makes them unreachable.
  const grab = Math.max(step, (max - min) * 0.03);
  const snap = (next: number) => {
    let best = next;
    let bestGap = grab;
    for (const stop of stops ?? []) {
      const gap = Math.abs(next - stop);
      if (gap <= bestGap) {
        best = stop;
        bestGap = gap;
      }
    }
    return best;
  };
  const marks = stops ?? [];
  return (
    // `title` is the hint: nothing in labkit's field schema carries one, and the hints are how the
    // rail says what a control interacts with badly.
    // A div rather than a label: the slider is not a native input, and its own `ariaLabel` is what
    // names it.
    <div className={`rail__field${disabled ? ' rail__row--off' : ''}`} title={hint}>
      <span>{label}</span>
      <div className="rail__slider">
        <Slider
          thumbs={[{ value: shown }]}
          min={min}
          max={max}
          step={step}
          ariaLabel={label}
          trackHeight={8}
          // onInput runs the drag, onChange lands it: a spec change rebuilds every cell, so a drag
          // has to cost one rebuild rather than one per frame.
          onInput={(next) => {
            if (disabled) return;
            edit(snap(next[0]?.value ?? shown));
          }}
          onChange={() => {
            if (!disabled) commit();
          }}
          renderTrack={({ valueToFraction }) =>
            marks.map((stop) => (
              <span
                key={stop}
                className="rail__stop"
                // Only the position is inline, and only because it is a computed fraction of the
                // track; everything about how a stop looks stays in the stylesheet.
                style={
                  {
                    ['--rail-stop']: `${(valueToFraction(stop) * 100).toFixed(3)}%`,
                  } as CSSProperties
                }
              />
            ))
          }
        />
      </div>
    </div>
  );
}

interface ColorProps {
  label: string;
  value: number;
  hint?: string;
  onCommit: (next: number) => void;
}

function Color({ label, value, hint, onCommit }: ColorProps) {
  const { shown, edit, commit } = useDeferred(value, onCommit);
  const input = useRef<HTMLInputElement>(null);

  // The picker is a window of its own: no pointer release lands on the input and focus never
  // leaves it, so the native `change` it fires on close is the only commit that arrives.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [commit]);

  return (
    <label title={hint}>
      {label}
      <input
        ref={input}
        type="color"
        value={hex(shown)}
        onChange={(e) => edit(unhex(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

export interface RailProps {
  spec: TubeSpec;
  onSpec: (next: TubeSpec) => void;
  look: TubeLook;
  onLook: (next: TubeLook) => void;
  bloom: boolean;
  onBloom: (next: boolean) => void;
  letters: string;
  onLetters: (next: string) => void;
  onAddPanel: (letter: string, mode: PanelMode) => void;
  onReset: () => void;
}

export function Rail(props: RailProps) {
  const { spec, onSpec } = props;
  const corners = spec.corners ?? { break: 1, connect: 0 };
  const litSurfaces: SurfaceKind[] = [
    ...spec.surfaces,
    ...(spec.connectors && spec.connectors > 0 ? (['connector'] as SurfaceKind[]) : []),
  ];
  const patch = (part: Partial<TubeSpec>) => onSpec({ ...spec, ...part });
  const gradient = spec.gradient;
  const stops = gradient?.stops ?? GRADIENT_STOPS.slice(0, 2);
  const applyGradient = (next: GradientSpec | null) => {
    const { gradient: _off, ...rest } = spec;
    onSpec(next ? { ...rest, gradient: next } : rest);
  };
  // `generateConnectors` returns nothing without both faces, so the controls say so rather than
  // sitting live and doing nothing.
  const bothFaces = spec.surfaces.includes('front') && spec.surfaces.includes('back');
  const shown = lettersOf(props.letters);
  const [addLetter, setAddLetter] = useState(shown[0] ?? 'M');
  const [addMode, setAddMode] = useState<PanelMode>('beauty');
  // The letters field moves under the select, and adding a letter the zone does not show would
  // put up a panel the next reconcile takes straight back down.
  const adding = shown.includes(addLetter) ? addLetter : (shown[0] ?? addLetter);

  return (
    <div className="rail">
      <section className="rail__group">
        <h2>tube</h2>
        {TUBE_FIELDS.map((field) => (
          <Range
            key={field.key}
            label={field.label}
            min={field.min}
            max={field.max}
            step={field.step}
            stops={field.stops}
            hint={field.hint}
            value={Math.round((spec[field.key] ?? field.unset ?? 0) * field.scale)}
            onCommit={(next) => onSpec({ ...spec, [field.key]: next / field.scale })}
          />
        ))}
        <Range
          label="lit"
          hint="Fraction of lightable runs that light. Blockout runs are never lightable, so this cannot reach every run on its own — drop blockout to 0 for a fully lit letter."
          min={0}
          max={100}
          step={1}
          value={Math.round((spec.select.amount ?? 1) * 100)}
          onCommit={(next) => patch({ select: { ...spec.select, amount: next / 100 } })}
        />
      </section>

      <section className="rail__group">
        <h2>corners</h2>
        {/* Ends are {1,0} and {0,1}: {0,0} returns before drawing, leaving the RNG unadvanced,
            which is a different corner sequence rather than a louder all-break. */}
        <Range
          label="connect ← → break"
          hint="What each corner does. Only the ratio reaches the cut, which is why this is one slider and not two. 0 is ALL_CONNECT, 100 is ALL_BREAK. A hard corner drawn connect must fillet, and a fillet with no room breaks anyway."
          min={0}
          max={100}
          step={1}
          stops={[0, 100]}
          value={Math.round(cornerMix(corners) * 100)}
          onCommit={(next) => patch({ corners: { break: next / 100, connect: 1 - next / 100 } })}
        />
      </section>

      <section className="rail__group">
        <h2 title="Where a front or back path comes from. field rasterises the outline to a 256 grid and re-extracts it, which wobbles the path about 5% of the tube radius and manufactures corners. direct traces the contour itself: accurate and ~120x faster. exact is field with the wobble corrected, kept for telling the two changes apart.">
          path source
        </h2>
        <label>
          source
          <select
            value={spec.pathSource ?? 'direct'}
            onChange={(e) => patch({ pathSource: e.target.value as PathSource })}
          >
            {PATH_SOURCES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rail__group">
        <h2 title="Where tube is run on the extruded letter. front and back are the same contour at two depths; wall is the extruded side connecting them — a return, in signage terms, not the thing the sign hangs on.">
          surfaces
        </h2>
        {SURFACE_KINDS.map((kind) => (
          <label key={kind}>
            {kind}
            <input
              type="checkbox"
              checked={spec.surfaces.includes(kind)}
              onChange={(e) =>
                patch({
                  // Rebuilt in the canonical order, so checking a box back on cannot reshuffle
                  // the list and rebuild every cell for nothing.
                  surfaces: SURFACE_KINDS.filter((s) =>
                    s === kind ? e.target.checked : spec.surfaces.includes(s),
                  ),
                })
              }
            />
          </label>
        ))}
        <Range
          label="connectors"
          hint="Short runs joining a front path to the back plane along z. Counted per front contour, not per glyph, so an O gives twice what you ask and a B three times. Needs both front and back."
          min={0}
          max={8}
          step={1}
          value={spec.connectors ?? 0}
          disabled={!bothFaces}
          onCommit={(next) => patch({ connectors: next })}
        />
        <Range
          label="overshoot"
          min={0}
          max={200}
          step={1}
          hint="How far a connector continues past the back plane, in em, so it does not end flush against it."
          value={Math.round((spec.connectorOvershoot ?? 0.05) * 1000)}
          disabled={!bothFaces}
          onCommit={(next) => patch({ connectorOvershoot: next / 1000 })}
        />
        {bothFaces ? null : <p className="rail__note">connectors need front and back</p>}
      </section>

      <section className="rail__group">
        <h2>material</h2>
        <Color
          label="emissive"
          hint="The tube material's emissive colour. Flat across the whole surface, which is why ring segments changes brightness but never shows faceting."
          value={spec.look.emissive ?? 0xffffff}
          onCommit={(next) => patch({ look: { ...spec.look, emissive: next } })}
        />
        <Range
          label="intensity"
          hint="Emissive strength. What bloom picks up, so it drives the glow more than the run colour does."
          min={0}
          max={100}
          step={1}
          value={Math.round((spec.look.emissiveIntensity ?? 0) * 10)}
          onCommit={(next) => patch({ look: { ...spec.look, emissiveIntensity: next / 10 } })}
        />
        <Range
          label="rim"
          hint="Limb brightening. How much of the emissive moves off the face of the tube, where your line of sight crosses least glowing gas, out to its silhouette, where it crosses most. The width still averages to the look’s own emissive, so the sign’s exposure and its bloom stay put. 0 is the flat ribbon."
          min={0}
          max={100}
          step={1}
          value={Math.round((spec.look.rim ?? 0) * 100)}
          onCommit={(next) => patch({ look: { ...spec.look, rim: next / 100 } })}
        />
        <Color
          label="run colour"
          hint="The palette every lit run draws from, unless its layer has its own colour below."
          value={spec.colors[0] ?? 0xffffff}
          onCommit={(next) => patch({ colors: [next] })}
        />
        {/* Per-layer pickers only for layers this spec actually draws; a colour on a surface that
            is switched off is a control with nothing behind it. */}
        {litSurfaces.map((kind) => (
          <Color
            key={kind}
            label={`${kind} colour`}
            hint={`Overrides the run colour for ${kind} runs only. Each layer cycles its own palette.`}
            value={spec.surfaceColors?.[kind]?.[0] ?? spec.colors[0] ?? 0xffffff}
            onCommit={(next) => patch({ surfaceColors: { ...spec.surfaceColors, [kind]: [next] } })}
          />
        ))}
        <label>
          bloom
          <input
            type="checkbox"
            checked={props.bloom}
            onChange={(e) => props.onBloom(e.target.checked)}
          />
        </label>
      </section>

      <section className="rail__group">
        <h2>gradient</h2>
        <label title="What the sweep is a function of. `surface` does nothing under a look with one layer, which is both shipped looks.">
          domain
          <select
            value={gradient?.domain.of ?? 'off'}
            onChange={(e) => {
              const choice = e.target.value as GradientChoice;
              if (choice === 'off') {
                applyGradient(null);
                return;
              }
              applyGradient({
                domain: { of: choice },
                stops,
                mode: gradient?.mode ?? 'replace',
              });
            }}
          >
            {GRADIENT_DOMAINS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label title="`replace` paints the ramp over the palette; `modulate` multiplies the palette by it, so a multi-colour sign keeps its colours.">
          mode
          <select
            value={gradient?.mode ?? 'replace'}
            disabled={!gradient}
            onChange={(e) => {
              if (!gradient) return;
              applyGradient({ ...gradient, mode: e.target.value as GradientSpec['mode'] });
            }}
          >
            {GRADIENT_MODES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {gradient?.domain.of === 'axis' ? (
          <Range
            label="angle"
            hint="Direction of the sweep across the word. 0 is left to right."
            min={0}
            max={360}
            step={1}
            value={Math.round(gradient.domain.angle ?? 0)}
            onCommit={(next) => applyGradient({ ...gradient, domain: { of: 'axis', angle: next } })}
          />
        ) : null}
        {gradient ? (
          <>
            <Range
              label="stops"
              hint={STOPS_HINT}
              min={1}
              max={STOP_LABELS.length}
              step={1}
              value={stops.length}
              onCommit={(next) =>
                applyGradient({
                  ...gradient,
                  stops: STOP_LABELS.slice(0, next).map(
                    (_label, i) => stops[i] ?? GRADIENT_STOPS[i] ?? 0xffffff,
                  ),
                })
              }
            />
            {STOP_LABELS.slice(0, stops.length).map((label, i) => (
              <Color
                key={label}
                label={label}
                hint={STOPS_HINT}
                value={stops[i] ?? 0xffffff}
                onCommit={(next) =>
                  applyGradient({
                    ...gradient,
                    stops: stops.map((stop, j) => (j === i ? next : stop)),
                  })
                }
              />
            ))}
          </>
        ) : null}
      </section>

      <section className="rail__group">
        <h2>zone</h2>
        <label>
          look
          <select value={props.look} onChange={(e) => props.onLook(e.target.value as TubeLook)}>
            {TUBE_LOOKS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          letters
          <input value={props.letters} onChange={(e) => props.onLetters(e.target.value)} />
        </label>
        <label>
          add
          <select value={adding} onChange={(e) => setAddLetter(e.target.value)}>
            {shown.map((letter) => (
              <option key={letter} value={letter}>
                {letter}
              </option>
            ))}
          </select>
        </label>
        <label>
          as
          <select value={addMode} onChange={(e) => setAddMode(e.target.value as PanelMode)}>
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => props.onAddPanel(adding, addMode)}>
          add panel
        </button>
        <button type="button" onClick={props.onReset}>
          reset layout
        </button>
      </section>
    </div>
  );
}
