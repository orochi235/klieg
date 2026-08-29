// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTint } from '../../src/sign/tint.js';

let anchor: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  anchor = document.createElement('h1');
  document.body.appendChild(anchor);
});

describe('resolveTint', () => {
  it('passes a number through untouched', () => {
    expect(resolveTint(anchor, 0x22d3ee)).toBe(0x22d3ee);
  });

  it('returns undefined for no tint at all', () => {
    expect(resolveTint(anchor, undefined)).toBeUndefined();
  });

  it('packs a hex color into a klieg tint', () => {
    expect(resolveTint(anchor, '#22d3ee')).toBe(0x22d3ee);
  });

  it('packs a named color', () => {
    expect(resolveTint(anchor, 'red')).toBe(0xff0000);
  });

  it('resolves currentColor through the cascade', () => {
    anchor.style.color = 'rgb(4, 5, 6)';
    expect(resolveTint(anchor, 'currentColor')).toBe(0x040506);
  });

  it('leaves the anchor exactly as it found it', () => {
    const before = anchor.innerHTML;
    resolveTint(anchor, '#123456');
    expect(anchor.innerHTML).toBe(before);
    expect(anchor.children).toHaveLength(0);
  });

  it('returns undefined rather than a wrong color for something unparseable', () => {
    expect(resolveTint(anchor, 'not-a-color')).toBeUndefined();
    expect(anchor.children).toHaveLength(0);
  });

  it('treats a fully transparent tint as no tint', () => {
    expect(resolveTint(anchor, 'transparent')).toBeUndefined();
  });
});
