import type { TubeSpec } from '@core/render/tube/index.js';
import type { Workspace } from '@weasel-js/labkit';
import type { ComponentProps } from 'react';
import type { PanelRecord } from './panels.js';
import { isTubeLook, type TubeLook } from './spec.js';

/** labkit declares this type but does not export it, so it is read off the component's own props. */
export type WorkspaceLayout = NonNullable<ComponentProps<typeof Workspace>['layout']>;

const KEY = 'tube-lab/v2';
/** Written when the layout was a serialized windease store, which v2 cannot read. */
const LEGACY_KEY = 'tube-lab/v1';

interface Saved {
  panels: PanelRecord[];
  layout: WorkspaceLayout;
  letters: string;
  spec: TubeSpec;
  look?: TubeLook;
}

export interface Restored {
  panels: PanelRecord[] | null;
  layout: WorkspaceLayout;
  letters: string;
  spec: TubeSpec;
  look: TubeLook | null;
}

export function save(
  panels: readonly PanelRecord[],
  layout: WorkspaceLayout,
  letters: string,
  spec: TubeSpec,
  look: TubeLook,
): void {
  const saved: Saved = { panels: [...panels], layout, letters, spec, look };
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // A full or blocked localStorage costs the arrangement, not the session.
  }
}

export function restore(): Restored | null {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const saved = JSON.parse(raw) as Saved;
      return {
        panels: Array.isArray(saved.panels) ? saved.panels : null,
        layout: saved.layout ?? {},
        letters: saved.letters,
        spec: saved.spec,
        look: isTubeLook(saved.look) ? saved.look : null,
      };
    } catch {
      localStorage.removeItem(KEY);
      return null;
    }
  }
  // A v1 save carries a windease store snapshot as its layout, which nothing here can read — but
  // its tuning is the part worth keeping, so the arrangement is dropped and the rest survives.
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!legacy) return null;
  try {
    const saved = JSON.parse(legacy) as Saved;
    // Deliberately left in place. A crash between reading it and the first v2 write would otherwise
    // take the tuning with it, and a stale v1 costs nothing once v2 exists to outrank it.
    return {
      panels: null,
      layout: {},
      letters: saved.letters,
      spec: saved.spec,
      look: isTubeLook(saved.look) ? saved.look : null,
    };
  } catch {
    localStorage.removeItem(LEGACY_KEY);
    return null;
  }
}

export function clear(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(LEGACY_KEY);
}
