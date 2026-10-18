import '@weasel-js/labkit/styles.css';
import { KitIcons } from '@shared/KitIcons.js';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('tube gallery: the page has no #root');

createRoot(host).render(
  <KitIcons>
    <App />
  </KitIcons>,
);
