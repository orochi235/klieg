import { type Composition, carriesRoving, type EffectLayer } from './composition.js';

const args = (params: Record<string, number>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

function lampSource(layer: EffectLayer): string {
  const p = layer.params;
  const src =
    layer.lampSource === 'orbit'
      ? `orbit({ radius: ${p.sweep ?? 0.3}, x: ${p.x ?? 0}, y: ${p.y ?? 0} })`
      : `fixed(${p.x ?? 0}, ${p.y ?? 0})`;
  return `lamp({ source: ${src}, duration: ${p.duration ?? 4000}, radius: ${p.radius ?? 0.5}, strength: ${p.strength ?? 2} })`;
}

function layerSource(layer: EffectLayer): string {
  let piece: string;
  if (layer.kind === 'draft') {
    piece = `{\n        duration: 1000,\n        at(t, part) {\n${layer.source ?? ''}\n        },\n      }`;
  } else if (layer.kind === 'lamp') {
    piece = lampSource(layer);
  } else {
    // klieg exports `roving` by name but reaches the built-ins only through `EFFECTS`.
    piece = `EFFECTS.${layer.kind}({ ${args(layer.params)} })`;
  }
  if (carriesRoving(layer)) {
    piece = `roving(${piece}, { dwell: ${layer.roving.dwell}, seed: ${layer.roving.seed}, epochs: ${layer.roving.epochs} })`;
  }
  if (layer.intermittent) {
    piece = `intermittent(${piece}, { spell: ${layer.intermittent.spell}, calm: ${layer.intermittent.calm}, bouts: ${layer.intermittent.bouts} })`;
  }
  const stagger = layer.stagger === undefined ? '' : `\n      stagger: ${layer.stagger},`;
  return `    {
      piece: ${piece},
      target: { kind: '${layer.target}', by: 'index', amount: ${layer.amount} },
      seed: ${layer.seed},${stagger}
    },`;
}

/** The `fire()` call this composition describes, ready to paste. */
export function emit(c: Composition): string {
  const live = c.effects.filter((l) => l.enabled);
  const layers = live.map(layerSource);
  const effects = layers.length > 0 ? `\n  effects: [\n${layers.join('\n')}\n  ],` : '';

  const names: string[] = [];
  if (live.some((l) => l.kind !== 'draft' && l.kind !== 'lamp')) names.push('EFFECTS');
  if (live.some((l) => l.kind === 'lamp' && l.lampSource !== 'orbit')) names.push('fixed');
  if (live.some((l) => l.kind === 'lamp')) names.push('lamp');
  if (live.some((l) => l.intermittent)) names.push('intermittent');
  if (live.some((l) => l.kind === 'lamp' && l.lampSource === 'orbit')) names.push('orbit');
  if (live.some(carriesRoving)) names.push('roving');
  const imports = names.length > 0 ? `import { ${names.join(', ')} } from 'klieg';\n\n` : '';

  return `${imports}klieg.fire(${JSON.stringify(c.text)}, {
  look: '${c.look}',
  enter: '${c.enter}',
  active: '${c.active}',
  exit: '${c.exit}',
  hold: ${c.hold},${effects}
});`;
}
