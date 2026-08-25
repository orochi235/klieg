import type { CSSProperties } from 'react';
import { LEGEND } from './legend.js';

/**
 * The ink key. Each swatch carries its colour as an inline custom property because the palette
 * lives in `legend.ts` and the canvas draws from it — restating it in CSS is the drift the
 * legend test exists to prevent.
 */
export function Legend() {
  return (
    <ul className="legend">
      {LEGEND.map((entry) => (
        <li className="legend__item" key={entry.key}>
          <span
            className={`legend__swatch legend__swatch--${entry.mark ?? 'line'}`}
            style={{ '--ink': entry.color } as CSSProperties}
          />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
