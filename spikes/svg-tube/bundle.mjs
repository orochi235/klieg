/**
 * Bundle this lab into one HTML file that opens from disk with no server.
 *
 *   node spikes/svg-tube/bundle.mjs [--out <path.html>]
 *
 * The art beside it is inlined as a data URI, so the output carries whatever `art.svg` is — which
 * is why `--out` must land outside this repo, and why the script refuses a path inside it.
 * Build `packages/core` first (`npm run typecheck`): the lab imports its `dist`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = execFileSync('git', ['-C', here, 'rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const flag = process.argv.indexOf('--out');
const out = path.resolve(
  flag === -1 ? path.join(homedir(), 'Desktop', 'klieg-tube-lab.html') : process.argv[flag + 1],
);
if (!path.relative(repo, out).startsWith('..')) {
  throw new Error(`${out} is inside ${repo} — the bundle carries the art, so it stays out of the repo`);
}

const staging = mkdtempSync(path.join(tmpdir(), 'klieg-bundle-'));
try {
  await build({
    root: here,
    logLevel: 'warn',
    build: {
      outDir: staging,
      emptyOutDir: true,
      target: 'esnext',
      cssCodeSplit: false,
      assetsInlineLimit: Number.POSITIVE_INFINITY,
    },
  });

  const dist = path.join(staging, 'assets');
  const asset = (ext) => {
    const name = readdirSync(dist).find((f) => f.endsWith(ext));
    if (!name) throw new Error(`the build emitted no ${ext}`);
    return readFileSync(path.join(dist, name), 'utf8');
  };

  const art = readFileSync(path.join(here, 'art.svg'));
  const uri = `data:image/svg+xml;base64,${art.toString('base64')}`;
  // A bundled string containing this sequence would close the tag it is sitting in.
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

  // Injected here rather than into `index.html` so the address ships with the file that gets
  // handed out, and never lands in this public repo. It is DOM, so it stays out of the PNG.
  const footer =
    '<style>#feedback{position:fixed;left:0;right:0;bottom:0;z-index:2;text-align:center;' +
    'padding:6px 12px;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#6b7684;' +
    'background:#11141cd9;border-top:1px solid #232838}' +
    '#feedback a{color:#9aa4b2}</style>' +
    '<div id="feedback">please send feedback and bug reports to ' +
    '<a href="mailto:michael.baker@pointwild.com">michael.baker@pointwild.com</a></div>';

  // The page's CSS is already inline in `index.html`; only the entry chunk is emitted as a file.
  const shell = readFileSync(path.join(staging, 'index.html'), 'utf8');
  const tag = /<script type="module"[^>]*><\/script>\s*/;
  if (!tag.test(shell)) throw new Error('the built HTML has no module script to inline');
  const html =
    `${shell.replace(tag, '')}\n${footer}\n` +
    `<script>globalThis.__KLIEG_ART__ = ${JSON.stringify(uri)};</script>\n` +
    `<script type="module">${safe(asset('.js'))}</script>\n`;

  writeFileSync(out, html);
  console.log(`${out} · ${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
