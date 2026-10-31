import { HOME, LIMITS } from '@shared/orbit.js';
import { defineInstrument } from '@weasel-js/labkit';
import { Body } from './Body.js';
import { type LabConfig, schema, TAIL_MS } from './config.js';
import { SECTIONS } from './sections.js';

/** One composition per trial. Nothing lives in state: every panel derives from the config and
 * the trial's clock. */
export const composer = defineInstrument<Record<string, never>, LabConfig>({
  name: 'composer',
  title: 'composition',
  config: schema,
  initialState: () => ({}),
  clock: (config) => ({ duration: config.hold + TAIL_MS, loop: true }),
  orbit: {
    initialView: HOME,
    limits: LIMITS,
  },
  chrome: SECTIONS,
  render: () => <Body />,
});
