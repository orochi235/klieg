import '@weasel-js/labkit/styles.css';
import { KitIcons } from '@shared/KitIcons.js';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { DEFAULT_LETTERS, type PanelRecord, seedPanels } from './panels.js';
import { restore } from './persist.js';
import { tubeSpecOf } from './spec.js';
import './styles.css';

function seed(letters: string): PanelRecord[] {
  return seedPanels(letters).map((meta, i) => ({ id: `p${i}`, ...meta }));
}

const saved = restore();
const letters = saved?.letters ?? DEFAULT_LETTERS;

const host = document.getElementById('root');
if (!host) throw new Error('tube lab: the page has no #root');

createRoot(host).render(
  <KitIcons>
    <App
      panels={saved?.panels ?? seed(letters)}
      layout={saved?.layout ?? {}}
      letters={letters}
      spec={saved?.spec ?? tubeSpecOf('tubing')}
      look={saved?.look ?? 'tubing'}
    />
  </KitIcons>,
);
