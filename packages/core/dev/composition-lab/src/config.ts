import type { PartKind } from '@core/effects/types.js';
import { ACTIVE_NAMES, ENTER_NAMES, EXIT_NAMES, LOOK_NAMES } from '@core/index.js';
import { f, type InferConfig } from '@weasel-js/labkit';
import {
  type Composition,
  DEFAULT_COMPOSITION,
  type EffectLayer,
  type RovingWrap,
} from './composition.js';
import { CHANNELS } from './Plot.js';
import { PARAMS, type PatchKind } from './patches.js';

/** How far past `hold` the transport runs, so an exit is visible. */
export const TAIL_MS = 2000;

export const KINDS: readonly PatchKind[] = ['flicker', 'hue', 'chase', 'lamp', 'draft'];

/** What a new draft opens on: a patch that builds, so the pane starts from working code. */
const DRAFT_SOURCE = `return {
  period: 1400,
  at: (phase, part) => ({
    gain: 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * (phase + part.at))),
  }),
};`;

const ROVING = { dwell: 3200, seed: 0, epochs: 96 };
const INTERMITTENT = { spell: 4200, calm: 2000, bouts: 3 };

/** `id`, `enabled` and a draft's `source` are not in the schema: `PrefControl` draws every field of
 * an object it is given, hidden or not. The layer list carries them beside the schema's fields;
 * `enabled` is its header switch and `source` is edited in the Drafts section. */
/** A layer's pool: what it drives, and how much of it. */
export const sharedFields = () => ({
  target: f
    .enum<PartKind>('run', ['run', 'body', 'chunk'])
    .describe(
      'Which pool this layer draws from. A kind the look does not build is an empty pool, and the layer silently does nothing.',
    ),
  amount: f
    .number(1)
    .range(0, 1)
    .step(0.05)
    .slider()
    .describe(
      'Share of the pool this layer drives. roving wants 1: it picks its holder from the whole pool, so against a subset the fault lands where nothing is driven.',
    ),
});

/** The bout wrapper's own settings, without its switch. */
export const intermittentFields = () => ({
  spell: f
    .number(INTERMITTENT.spell)
    .range(200, 20000)
    .step(100)
    .slider()
    .label('bout spell')
    .describe(
      'Milliseconds of one bout. Shorter than one inner pass and the layer will not build at all: the patch throws rather than showing a sliver.',
    ),
  calm: f
    .number(INTERMITTENT.calm)
    .range(0, 30000)
    .step(100)
    .slider()
    .label('bout calm')
    .describe(
      'Milliseconds held quiet between bouts. At 0 the wrapper is a pass-through, so the layer runs continuously until this is above zero.',
    ),
  bouts: f
    .number(INTERMITTENT.bouts)
    .range(1, 12)
    .step(1)
    .slider()
    .describe(
      'Bouts to a pass, and so how long the loop runs before it repeats. The pass rounds to a whole number of inner passes, so the count it produces can drift from this value.',
    ),
});

const intermittent = () =>
  f
    .object({ on: f.boolean(false), ...intermittentFields() })
    .describe(
      'Runs the layer in bouts and swallows it between them. The inner keeps running against the clock, so a bout opens wherever it happens to be.',
    );

/** The roving wrapper's own settings, without its switch. */
export const rovingFields = () => ({
  dwell: f
    .number(ROVING.dwell)
    .range(400, 9000)
    .step(100)
    .slider()
    .describe(
      'Roughly how long one part keeps the fault. This picks WHO flickers, never how much: that is unrest.',
    ),
  epochs: f
    .number(ROVING.epochs)
    .range(4, 192)
    .step(4)
    .slider()
    .describe(
      'Handovers to a pass, and so the ceiling on how many parts a pass can reach before it loops. Below the pool size, some parts never take the fault at all.',
    ),
});

const roving = () =>
  f
    .object({ on: f.boolean(false), ...rovingFields() })
    .describe(
      "Moves this layer's affliction from part to part. Its pass is many inner passes long, so a short hold may never reach a second handover.",
    );

/** A patch kind's own params. */
export const paramFields = (kind: Exclude<PatchKind, 'draft'>) =>
  Object.fromEntries(
    PARAMS[kind].map((p) => [
      p.key,
      f.number(p.value).range(p.min, p.max).step(p.step).slider().describe(p.hint),
    ]),
  );

/** One variant per patch kind. Lamp alone has no `roving`: it substitutes a part's index and
 * leaves x/y alone, so a lamp would light the part it is standing on. */
