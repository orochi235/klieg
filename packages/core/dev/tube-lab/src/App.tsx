import { LABS, labHref, labPages } from '@shared/pages.js';
import {
  Lab,
  type LabContextValue,
  type LabContribution,
  useLabContext,
  useUndoKeys,
} from '@weasel-js/labkit';
import { useEffect, useMemo } from 'react';
import { labHistory } from './history.js';
import { INSTRUMENTS } from './instrument.js';
import type { Saved } from './persist.js';
import { Rail } from './Rail.js';
import { drawn, exposeReadout } from './readout.js';
import { useShared } from './state.js';

/** Hands the lab's context to whatever outside it opens and closes trials. */
function Attach({ attach }: { attach: (lab: LabContextValue) => void }) {
  const lab = useLabContext();
  useEffect(() => attach(lab));
  return null;
}

export function App({ legacy }: { legacy: Saved | null }) {
  const { over, reset, attach } = useShared(legacy);
  // Focus in the rail is in no trial, so no trial's keys answer there.
  useUndoKeys(labHistory);
  useEffect(
    () => exposeReadout(() => (drawn.canvas ? { ...drawn, canvas: drawn.canvas } : null)),
    [],
  );

  const labChrome = useMemo<LabContribution[]>(
    () => [
      {
        id: 'tube',
        region: 'aside',
        item: { title: 'tube', undockable: false, body: <Rail over={over} onReset={reset} /> },
      },
    ],
    [over, reset],
  );

  // Dark only: the panels are neon on black, which a light surface washes out. Every lab is served
  // at `/`, so the pathname cannot say which one this is.
  return (
    <Lab
      instruments={INSTRUMENTS}
      defaultInstrument="head-on"
      title={LABS['tube-lab'].label}
      pages={labPages()}
      path={labHref('tube-lab')}
      mode="dark"
      storageKey="klieg:tube-lab"
      over={over}
      labChrome={labChrome}
    >
      <Attach attach={attach} />
    </Lab>
  );
}
