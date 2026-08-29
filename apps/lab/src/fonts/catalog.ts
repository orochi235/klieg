/** What groups the picker. Not a style claim beyond that. */
export type FontClass = 'display' | 'woodtype' | 'serif' | 'sans' | 'script';

export interface CatalogFont {
  id: string;
  /** As the face calls itself. */
  name: string;
  class: FontClass;
  /** The family as the Google Fonts API spells it, for `scripts/fonts.mjs`. */
  google: string;
  /** Committed to the repo, and so servable without running the script first. */
  seeded?: boolean;
}

/**
 * Every face the lab can set type in, whether or not its binary is here. Eight are committed;
 * the rest are one `node scripts/fonts.mjs <id>` away. The picker offers what
 * `public/fonts/manifest.json` says is on disk, so an unseeded entry is an invitation rather
 * than a 404.
 */
export const CATALOG: CatalogFont[] = [
  { id: 'anton', name: 'Anton', class: 'display', google: 'Anton', seeded: true },
  { id: 'oswald', name: 'Oswald', class: 'display', google: 'Oswald' },
  { id: 'bebas-neue', name: 'Bebas Neue', class: 'display', google: 'Bebas Neue', seeded: true },
  { id: 'black-ops-one', name: 'Black Ops One', class: 'display', google: 'Black Ops One', seeded: true },
  { id: 'gravitas-one', name: 'Gravitas One', class: 'display', google: 'Gravitas One' },
  { id: 'abril-fatface', name: 'Abril Fatface', class: 'display', google: 'Abril Fatface', seeded: true },
  { id: 'righteous', name: 'Righteous', class: 'display', google: 'Righteous' },
  { id: 'geologica', name: 'Geologica', class: 'display', google: 'Geologica' },
  { id: 'press-start-2p', name: 'Press Start 2P', class: 'display', google: 'Press Start 2P' },
  { id: 'luckiest-guy', name: 'Luckiest Guy', class: 'display', google: 'Luckiest Guy' },
  { id: 'archivo-black', name: 'Archivo Black', class: 'display', google: 'Archivo Black' },
  { id: 'changa-one', name: 'Changa One', class: 'display', google: 'Changa One' },
  { id: 'limelight', name: 'Limelight', class: 'display', google: 'Limelight' },
  { id: 'monoton', name: 'Monoton', class: 'display', google: 'Monoton', seeded: true },
  { id: 'special-elite', name: 'Special Elite', class: 'display', google: 'Special Elite' },
  { id: 'pirata-one', name: 'Pirata One', class: 'display', google: 'Pirata One' },
  { id: 'jersey-25', name: 'Jersey 25', class: 'display', google: 'Jersey 25' },
  { id: 'asset', name: 'Asset', class: 'display', google: 'Asset' },

  { id: 'rye', name: 'Rye', class: 'woodtype', google: 'Rye', seeded: true },
  { id: 'bevan', name: 'Bevan', class: 'woodtype', google: 'Bevan' },
  { id: 'alfa-slab-one', name: 'Alfa Slab One', class: 'woodtype', google: 'Alfa Slab One' },
  { id: 'goblin-one', name: 'Goblin One', class: 'woodtype', google: 'Goblin One' },
  { id: 'croissant-one', name: 'Croissant One', class: 'woodtype', google: 'Croissant One' },

  { id: 'cinzel', name: 'Cinzel', class: 'serif', google: 'Cinzel', seeded: true },
  { id: 'bodoni-moda', name: 'Bodoni Moda', class: 'serif', google: 'Bodoni Moda' },
  { id: 'playfair-display', name: 'Playfair Display', class: 'serif', google: 'Playfair Display' },

  { id: 'overpass', name: 'Overpass', class: 'sans', google: 'Overpass' },

  { id: 'lobster', name: 'Lobster', class: 'script', google: 'Lobster', seeded: true },
  { id: 'shadows-into-light', name: 'Shadows Into Light', class: 'script', google: 'Shadows Into Light' },
  { id: 'satisfy', name: 'Satisfy', class: 'script', google: 'Satisfy' },
  { id: 'permanent-marker', name: 'Permanent Marker', class: 'script', google: 'Permanent Marker' },
  { id: 'great-vibes', name: 'Great Vibes', class: 'script', google: 'Great Vibes' },
  { id: 'eagle-lake', name: 'Eagle Lake', class: 'script', google: 'Eagle Lake' },
];

export const CLASS_NAMES: Record<FontClass, string> = {
  display: 'Display',
  woodtype: 'Woodtype and slab',
  serif: 'Serif',
  sans: 'Sans',
  script: 'Script',
};
