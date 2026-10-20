import type { ControlRenderer } from '@weasel-js/labkit';
import {
  Button,
  Disclosure,
  DragGrip,
  PrefControl,
  Switch,
  useReorderDragList,
} from '@weasel-js/ui';
import { useState } from 'react';
import { layerPatch } from './composition.js';
import { KINDS, type LayerEntry, newEntry, toLayer } from './config.js';
import { useLab, useSampled } from './hooks.js';
import { hasGradient } from './patches.js';
import { poolCounts } from './pool.js';

type Leaf = Parameters<typeof PrefControl>[0]['pref'];
type Context = Parameters<ControlRenderer>[0];

/** Why a layer will do nothing, which the patch itself never says. */
export function warningsOf(
  entry: LayerEntry,
  counts: Record<string, number>,
  look: string,
  gradient: boolean,
) {
  const out: string[] = [];
  const target = entry.target as string;
  if (counts[target] === 0) out.push(`this pool has no ${target} parts, so the layer does nothing`);
  if (entry.kind === 'chase' && !gradient) {
    out.push(`the ${look} look declares no gradient, so the layer does nothing`);
  }
  const bouts = entry.intermittent as { on?: boolean } | undefined;
  if (bouts?.on && entry.kind !== 'draft' && layerPatch(toLayer(entry)) === null) {
    out.push(`bout spell is shorter than one pass of ${entry.kind}, so the layer does not build`);
  }
  return out;
}

/** An edit from the entry's control, which knows only the schema's fields. A change of kind starts
 * from that kind's own fresh entry, so a layer turned into a draft has a source to compile. */
function edited(entry: LayerEntry, next: LayerEntry): LayerEntry {
  const base =
    next.kind === entry.kind ? entry : { ...newEntry(next.kind), enabled: entry.enabled };
  return { ...base, ...next, id: entry.id };
}

function LayerList({ pref, value, setValue }: Context) {
  const item = (pref as unknown as { item: Leaf }).item;
  const entries = (value as LayerEntry[] | undefined) ?? [];
  const { composition } = useLab();
  const { parts } = useSampled();
  const counts = poolCounts(parts);
  const gradient = hasGradient(composition.look);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const write = (next: LayerEntry[]) => setValue(next);
  const replace = (id: string, next: LayerEntry) =>
    write(entries.map((e) => (e.id === id ? next : e)));

  const drag = useReorderDragList({
    items: entries.map((e) => ({ id: e.id, label: e.kind })),
    selectedIds: [],
    onReorder: (ids, target) => {
      const moving = entries.filter((e) => ids.includes(e.id));
      const rest = (from: number, to?: number) =>
        entries.slice(from, to).filter((e) => !ids.includes(e.id));
      write([...rest(0, target), ...moving, ...rest(target)]);
    },
  });

  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="cl-layers">
      <div className="cl-layer-list" {...drag.containerProps}>
        {entries.map((entry, index) => {
          const shown = open.has(entry.id);
          const warnings = warningsOf(entry, counts, composition.look, gradient);
          return (
            <div className="cl-layer" key={entry.id}>
              <div className="cl-layer__head">
                <button
                  type="button"
                  className="cl-layer__grip"
                  aria-label={`move ${entry.kind}; arrow keys reorder`}
                  onKeyDown={(e) => {
                    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
                    if (delta !== 0 && drag.nudge(entry.id, index, delta)) e.preventDefault();
                  }}
                  {...drag.rowProps(entry.id, index)}
                >
                  <DragGrip />
                </button>
                <Disclosure open={shown} onToggle={() => toggle(entry.id)} label={entry.kind} />
                <span className="cl-layer__kind">{entry.kind}</span>
                <Switch
                  isSelected={entry.enabled}
                  onChange={(on) => replace(entry.id, { ...entry, enabled: on })}
                  aria-label={`${entry.kind} on`}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  ariaLabel={`remove ${entry.kind}`}
                  onClick={() => write(entries.filter((e) => e.id !== entry.id))}
                >
                  ×
                </Button>
              </div>
              {warnings.map((w) => (
                <p className="cl-warn" key={w}>
                  {w}
                </p>
              ))}
              {shown ? (
                <PrefControl
                  pref={item}
                  path={`effects.${index}`}
                  value={entry}
                  onChange={(next) => replace(entry.id, edited(entry, next as LayerEntry))}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="cl-layers__add">
        {KINDS.map((kind) => (
          <Button
            key={kind}
            size="sm"
            onClick={() => {
              const made = newEntry(kind);
              write([...entries, made]);
              setOpen((was) => new Set(was).add(made.id));
            }}
          >
            + {kind}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The layer list drawn in place, rather than in the dialog labkit gives a list: tuning a layer
 * is done by eye, against the running sign. */
export const LayersControl: ControlRenderer = Object.assign(
  (ctx: Context) => <LayerList {...ctx} />,
  {
    wide: true,
  },
);
