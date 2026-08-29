import '@weasel-js/labkit/styles.css';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const host = document.getElementById('root');
if (!host) throw new Error('composition lab: the page has no #root');

createRoot(host).render(<App />);
