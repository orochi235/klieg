import '@weasel-js/labkit/styles.css';
import { Lab } from '@weasel-js/labkit';
import { createRoot } from 'react-dom/client';
import { labFont } from './font.js';
import { junction, provideFont } from './instrument.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('kliegsminister: the page has no #root');

// The instrument model is synchronous, so the font is resolved before the lab mounts.
provideFont(await labFont());

createRoot(host).render(
  <Lab instruments={[junction]} defaultInstrument="junction" title="kliegsminister" />,
);
