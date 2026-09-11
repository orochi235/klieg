import type { LabPage } from '@weasel-js/labkit';

/** Every dev lab, in menu order. Each lab's vite config serves it on the port named here. */
export const LABS = {
  'tube-lab': { label: 'tube lab', port: 5181 },
  kliegsminister: { label: 'kliegsminister', port: 5182 },
  'composition-lab': { label: 'composition lab', port: 5183 },
} as const satisfies Record<string, { label: string; port: number }>;

export type LabId = keyof typeof LABS;

/** The part of `location` a sibling lab's address is built from. */
export interface Origin {
  protocol: string;
  hostname: string;
}

/**
 * Keeps the host the page was opened on, so a lab reached over 127.0.0.1, [::1] or the LAN links
 * to its siblings the same way. No trailing slash: labkit's `currentPage` strips one from the path
 * it matches against but not from the href, so a slash here would never match.
 */
export function labHref(id: LabId, origin: Origin = location): string {
  return `${origin.protocol}//${origin.hostname}:${LABS[id].port}`;
}

export function labPages(origin: Origin = location): LabPage[] {
  return (Object.keys(LABS) as LabId[]).map((id) => ({
    href: labHref(id, origin),
    label: LABS[id].label,
  }));
}
