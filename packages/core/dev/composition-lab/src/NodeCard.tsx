import { ControlPanel, f, resolveConfigSchema } from '@weasel-js/labkit';
import { Button, Switch } from '@weasel-js/ui';
import { useMemo } from 'react';
import {
  asEffects,
  entriesOf,
  intermittentFields,
  type LayerEntry,
  lampSourceField,
  motionField,
  paramFields,
  rovingFields,
  sharedFields,
} from './config.js';
import { removeLayer, removeWrapper, setEnabled, updateEntry } from './edits.js';
import { useLab } from './hooks.js';
import type { Part } from './pipeline.js';

// biome-ignore lint/suspicious/noExplicitAny: the shapes are the schema builder's own, per part.
type Shape = Record<string, any>;

/** The fields a part's card edits, and where in the layer entry they live (null: the entry itself). */
function shapeOf(part: Part, entry: LayerEntry | undefined): { shape: Shape; at: string | null } {
  if (part.kind === 'wrapper') {
    return {
      shape: part.wrapper === 'roving' ? rovingFields() : intermittentFields(),
      at: part.wrapper,
    };
  }
  if (part.kind === 'pool') return { shape: sharedFields(), at: null };
  if (part.kind === 'patch' && entry && entry.kind !== 'draft') {
    const lamp = entry.kind === 'lamp' ? { lampSource: lampSourceField() } : {};
    return { shape: { ...lamp, ...paramFields(entry.kind) }, at: null };
  }
  return { shape: {}, at: null };
}

/** The settings of one node of the diagram, drawn by labkit's own panel from that node's slice of
 * the lab schema. */
export function NodeCard({ part }: { part: Part }) {
  const { config, setConfig } = useLab();
  const entries = entriesOf(config);
  const layer = 'layer' in part ? part.layer : null;
  const entry = entries.find((e) => e.id === layer);
  const { shape, at } = shapeOf(part, entry);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the shape follows the part and kind.
  const schema = useMemo(() => resolveConfigSchema(f.schema(shape)), [part.kind, entry?.kind, at]);
  const write = (next: LayerEntry[]) => setConfig('effects', asEffects(next));

  if (part.kind === 'motion') {
    const stage = part.stage;
    const motion = resolveConfigSchema(f.schema({ [stage]: motionField(stage) }));
    return (
      <div className="cl-card">
        <ControlPanel
          schema={motion}
          config={{ [stage]: config[stage] }}
          setConfig={(_path, value) => setConfig(stage, value as never)}
          pack="one-up"
        />
      </div>
    );
  }
  if (!entry) return null;

  const values = (at ? entry[at] : entry) as Record<string, unknown>;
  const set = (path: string, value: unknown) => {
    const next = at
      ? { ...entry, [at]: { ...(entry[at] as object), [path]: value } }
      : { ...entry, [path]: value };
    write(updateEntry(entries, entry.id, next));
  };

  return (
    <div className="cl-card">
      <div className="cl-card__head">
        <span className="cl-card__title">
          {part.kind === 'wrapper' ? part.wrapper : entry.kind}
        </span>
        {part.kind === 'patch' ? (
          <Switch
            isSelected={entry.enabled}
            onChange={(on) => write(setEnabled(entries, entry.id, on))}
            aria-label={`${entry.kind} on`}
          />
        ) : null}
        {part.kind === 'patch' || part.kind === 'wrapper' ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              write(
                part.kind === 'wrapper'
                  ? removeWrapper(entries, entry.id, part.wrapper)
                  : removeLayer(entries, entry.id),
              )
            }
          >
            remove
          </Button>
        ) : null}
      </div>
      {part.kind === 'patch' && entry.kind === 'draft' ? (
        <p className="cl-note">Its source is edited in the Drafts section of the sidebar.</p>
      ) : (
        <ControlPanel
          schema={schema}
          config={values}
          setConfig={set}
          draftConfig={set}
          pack="one-up"
        />
      )}
    </div>
  );
}
