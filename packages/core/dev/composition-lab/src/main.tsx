import '@weasel-js/labkit/styles.css';
import { loadFont } from '@core/text/font.js';
import { labHref, labPages } from '@shared/pages.js';
import { IconRegistryProvider } from '@weasel-js/core';
import { icons as coreIcons } from '@weasel-js/core/icons';
import { Lab } from '@weasel-js/labkit';
import { icons as uiIcons } from '@weasel-js/ui/icons';
import { createRoot } from 'react-dom/client';
import { fontUrl } from './font.js';
import { provideFont } from './hooks.js';
import { composer } from './instrument.js';
import { LayersControl } from './LayersControl.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('composition lab: the page has no #root');

// The panels' real pool needs the font synchronously; a failed load leaves them the synthetic one.
provideFont(await loadFont(fontUrl).catch(() => null));

const controls = { effects: LayersControl };
const ICONS = [coreIcons, uiIcons];

createRoot(host).render(
  <IconRegistryProvider icons={ICONS}>
    <Lab
      instruments={[composer]}
      defaultInstrument="composer"
      title="composition lab"
      pages={labPages()}
      path={labHref('composition-lab')}
      storageKey="klieg:composition-lab"
      controls={controls}
    />
  </IconRegistryProvider>,
);
