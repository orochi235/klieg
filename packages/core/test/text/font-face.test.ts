import { describe, expect, it } from 'vitest';
import { familyFor } from '../../src/text/font-face.js';

describe('familyFor', () => {
  it('is stable for one url', () => {
    expect(familyFor('/fonts/anton.woff2')).toBe(familyFor('/fonts/anton.woff2'));
  });

  it('separates two fonts', () => {
    expect(familyFor('/fonts/anton.woff2')).not.toBe(familyFor('/fonts/bebas.woff2'));
  });

  it('is a bare CSS identifier, so it needs no quoting in a font-family', () => {
    expect(familyFor('/fonts/Anton Regular (1).woff2')).toMatch(/^klieg-[a-z0-9]+$/);
  });
});
