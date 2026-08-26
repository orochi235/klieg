// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

describe('the jsdom environment', () => {
  it('has a document, custom elements and computed style', () => {
    expect(typeof document.createElement).toBe('function');
    expect(typeof customElements.define).toBe('function');
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(getComputedStyle(el)).toBeTruthy();
  });
});
