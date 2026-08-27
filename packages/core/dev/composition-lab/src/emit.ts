import type { Composition, EffectLayer } from './composition.js';

const args = (params: Record<string, number>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

function layerSource(layer: EffectLayer): string {
  const inner =
    layer.kind === 'draft'
      ? `{\n        duration: 1000,\n        at(t, part) {\n${layer.source ?? ''}\n        },\n      }`
      : // klieg exports `roving` by name but reaches the built-ins only through `EFFECTS`.
        `EFFECTS.${layer.kind}({ ${args(layer.params)} })`;
  const piece = layer.roving
    ? `roving(${inner}, { dwell: ${layer.roving.dwell}, seed: ${layer.roving.seed}, epochs: ${layer.roving.epochs} })`
    : inner;
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
  if (live.some((l) => l.kind !== 'draft')) names.push('EFFECTS');
  if (live.some((l) => l.roving)) names.push('roving');
  const imports = names.length > 0 ? `import { ${names.join(', ')} } from 'klieg';\n\n` : '';

  return `${imports}klieg.fire(${JSON.stringify(c.text)}, {
  look: '${c.look}',
  enter: '${c.enter}',
  active: '${c.active}',
  exit: '${c.exit}',
  hold: ${c.hold},${effects}
});`;
}
