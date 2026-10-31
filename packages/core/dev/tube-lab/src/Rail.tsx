import type { TubeSpec } from '@core/render/tube/index.js';
import { ControlPanel, withValueAtPath } from '@weasel-js/labkit';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { isPanelMode, lettersOf, type PanelMode } from './panels.js';
import { railSchema } from './rail/schema.js';
import { specValues, withSpecValue } from './rail/values.js';
import { isTubeLook, type TubeLook } from './spec.js';

export interface RailProps {
  spec: TubeSpec;
  onSpec: (next: TubeSpec) => void;
  look: TubeLook;
  onLook: (next: TubeLook) => void;
  bloom: boolean;
  onBloom: (next: boolean) => void;
  letters: string;
  onLetters: (next: string) => void;
  onAddPanel: (letter: string, mode: PanelMode) => void;
  onReset: () => void;
}

interface Draft {
  path: string;
  value: unknown;
}

export const Rail = memo(function Rail(props: RailProps) {
  const { spec, onSpec } = props;
  const shown = useMemo(() => lettersOf(props.letters), [props.letters]);
  const [addLetter, setAddLetter] = useState(shown[0] ?? 'M');
  const [addMode, setAddMode] = useState<PanelMode>('beauty');
  // The letters field moves under the picker, and adding a letter the zone does not show would
  // put up a panel the next reconcile takes straight back down.
  const adding = shown.includes(addLetter) ? addLetter : (shown[0] ?? addLetter);
  const [draft, setDraft] = useState<Draft | null>(null);

  const latest = useRef({ props, adding, addMode });
  latest.current = { props, adding, addMode };
  const letterKey = shown.join('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the schema follows the letters it offers; the actions read `latest`
  const schema = useMemo(
    () =>
      railSchema(
        shown,
        () => latest.current.props.onAddPanel(latest.current.adding, latest.current.addMode),
        () => latest.current.props.onReset(),
      ),
    [letterKey],
  );

  const values = useMemo(
    () => ({
      ...specValues(spec),
      bloom: props.bloom,
      preset: props.look,
      letters: props.letters,
      addLetter: adding,
      addMode,
    }),
    [spec, props.bloom, props.look, props.letters, adding, addMode],
  );
  const config = draft ? withValueAtPath(values, draft.path, draft.value) : values;

  const setConfig = useCallback(
    (path: string, value: unknown) => {
      setDraft(null);
      const { props: p } = latest.current;
      const next = withSpecValue(p.spec, path, value);
      if (next) {
        onSpec(next);
        return;
      }
      if (path === 'bloom') p.onBloom(value === true);
      else if (path === 'preset' && isTubeLook(value)) p.onLook(value);
      else if (path === 'letters' && typeof value === 'string') p.onLetters(value);
      else if (path === 'addLetter' && typeof value === 'string') setAddLetter(value);
      else if (path === 'addMode' && isPanelMode(value)) setAddMode(value);
    },
    [onSpec],
  );

  // A spec row's drag is held here and written once it settles: one spec change rebuilds every
  // cell. Anything else is cheap, so its drafts land as they come, letters as they are typed.
  const draftConfig = useCallback(
    (path: string, value: unknown) => {
      if (withSpecValue(latest.current.props.spec, path, value)) setDraft({ path, value });
      else setConfig(path, value);
    },
    [setConfig],
  );

  return (
    <aside className="rail">
      <ControlPanel
        schema={schema}
        config={config}
        setConfig={setConfig}
        draftConfig={draftConfig}
        pack="one-up"
      />
    </aside>
  );
});