const VARIANTS = {
  flicker: f.object({
    ...sharedFields(),
    ...paramFields('flicker'),
    roving: roving(),
    intermittent: intermittent(),
  }),
  hue: f.object({
    ...sharedFields(),
    ...paramFields('hue'),
    roving: roving(),
    intermittent: intermittent(),
  }),
  chase: f.object({
    ...sharedFields(),
    ...paramFields('chase'),
    roving: roving(),
    intermittent: intermittent(),
  }),
  lamp: f.object({
    ...sharedFields(),
    lampSource: f
      .enum('fixed', ['fixed', 'orbit'])
      .label('source')
      .describe(
        "fixed parks the lamp at x,y. orbit walks a circle of radius sweep around it, on the layer's own period.",
      ),
    ...paramFields('lamp'),
    intermittent: intermittent(),
  }),
  draft: f.object({
    ...sharedFields(),
    roving: roving(),
    intermittent: intermittent(),
  }),
};

const layer = f.union('kind', VARIANTS);

const d = DEFAULT_COMPOSITION;

const shape = {
  text: f.string(d.text).describe('The word the sign spells.').section('word'),
  look: f.enum(d.look, LOOK_NAMES).describe('Which built-in look draws it.').section('word'),
  hold: f
    .number(d.hold)
    .range(1000, 30000)
    .step(500)
    .slider()
    .suffix('ms')
    .describe(
      `How long the word stays up. The transport runs ${TAIL_MS} ms past it, so an exit shows.`,
    )
    .section('word'),
  enter: f.enum(d.enter, ENTER_NAMES).describe('How the word arrives.').hidden(),
  active: f.enum(d.active, ACTIVE_NAMES).describe('What the word does while it holds.').hidden(),
  exit: f.enum(d.exit, EXIT_NAMES).describe('How the word leaves.').hidden(),
  pool: f
    .enum(d.pool, ['real', 'synthetic'])
    .describe(
      'Which pool the panels describe. Real follows the text and look above; synthetic is a fixed 24-run, 7-letter stand-in for exercising a kind this look does not build.',
    )
    .section('word'),
  /** Drawn and edited on the diagram, as are the three motions above. */
  effects: f.list([], layer).hidden(),
  /** Which channel and part the plot and part × time show; drawn beside the raster, not here. */
  channel: f.enum('gain', CHANNELS).hidden(),
  part: f.number(0).hidden(),
};

export const schema = f.schema(shape);

export type LabConfig = InferConfig<typeof shape>;
export type LayerEntry = { kind: PatchKind; id: string; enabled: boolean } & Record<
  string,
  unknown
>;

interface Wrap {
  on: boolean;
  [field: string]: number | boolean;
}

function unwrap<T>(wrap: unknown): T | undefined {
  if (!wrap || typeof wrap !== 'object' || !(wrap as Wrap).on) return undefined;
  const { on: _, ...rest } = wrap as Wrap;
  return rest as T;
}

/** The domain layer a stored entry describes. */
export function toLayer(entry: LayerEntry): EffectLayer {
  const keys = entry.kind === 'draft' ? [] : PARAMS[entry.kind].map((p) => p.key);
  const params = Object.fromEntries(
    keys.flatMap((k) => (typeof entry[k] === 'number' ? [[k, entry[k] as number]] : [])),
  );
  const rove = entry.kind === 'lamp' ? undefined : unwrap<Omit<RovingWrap, 'seed'>>(entry.roving);
  const roved = rove ? { ...rove, seed: ROVING.seed } : undefined;
  const bouts = unwrap<EffectLayer['intermittent']>(entry.intermittent);
  return {
    id: entry.id,
    kind: entry.kind,
    enabled: entry.enabled,
    params,
    target: entry.target as PartKind,
    amount: entry.amount as number,
    seed: 0,
    ...(roved ? { roving: roved } : {}),
    ...(bouts ? { intermittent: bouts } : {}),
    ...(entry.kind === 'lamp' ? { lampSource: entry.lampSource as EffectLayer['lampSource'] } : {}),
    ...(entry.kind === 'draft' ? { source: entry.source as string } : {}),
  };
}

export function toComposition(config: LabConfig): Composition {
  return {
    text: config.text,
    look: config.look,
    hold: config.hold,
    enter: config.enter,
    active: config.active,
    exit: config.exit,
    pool: config.pool,
    effects: entriesOf(config).map(toLayer),
  };
}

/** The stored layers, read through the loose shape `toLayer` takes: the union's own type has a
 * variant per kind, which every reader would otherwise narrow before touching a param. */
export function entriesOf(config: Pick<LabConfig, 'effects'>): LayerEntry[] {
  return config.effects as unknown as LayerEntry[];
}

/** `entriesOf` the other way, for a write of the whole list. */
export function asEffects(entries: LayerEntry[]): LabConfig['effects'] {
  return entries as unknown as LabConfig['effects'];
}

let made = 0;

/** A fresh entry of `kind`, filled from the schema's own defaults. */
export function newEntry(kind: PatchKind): LayerEntry {
  made += 1;
  return {
    ...VARIANTS[kind].default,
    kind,
    id: `${kind}-${Date.now().toString(36)}-${made}`,
    enabled: true,
    ...(kind === 'draft' ? { source: DRAFT_SOURCE } : {}),
  };
}
