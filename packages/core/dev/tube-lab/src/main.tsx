import '@weasel-js/labkit/styles.css';
import { KitIcons } from '@shared/KitIcons.js';
import { LABS, labHref, labPages } from '@shared/pages.js';
import { LabShell, Persistence } from '@weasel-js/labkit';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { readLegacy, STORAGE_KEY } from './persist.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('tube lab: the page has no #root');

createRoot(host).render(
  <KitIcons>
    {/* Dark only: the panels are neon on black, which a light surface washes out. Every lab is
        served at `/`, so the pathname cannot say which one this is. */}
    <LabShell
      title={LABS['tube-lab'].label}
      pages={labPages()}
      path={labHref('tube-lab')}
      mode="dark"
    >
      <Persistence storageKey={STORAGE_KEY}>
        <App legacy={readLegacy()} />
      </Persistence>
    </LabShell>
  </KitIcons>,
);
