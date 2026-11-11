import { HOME, LIMITS } from '@shared/orbit.js';
import { defineInstrument, f } from '@weasel-js/labkit';
import { Panel } from './Panel.js';
import {
  MODES,
  type PanelMode,
  POSES,
  type Pose,
  RAMP_SOURCES,
  type RampSource,
} from './panels.js';
import { SHARED } from './rail/schema.js';
import type { PanelConfig } from './trials.js';

const HEAD_ON = { ...HOME, near: 0.1, far: 100 };

/** The turned pose's yaw, with enough pitch to show a planar loop ring as an ellipse. */
const TURNED = { ...HEAD_ON, yaw: (-30 * Math.PI) / 180, pitch: (13 * Math.PI) / 180 };

/** A panel's own settings, drawn over the ones every panel shares. */
const config = f.schema(
  {
    letter: f.string('M').describe('The letter this panel draws. Only the first character counts.'),
    mode: f
      .enum<PanelMode>('beauty', MODES)
      .describe(
        'beauty is the letter as the look renders it. skeleton draws the runs and their corners. ramp colors the tube by depth or by arc length.',
      ),
    source: f
      .enum<RampSource>('depth', RAMP_SOURCES)
      .label('ramp source')
      .showIf({ path: 'mode', is: 'ramp' })
      .describe('What the ramp colors by: depth along z, or arc length along each run.'),
  },
  { over: SHARED.group },
);

/** Pose is the instrument rather than a setting, so Reset and the home gesture return to where the panel opened. */
function panelInstrument(pose: Pose) {
  const home = pose === 'turned' ? TURNED : HEAD_ON;
  return defineInstrument<Record<string, never>, PanelConfig>({
    name: pose,
    title: pose,
    config,
    initialState: () => ({}),
    orbit: { initialView: home, limits: LIMITS },
    render: (ctx) => <Panel {...ctx.config} over={ctx.over} home={home} />,
  });
}

export const INSTRUMENTS = POSES.map(panelInstrument);
