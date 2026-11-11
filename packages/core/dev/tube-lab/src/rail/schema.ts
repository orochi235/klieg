import type { PathSource } from '@core/render/tube/index.js';
import { f, resolveConfigSchema } from '@weasel-js/labkit';
import { DEFAULT_LETTERS } from '../panels.js';
import { TUBE_LOOKS } from '../spec.js';
import { PERCENT, tubeRows } from './tube.js';
import { GRADIENT_DOMAINS, LAYERS, STOP_COUNT } from './values.js';

/** `field` is what every published look was tuned against; the other two are candidates. */
const PATH_SOURCES: PathSource[] = ['field', 'exact', 'direct'];

const STOPS_HINT =
  'Colors the sweep runs through. Under `modulate` these are multipliers: a stop below #555 reads as a dead tube rather than a shaded one.';

const BOTH_FACES = {
  all: [
    { path: 'front', is: true },
    { path: 'back', is: true },
  ],
};
const GRADIENT_ON = { path: 'domain', isNot: 'off' };

function shape() {
  return {
    // Ends are {1,0} and {0,1}: {0,0} returns before drawing, leaving the RNG unadvanced, which
    // is a different corner sequence rather than a louder all-break.
    cornerMix: f
      .number(1)
      .range(0, 1)
      .step(0.01)
      .unit(PERCENT)
      .label('connect ← → break')
      .section('corners')
      .stops([0, 1])
      .describe(
        'What each corner does. Only the ratio reaches the cut, which is why this is one slider and not two. 0 is ALL_CONNECT, 100 is ALL_BREAK. A hard corner drawn connect must fillet, and a fillet with no room breaks anyway.',
      ),
    pathSource: f
      .enum<PathSource>('direct', PATH_SOURCES)
      .label('source')
      .section('path source')
      .describe(
        'Where a front or back path comes from. field rasterizes the outline to a 256 grid and re-extracts it, which wobbles the path about 5% of the tube radius and manufactures corners. direct traces the contour itself: accurate and ~120x faster. exact is field with the wobble corrected, kept for telling the two changes apart.',
      ),
    front: f
      .boolean(true)
      .section('surfaces')
      .describe(
        'Where tube is run on the extruded letter. front and back are the same contour at two depths; wall is the extruded side connecting them — a return, in signage terms, not the thing the sign hangs on.',
      ),
    back: f.boolean(false).section('surfaces'),
    wall: f.boolean(false).section('surfaces'),
    // `generateConnectors` returns nothing without both faces, so the rows say so rather than
    // sitting live and doing nothing.
    connectors: f
      .number(0)
      .range(0, 8)
      .step(1)
      .section('surfaces')
      .enableIf(BOTH_FACES)
      .describe(
        'Short runs joining a front path to the back plane along z. Counted per front contour, not per glyph, so an O gives twice what you ask and a B three times. Needs both front and back.',
      ),
    connectorOvershoot: f
      .number(0.05)
      .range(0, 0.2)
      .step(0.001)
      .suffix('em')
      .label('overshoot')
      .section('surfaces')
      .enableIf(BOTH_FACES)
      .describe(
        'How far a connector continues past the back plane, in em, so it does not end flush against it.',
      ),
  };
}

