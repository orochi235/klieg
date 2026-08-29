#!/usr/bin/env node
// Downloads catalogue faces into apps/lab/public/fonts and writes the manifest the picker
// reads. Run after adding an entry to apps/lab/src/fonts/catalog.ts:
//
//   node scripts/fonts.mjs            # every seeded face
//   node scripts/fonts.mjs rye anton  # or just these, seeded or not
//
// One .ttf per face rather than the WOFF2 Google serves a browser: opentype.js cannot read
// WOFF2 without a Brotli decompressor, and klieg parses the same binary the page paints from.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = join(root, 'apps', 'lab', 'public', 'fonts');
const licenseDir = join(fontDir, 'licenses');
const catalogPath = join(root, 'apps', 'lab', 'src', 'fonts', 'catalog.ts');

/** The catalogue, read as source: this script must not need the lab to build. */
async function readCatalog() {
  const source = await readFile(catalogPath, 'utf8');
  const body = source.slice(source.indexOf('export const CATALOG'), source.indexOf('CLASS_NAMES'));
  return [...body.matchAll(/\{\s*id:\s*'([^']+)'[^}]*google:\s*'([^']+)'([^}]*)\}/g)].map((m) => ({
    id: m[1],
    google: m[2],
    seeded: m[3].includes('seeded: true'),
  }));
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

/**
 * No browser user-agent, which is what makes the API answer with one truetype file for the
 * whole charset instead of a stack of unicode-range WOFF2 subsets.
 */
async function ttfUrl(google) {
  const css = await fetchText(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(google)}`,
  );
  const url = css.match(/https:\/\/[^)]*\.ttf/)?.[0];
  if (!url) throw new Error(`no truetype source for ${google}`);
  return url;
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(path, bytes);
  return bytes.length;
}

/** OFL, with the two other trees Google files a family under as fallbacks. */
async function license(id, google) {
  const slug = google.toLowerCase().replaceAll(' ', '');
  for (const tree of ['ofl', 'apache', 'ufl']) {
    const name = tree === 'apache' ? 'LICENSE.txt' : tree === 'ufl' ? 'UFL.txt' : 'OFL.txt';
    const url = `https://raw.githubusercontent.com/google/fonts/main/${tree}/${slug}/${name}`;
    const response = await fetch(url);
    if (response.ok) {
      await writeFile(join(licenseDir, `${id}.txt`), await response.text());
      return tree;
    }
  }
  throw new Error(`no license found for ${google}`);
}

const wanted = process.argv.slice(2);
const catalog = await readCatalog();
const fonts =
  wanted.length > 0
    ? catalog.filter((font) => wanted.includes(font.id))
    : catalog.filter((font) => font.seeded);

if (fonts.length === 0) throw new Error(`nothing to fetch; catalogue holds ${catalog.length}`);
await mkdir(licenseDir, { recursive: true });

let total = 0;
for (const [index, font] of fonts.entries()) {
  const position = `${index + 1}/${fonts.length}`;
  try {
    const url = await ttfUrl(font.google);
    const bytes = await download(url, join(fontDir, `${font.id}.ttf`));
    const tree = await license(font.id, font.google);
    total += bytes;
    console.log(`${position} ${font.id} ${(bytes / 1024).toFixed(0)}KB ${tree}`);
  } catch (error) {
    console.log(`${position} ${font.id} FAILED ${error.message}`);
    process.exitCode = 1;
  }
}

// What is actually on disk, which is what the picker may offer.
const onDisk = (await readdir(fontDir))
  .filter((name) => name.endsWith('.ttf'))
  .map((name) => name.slice(0, -4))
  .sort();
await writeFile(join(fontDir, 'manifest.json'), `${JSON.stringify(onDisk, null, 2)}\n`);
console.log(`${(total / 1024 / 1024).toFixed(1)}MB, ${onDisk.length} faces on disk`);
