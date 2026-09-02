import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { buildScene, type SceneRequest } from '../../../dev/kliegsminister/src/scene.js';
import { CUT_REPAIR_IDS } from '../../../src/render/tube/repairs.js';
import { TUBE_STAGES } from '../../../src/render/tube/stages.js';
import type { LoadedFont } from '../../../src/text/font.js';

const FONT_PATH = fileURLToPath(
  new URL('../../../../../apps/lab/public/font.ttf', import.meta.url),
);

/** `buildScene` reads nothing off a `LoadedFont` but the parsed face. */
function labFont(): LoadedFont {
  const buf = readFileSync(FONT_PATH);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { font } as unknown as LoadedFont;
}

const font = labFont();

function request(over: Partial<SceneRequest> = {}): SceneRequest {
  return {
    letter: 'B',
    look: 'piping',
    source: 'direct',
    corner: 0,
    rejoin: 'bridge',
    stages: new Set(TUBE_STAGES.map((s) => s.id)),
    drawAt: 'sweep',
    repairs: new Set(CUT_REPAIR_IDS),
    hairpin: 0,
    hairpinShape: 'uturn',
    subject: 'letter',
    ...over,
  };
}

const measure = (scene: ReturnType<typeof buildScene>, label: string) =>
  scene.measures.find((m) => m.label === label);

// Neither shipped look weights a hairpin, so before the lab could override the weight its
// `hairpin` repair toggle was a switch with nothing on the other end.
describe('the hairpin weight', () => {
  it('reaches no hairpin at the weight both shipped looks carry', () => {
    const scene = buildScene(font, request({ hairpin: 0 }));
    expect(scene.ghosts.some((g) => g.id === 'hairpin')).toBe(false);
  });

  it('reaches one when the lab asks for it', () => {
    const scene = buildScene(font, request({ hairpin: 1 }));
    expect(scene.ghosts.some((g) => g.id === 'hairpin')).toBe(true);
  });
});

describe('the points measure', () => {
  it('reports the count alone when nothing is switched off', () => {
    const value = measure(buildScene(font, request()), 'points')?.value ?? '';
    expect(value).toMatch(/^\d+$/);
  });

  // The reading this exists for: switching `setback` off under `bridge` does not change one
  // corner, it cascades, because the leg-room math assumes the trim happened.
  it('flags a repair that cascades rather than changing one corner', () => {
    const scene = buildScene(
      font,
      request({ repairs: new Set(CUT_REPAIR_IDS.filter((id) => id !== 'setback')) }),
    );
    const points = measure(scene, 'points');
    expect(points?.value).toMatch(/against \d+ \(\d+\.\d+x\)/);
    expect(points?.bad).toBe(true);
  });

  it('leaves a repair that changes little unflagged', () => {
    const scene = buildScene(
      font,
      request({ repairs: new Set(CUT_REPAIR_IDS.filter((id) => id !== 'close')) }),
    );
    expect(measure(scene, 'points')?.bad).toBeFalsy();
  });
});