function material() {
  const layers = Object.fromEntries(
    LAYERS.map((kind) => [
      `${kind}Color`,
      f
        .color('#ffffff')
        .label(`${kind} color`)
        .section('material')
        // A color on a layer this spec does not draw is a control with nothing behind it.
        .showIf(
          kind === 'connector'
            ? { all: [BOTH_FACES, { path: 'connectors', above: 0 }] }
            : { path: kind, is: true },
        )
        .describe(
          `Overrides the run color for ${kind} runs only. Each layer cycles its own palette.`,
        ),
    ]),
  );
  return {
    look: f
      .group({
        emissive: f
          .color('#ffffff')
          .describe(
            'The tube material’s emissive color. Flat across the whole surface, which is why ring segments changes brightness but never shows faceting.',
          ),
        emissiveIntensity: f
          .number(0)
          .range(0, 10)
          .step(0.1)
          .label('intensity')
          .describe(
            'Emissive strength. What bloom picks up, so it drives the glow more than the run color does.',
          ),
        rim: f
          .number(0)
          .range(0, 1)
          .step(0.01)
          .unit(PERCENT)
          .describe(
            'Limb brightening. How much of the emissive moves off the face of the tube, where your line of sight crosses least glowing gas, out to its silhouette, where it crosses most. The width still averages to the look’s own emissive, so the sign’s exposure and its bloom stay put. 0 is the flat ribbon.',
          ),
      })
      .as('fragment')
      .section('material'),
    runColor: f
      .color('#ffffff')
      .label('run color')
      .section('material')
      .describe('The palette every lit run draws from, unless its layer has its own color below.'),
    ...layers,
    bloom: f.boolean(true).section('material'),
  };
}

function counters() {
  return {
    rescue: f
      .boolean(true)
      .heading()
      .section('counters')
      .describe(
        'What a counter the glass cannot go round does. A rescue turns blockout off, then steps the glass thinner down to the floor, and one lit keeps select from leaving a drawn counter dark.',
      ),
    floor: f
      .number(0.5)
      .range(0, 1)
      .step(0.05)
      .unit(PERCENT)
      .section('counters')
      .describe(
        'The thinnest glass a rescue may use, as a share of radius. The shipped ladder stops at half, so below 50% changes nothing unless a rung asks to fit.',
      ),
    oneLit: f.boolean(false).label('one lit').section('counters'),
  };
}

function gradient() {
  const stops = Object.fromEntries(
    Array.from({ length: STOP_COUNT }, (_, i) => [
      `stop${i + 1}`,
      f
        .color('#ffffff')
        .label(`stop ${i + 1}`)
        .section('gradient')
        .showIf({ all: [GRADIENT_ON, { path: 'stopCount', atLeast: i + 1 }] })
        .describe(STOPS_HINT),
    ]),
  );
  return {
    domain: f
      .enum('off', GRADIENT_DOMAINS)
      .section('gradient')
      .describe(
        'What the sweep is a function of. `surface` does nothing under a look with one layer, which is both shipped looks.',
      ),
    mode: f
      .enum<'replace' | 'modulate'>('replace', ['replace', 'modulate'])
      .section('gradient')
      .enableIf(GRADIENT_ON)
      .describe(
        '`replace` paints the ramp over the palette; `modulate` multiplies the palette by it, so a multi-color sign keeps its colors.',
      ),
    angle: f
      .number(0)
      .range(0, 360)
      .step(1)
      .suffix('°')
      .section('gradient')
      .showIf({ path: 'domain', is: 'axis' })
      .describe('Direction of the sweep across the word. 0 is left to right.'),
    stopCount: f
      .number(2)
      .range(1, STOP_COUNT)
      .step(1)
      .label('stops')
      .section('gradient')
      .showIf(GRADIENT_ON)
      .describe(STOPS_HINT),
    ...stops,
  };
}

function zone() {
  return {
    preset: f.enum('tubing', TUBE_LOOKS).label('look').section('zone'),
    letters: f
      .string(DEFAULT_LETTERS)
      .section('zone')
      .describe(
        'The letters on show. A letter typed here opens its four panels, and one taken out closes every panel of it.',
      ),
  };
}

/** Every setting the panels share, which the lab keeps in `over` rather than in any one trial. */
function sharedNodes() {
  return {
    ...tubeRows(),
    ...shape(),
    ...material(),
    ...counters(),
    ...gradient(),
    ...zone(),
  };
}

/** The shared settings: the schema each trial's config is drawn over. */
export const SHARED = resolveConfigSchema(f.schema(sharedNodes()));

/** The rail: the shared settings, and a reset that puts the whole lab back to a first visit. */
export function railSchema(onReset: () => void) {
  return resolveConfigSchema(
    f.schema({
      ...sharedNodes(),
      reset: f.action(onReset).label('reset lab').section('zone'),
    }),
  );
}
