// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The one shipped artifact nothing else here reaches: it is bundled rather than compiled, so a
 * build mistake is invisible to the suite that runs against `src`. `npm run build -w klieg` has to
 * have run, which is why this file is outside `npm test` — see `vitest.dist.config.ts`.
 */
const DIR = join(import.meta.dirname, '..', 'dist', 'standalone');

/** `import 'x'`, `import('x')` and `… from 'x'`, however the bundle is minified. */
const SPECIFIER = /(?:\bfrom|\bimport\s*\(?)\s*(['"])([^'"]+)\1/g;

describe('the standalone bundle', () => {
  it('is the one file the subpath names', () => {
    expect(readdirSync(DIR)).toEqual(['klieg-sign.js']);
  });

  it('leaves no specifier a script tag would have to resolve', () => {
    const src = readFileSync(join(DIR, 'klieg-sign.js'), 'utf8');
    const bare = [...src.matchAll(SPECIFIER)]
      .map((match) => match[2] as string)
      .filter((spec) => !/^[./]|^[a-z][a-z0-9+.-]*:/i.test(spec));

    // The import below would still pass with `three` externalized, since a resolver finds it in
    // `node_modules`; only the file's own text tells self-contained from merely resolvable.
    expect(bare, 'three and opentype.js belong in the file, not in an import').toEqual([]);
  });

  it('registers the element on import alone', async () => {
    // @ts-expect-error the bundle ships no declarations, and typecheck runs before the build
    await import('../dist/standalone/klieg-sign.js');
    expect(customElements.get('klieg-sign')).toBeDefined();
  });
});
