import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Filled } from '../../../src/render/wells/fills.js';
import { fillFor, registerFill } from '../../../src/render/wells/fills.js';

const stub = (): Filled => ({
  geometry: new THREE.BufferGeometry(),
  matrices: [],
  material: new THREE.MeshPhysicalMaterial(),
});

describe('the fill registry', () => {
  it('answers a fill by the name it was registered under', () => {
    const fill = () => stub();
    registerFill('test-glitter', fill);
    expect(fillFor('test-glitter')).toBe(fill);
  });

  it('refuses a fill nobody registered, naming it', () => {
    expect(() => fillFor('nacre')).toThrow("no well fill registered for 'nacre'");
  });
});
