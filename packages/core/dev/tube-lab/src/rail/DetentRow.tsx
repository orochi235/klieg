import type { ControlRenderer } from '@weasel-js/labkit';
import type { PrefRenderContext } from '@weasel-js/ui/components/Prefs';
import { PropertyRow } from '@weasel-js/ui/components/Properties';
import { Slider } from '@weasel-js/ui/components/Slider';
import { useState } from 'react';

/** The parts of a number leaf this row reads; the leaf is `f.number` with `.range` and `.step`. */
interface NumberLeaf {
  name: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  unit?: { suffix?: string; scale: number; precision?: number };
}

function decimals(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
}

function format(value: number, leaf: NumberLeaf): string {
  if (leaf.unit) {
    const shown = value / leaf.unit.scale;
    return `${shown.toFixed(leaf.unit.precision ?? decimals(leaf.step / leaf.unit.scale))}${leaf.unit.suffix ?? ''}`;
  }
  return `${value.toFixed(decimals(leaf.step))}${leaf.suffix ? ` ${leaf.suffix}` : ''}`;
}

function DetentSlider({ ctx, stops }: { ctx: PrefRenderContext; stops: readonly number[] }) {
  const leaf = ctx.pref as unknown as NumberLeaf;
  const value = typeof ctx.value === 'number' ? ctx.value : leaf.min;
  // The drag shows here and reaches the config once, on release: one config write rebuilds
  // every cell, so a write per move turns a drag into a lockup.
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  return (
    <PropertyRow
      group
      layout="inline"
      label={leaf.name}
      description={leaf.description}
      readout={<span className="rail__readout">{format(shown, leaf)}</span>}
      disabled={ctx.disabled}
    >
      <div className="rail__slider">
        <Slider
          thumbs={[{ value: shown }]}
          min={leaf.min}
          max={leaf.max}
          step={leaf.step}
          stops={stops}
          ariaLabel={leaf.name}
          readoutPlacement="none"
          thumbShape="dot"
          trackHeight={4}
          onInput={(next) => setDraft(next[0]?.value ?? shown)}
          onChange={(next) => {
            setDraft(null);
            const settled = next[0]?.value ?? shown;
            if (settled !== value) ctx.setValue(settled);
          }}
        />
      </div>
    </PropertyRow>
  );
}

/** A slider row whose drag catches on `stops`, in the leaf's stored units: the values that mean something. */
export function detent(stops: readonly number[]): ControlRenderer {
  const render: ControlRenderer = (ctx) => <DetentSlider ctx={ctx} stops={stops} />;
  render.group = true;
  return render;
}
