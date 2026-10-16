import type { TrialContribution } from '@weasel-js/labkit';
import { Button } from '@weasel-js/ui';
import { labelOf } from './Body.js';
import { asEffects, entriesOf } from './config.js';
import { DraftPane } from './DraftPane.js';
import { emit } from './emit.js';
import { HOST, useFocus, useLab, useRunTime, useSampled } from './hooks.js';
import { Plot } from './Plot.js';
import { Swatch } from './Swatch.js';
import { Sweep } from './SweepPanel.js';
import { Tenure } from './TenurePanel.js';

function usePassPhase(): number {
  const t = useRunTime();
  const { pass } = useSampled();
  return (t % pass) / pass;
}

function PlotSection() {
  const { config } = useLab();
  const sampled = useSampled();
  const focus = useFocus();
  return (
    <Plot
      samples={sampled.data}
      channel={config.channel}
      part={focus.part}
      label={labelOf(sampled.parts[focus.part])}
      at={usePassPhase()}
    />
  );
}

function SwatchSection() {
  const { config } = useLab();
  const sampled = useSampled();
  return (
    <Swatch
      samples={sampled.data}
      parts={sampled.parts}
      channel={config.channel}
      at={usePassPhase()}
    />
  );
}

function TenureSection() {
  const s = useSampled();
  return (
    <Tenure
      samples={s.data}
      parts={s.parts}
      pass={s.pass}
      epochMs={s.epochMs}
      perPatchPass={(s.count * s.finest) / s.pass}
    />
  );
}

function SweepSection() {
  const { composition } = useLab();
  const { parts } = useSampled();
  return <Sweep composition={composition} parts={parts} host={HOST} />;
}

function DraftsSection() {
  const { composition, config, setConfig } = useLab();
  const { faults } = useSampled();
  const drafts = composition.effects.filter((l) => l.kind === 'draft');
  if (drafts.length === 0) {
    return <p className="cl-note">Add a draft layer to write a patch by hand.</p>;
  }
  return (
    <>
      {drafts.map((layer) => (
        <DraftPane
          key={layer.id}
          layer={layer}
          faults={faults}
          onSource={(source) =>
            setConfig(
              'effects',
              asEffects(entriesOf(config).map((e) => (e.id === layer.id ? { ...e, source } : e))),
            )
          }
        />
      ))}
    </>
  );
}

function EmitSection() {
  const { composition } = useLab();
  const call = emit(composition);
  return (
    <div className="cl-section">
      <Button size="sm" onClick={() => void navigator.clipboard.writeText(call)}>
        copy fire() call
      </Button>
      <pre className="cl-emit">{call}</pre>
    </div>
  );
}

const section = (
  id: string,
  title: string,
  body: React.ReactNode,
  defaultCollapsed = false,
): TrialContribution => ({ id, region: 'sidebar', item: { title, body, defaultCollapsed } });

/** The analysis panels, each a sidebar section that can be folded or torn out. Each reads the
 * trial it sits in, so a torn-out panel keeps following its own trial. */
export const SECTIONS: TrialContribution[] = [
  section('plot', 'Plot', <PlotSection />),
  section('swatch', 'Swatch', <SwatchSection />),
  section('tenure', 'Tenure & jump', <TenureSection />),
  section('sweep', 'Param sweep', <SweepSection />, true),
  section('drafts', 'Drafts', <DraftsSection />, true),
  section('emit', 'Emit', <EmitSection />, true),
];
