import { describe, expect, it } from 'vitest';
import type { WordBuildContext } from '../../../src/render/decorations/registry.js';
import { decorationBuilderFor } from '../../../src/render/decorations/registry.js';

const ctx = {} as WordBuildContext;

describe('decorationBuilderFor', () => {
  it('has a factory registered for each shipped kind', () => {
    // Until Tasks 2 and 3 land, reaching the factory is the most that can be asserted — it
    // throws on construction rather than answering a builder.
    expect(() => decorationBuilderFor({ kind: 'chunks' } as never, ctx)).toThrow(
      'chunks builder not yet implemented',
    );
    expect(() => decorationBuilderFor({ kind: 'tube' } as never, ctx)).toThrow(
      'tube builder not yet implemented',
    );
  });

  it('answers null for no decoration at all', () => {
    expect(decorationBuilderFor(undefined, ctx)).toBeNull();
  });

  // A spec that reached here with a kind nobody registered is a wiring bug, and a silent null
  // would render an undecorated word rather than say so.
  it('throws on a kind nobody registered', () => {
    expect(() => decorationBuilderFor({ kind: 'well' } as never, ctx)).toThrow(/well/);
  });
});
