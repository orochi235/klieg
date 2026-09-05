import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mergeNonIndexed } from '../../../src/render/wells/merge.js';

describe('mergeNonIndexed', () => {
  it('concatenates positions and keeps the attribute triple', () => {
    const a = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const merged = mergeNonIndexed([a, b]);
    const one = a.getAttribute('position') as THREE.BufferAttribute;
    expect((merged.getAttribute('position') as THREE.BufferAttribute).count).toBe(one.count * 2);
    expect((merged.getAttribute('position') as THREE.BufferAttribute).itemSize).toBe(3);
  });

  it('refuses an indexed part rather than dropping its index', () => {
    expect(() => mergeNonIndexed([new THREE.BoxGeometry(1, 1, 1)])).toThrow(/indexed/);
  });
});
