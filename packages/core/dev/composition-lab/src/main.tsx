import '@weasel-js/labkit/styles.css';
import { loadFont } from '@core/text/font.js';
import { KitIcons } from '@shared/KitIcons.js';
import { labHref, labPages } from '@shared/pages.js';
import { Lab } from '@weasel-js/labkit';
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

createRoot(host).render(
  <KitIcons>
    <Lab
      instruments={[composer]}
      defaultInstrument="composer"
      title="composition lab"
      pages={labPages()}
      path={labHref('composition-lab')}
      storageKey="klieg:composition-lab"
      controls={controls}
    />
  </KitIcons>,
);
