import { defineInstrument } from '@weasel-js/labkit';
import { Body } from './Body.js';
import { DEFAULT_COMPOSITION } from './composition.js';
import { type LabConfig, schema, TAIL_MS } from './config.js';
import { SECTIONS } from './sections.js';

/** One composition per trial. Nothing lives in state: every panel derives from the config and
 * the trial's clock. */
export const composer = defineInstrument<Record<string, never>, LabConfig>({
  name: 'composer',
  title: 'composition',
  config: schema,
  initialState: () => ({}),
  // The run's length follows `hold`; `Body` rewrites it when hold changes.
  clock: { duration: DEFAULT_COMPOSITION.hold + TAIL_MS, loop: true },
  chrome: SECTIONS,
  render: () => <Body />,
});
