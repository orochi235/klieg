import path from 'node:path';
import type { Plugin, UserConfig } from 'vite';

/**
 * `WEASEL=<checkout>` serves every `@weasel-js` import from that weasel checkout's built packages
 * instead of the pinned ones, for trying an unreleased labkit before klieg can pin it. The checkout
 * needs a build. Everything is taken from it at once, because its labkit is built against its own
 * core. React and three stay klieg's, since a second copy of either breaks context and `instanceof`.
 */
export function weaselCheckout(): Pick<
  UserConfig,
  'plugins' | 'resolve' | 'server' | 'optimizeDeps'
> {
  const root = process.env.WEASEL;
  if (!root) return {};
  const checkout = path.resolve(root);
  // Vite resolves a bare import from the importer's directory only when that file exists.
  const importer = path.join(checkout, 'package.json');
  const plugin: Plugin = {
    name: 'klieg:weasel-checkout',
    enforce: 'pre',
    resolveId(id, _from, options) {
      if (!id.startsWith('@weasel-js/')) return null;
      return this.resolve(id, importer, { ...options, skipSelf: true });
    },
  };
  return {
    plugins: [plugin],
    resolve: { dedupe: ['react', 'react-dom', 'three'] },
    // The prebundle cache does not key on where a package resolved, so a switch serves the old one.
    optimizeDeps: { force: true },
    server: { fs: { allow: [checkout, path.resolve(import.meta.dirname, '../../../..')] } },
  };
}
