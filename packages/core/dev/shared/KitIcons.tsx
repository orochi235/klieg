import { IconRegistryProvider } from '@weasel-js/core';
import { kitIcons } from '@weasel-js/ui/kit-icons';
import type { ReactNode } from 'react';

/** weasel's own icons. A lab mounts them itself: labkit's chrome draws them but registers none. */
export function KitIcons({ children }: { children: ReactNode }) {
  return <IconRegistryProvider icons={kitIcons}>{children}</IconRegistryProvider>;
}
