import { type CSSProperties, useSyncExternalStore } from 'react';
import { type DrawnScene, drawnLayers, shownLegend, subscribeLayers } from './legend.js';

/**
 * The ink key, holding only the rows this view drew. Each swatch carries its colour as an inline
 * custom property because the palette lives in `legend.ts` and the canvas draws from it —
 * restating it in CSS is the drift the legend test exists to prevent.
 */
export function Legend({ scene }: { scene: DrawnScene }) {
  const layers = useSyncExternalStore(subscribeLayers, drawnLayers);
  const entries = shownLegend(layers, scene);
  if (entries.length === 0) return null;
  return (
    <ul className="legend">
      {entries.map((entry) => (
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
