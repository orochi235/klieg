import { ControlPanel, type LabOver, withValueAtPath } from '@weasel-js/labkit';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { railSchema } from './rail/schema.js';
import { isSpecPath } from './shared.js';

interface Draft {
  path: string;
  value: unknown;
}

export interface RailProps {
  over: LabOver;
  onReset: () => void;
}

/** The shared settings, in the lab's aside: one rail for every panel. */
export const Rail = memo(function Rail({ over, onReset }: RailProps) {
  const reset = useRef(onReset);
  reset.current = onReset;
  const schema = useMemo(() => railSchema(() => reset.current()), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const config = draft ? withValueAtPath(over.values, draft.path, draft.value) : over.values;

  const { set } = over;
  const setConfig = useCallback(
    (path: string, value: unknown) => {
      setDraft(null);
      set(path, value);
    },
    [set],
  );

  // A spec row's drag is held here and written once it settles: one spec change rebuilds every
  // panel. Anything else is cheap, so its drafts land as they come, letters as they are typed.
  const draftConfig = useCallback(
    (path: string, value: unknown) => {
      if (isSpecPath(path)) setDraft({ path, value });
      else setConfig(path, value);
    },
    [setConfig],
  );

  return (
    <div className="rail">
      <ControlPanel
        schema={schema}
        config={config}
        setConfig={setConfig}
        draftConfig={draftConfig}
        pack="one-up"
      />
    </div>
  );
});
