import { Select } from '@weasel-js/ui';
import { lettersOf, MODES, type PanelMode, RAMP_SOURCES, type RampSource } from './panels.js';
import { lettersIn, type Shared } from './shared.js';
import type { PanelConfig } from './trials.js';

const MODE_OPTIONS = MODES.map((m) => ({ value: m, label: m }));
const SOURCE_OPTIONS = RAMP_SOURCES.map((s) => ({ value: s, label: s }));

export interface PanelBarProps {
  config: PanelConfig;
  shared: Shared;
  setConfig: (path: string, value: unknown) => void;
}

/**
 * A panel's own settings, in its toolbar rather than a sidebar: sixteen sidebars would take half of every panel.
 * The letter offers the letters on show, since one outside them is closed by the next edit of the letters field.
 */
export function PanelBar({ config, shared, setConfig }: PanelBarProps) {
  const shown = lettersOf(lettersIn(shared));
  const letters = shown.includes(config.letter) ? shown : [config.letter, ...shown];
  return (
    <div className="panel-bar">
      <Select<string>
        aria-label="letter"
        variant="bare"
        width="fit"
        selectedKey={config.letter}
        onSelectionChange={(next) => setConfig('letter', next)}
        options={letters.map((l) => ({ value: l, label: l }))}
      />
      <Select<PanelMode>
        aria-label="mode"
        variant="bare"
        width="fit"
        selectedKey={config.mode}
        onSelectionChange={(next) => setConfig('mode', next)}
        options={MODE_OPTIONS}
      />
      {config.mode === 'ramp' ? (
        <Select<RampSource>
          aria-label="ramp source"
          variant="bare"
          width="fit"
          selectedKey={config.source}
          onSelectionChange={(next) => setConfig('source', next)}
          options={SOURCE_OPTIONS}
        />
      ) : null}
    </div>
  );
}
