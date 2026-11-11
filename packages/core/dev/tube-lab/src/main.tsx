import '@weasel-js/labkit/styles.css';
import { KitIcons } from '@shared/KitIcons.js';
import { Persistence } from '@weasel-js/labkit';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { readLegacy, STORAGE_KEY } from './persist.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('tube lab: the page has no #root');

// The shared settings persist outside the lab, which is handed them as `over`.
createRoot(host).render(
  <KitIcons>
    <Persistence storageKey={STORAGE_KEY}>
      <App legacy={readLegacy()} />
    </Persistence>
  </KitIcons>,
);
