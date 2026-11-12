import type { PanelConfig } from './trials.js';

/** Leads with the letter the panel draws. A ramp panel reads as its source, the one mode that has one. */
export function PanelTitle({ config }: { config: PanelConfig }) {
  return (
    <span className="panel-title">
      <span className="panel-title__letter">{config.letter || '·'}</span>
      <span className="panel-title__mode">
        {config.mode === 'ramp' ? config.source : config.mode}
      </span>
    </span>
  );
}
