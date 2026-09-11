import { LabSwitcher } from '@weasel-js/labkit';
import { LABS, type LabId, labHref, labPages } from './pages.js';
import './lab-bar.css';

/** A lab's title bar: its name, which opens a menu of every dev lab. */
export function LabBar({ lab }: { lab: LabId }) {
  return (
    <header className="lab-bar">
      {/* Every lab is served at `/`, so the pathname cannot say which one this is. */}
      <LabSwitcher title={LABS[lab].label} pages={labPages()} path={labHref(lab)} />
    </header>
  );
}
