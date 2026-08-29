import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { FlakeSpec } from '../../src/render/flake.js';
import {
  applyLook,
  COLOR_KEYS,
  createMaterial,
  DEFAULTS as DEFAULT_PARAMS,
  frameOwnedBase,
  LOOKS,
  type LookName,
  type LookParams,
  type LookSpec,
  lightBase,
  specOf,
  type TintTarget,
  tintMaterialOf,
  tintTargetOf,
} from '../../src/render/looks.js';

const KEY_SET: Record<keyof LookParams, true> = {
  color: true,
  metalness: true,
  roughness: true,
  clearcoat: true,
  clearcoatRoughness: true,
  transmission: true,
  thickness: true,
  ior: true,
  attenuationColor: true,
  attenuationDistance: true,
  iridescence: true,
  iridescenceIOR: true,
  iridescenceThicknessRange: true,
  sheen: true,
  sheenColor: true,
  sheenRoughness: true,
  anisotropy: true,
  anisotropyRotation: true,
  dispersion: true,
  emissive: true,
  emissiveIntensity: true,
  specularIntensity: true,
  specularColor: true,
  envMapIntensity: true,
};
const KEYS = Object.keys(KEY_SET) as (keyof LookParams)[];
const NAMES: LookName[] = [
  'gold',
  'chrome',
  'oil',
  'gem',
  'velvet',
  'neon',
  'flake',
  'glitter',
  'leather',
  'tubing',
  'piping',
  'sequin',
];

function snapshot(material: THREE.MeshPhysicalMaterial): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = material[key];
    out[key] = value instanceof THREE.Color ? value.getHex() : value;
  }
  return out;
}

function withLook(name: LookName): THREE.MeshPhysicalMaterial {
  const material = createMaterial();
  applyLook(material, name);
  return material;
}

describe('createMaterial', () => {
  it('is a physical material', () => {
    expect(createMaterial()).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  // Without an `envMap` of its own three overwrites the uniform with `scene.environmentIntensity`
  // every frame, which is how the authored 2.2 rendered at 1 for as long as it existed.
  it('carries the studio it is given, which is what lets a look set its own exposure', () => {
    const studio = new THREE.Texture();
    expect(createMaterial(studio).envMap).toBe(studio);
  });

  it('takes its exposure from the look rather than from construction', () => {
    const material = createMaterial(new THREE.Texture());
    applyLook(material, {});
    expect(material.envMapIntensity).toBe(2.2);
    applyLook(material, { envMapIntensity: 6 });
    expect(material.envMapIntensity).toBe(6);
  });
});

describe('LOOKS', () => {
  it('has an entry for every name in the union', () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...NAMES].sort());
  });

  it('turns clearcoat off for oil, since a coat above the thin film flattens it', () => {
    expect(withLook('oil').clearcoat).toBe(0);
    expect(withLook('oil').iridescence).toBe(1);
  });

  it('gives gem dispersion, which is what separates a stone from red glass', () => {
    expect(withLook('gem').dispersion).toBeGreaterThan(0);
  });

  it('gives velvet a sheen lobe and no clearcoat, since a coat flattens the nap', () => {
    const velvet = withLook('velvet');
    expect(velvet.sheen).toBe(1);
    expect(velvet.clearcoat).toBe(0);
    expect(velvet.metalness).toBe(0);
    expect(velvet.roughness).toBeGreaterThan(0.8);
  });

  it('has neon request bloom, which it is flat without', () => {
    expect(specOf('neon').bloom).toBe(true);
    expect(specOf('gold').bloom).toBeUndefined();
  });

  it('gives neon an emissive above the bloom threshold over a near-black base', () => {
    const neon = withLook('neon');
    expect(neon.emissive.getHex()).not.toBe(0x000000);
    expect(frameOwnedBase('neon').emissiveIntensity).toBeGreaterThan(1);
    expect(neon.clearcoat).toBe(0);
  });
});

describe('COLOR_KEYS', () => {
  it('names exactly the params three stores as Color objects', () => {
    const fresh = new THREE.MeshPhysicalMaterial();
    const colorValued = KEYS.filter((key) => fresh[key] instanceof THREE.Color);
    expect([...COLOR_KEYS].sort()).toEqual(colorValued.sort());
  });
});

describe('applyLook', () => {
  it('fills unspecified params from the defaults rather than leaving three own values', () => {
    const gold = withLook('gold');
    expect(gold.clearcoat).toBe(1);
    expect(gold.transmission).toBe(0);
    expect(gold.thickness).toBe(0);
    expect(gold.iridescence).toBe(0);
    expect(gold.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
  });

  it('resets every new channel from the defaults', () => {
    const gold = withLook('gold');
    expect(gold.sheen).toBe(0);
    expect(gold.sheenRoughness).toBe(1);
    expect(gold.sheenColor.getHex()).toBe(0xffffff);
    expect(gold.anisotropy).toBe(0);
    expect(gold.anisotropyRotation).toBe(0);
    expect(gold.dispersion).toBe(0);
    expect(gold.emissive.getHex()).toBe(0x000000);
  });

  it.each(NAMES)('%s applied over another look matches a fresh material', (name) => {
    const reused = createMaterial();
    for (const previous of NAMES) applyLook(reused, previous);
    applyLook(reused, name);

    expect(snapshot(reused)).toEqual(snapshot(withLook(name)));
  });

  it('leaves no transmission, thickness or attenuation behind when gem is replaced', () => {
    const material = withLook('gem');
    expect(material.transmission).toBe(1);
    expect(material.thickness).toBe(1.4);
    expect(material.attenuationDistance).toBe(0.6);

    applyLook(material, 'gold');
    expect(material.transmission).toBe(0);
    expect(material.thickness).toBe(0);
    expect(material.attenuationDistance).toBe(Number.POSITIVE_INFINITY);
    expect(material.attenuationColor.getHex()).toBe(0xffffff);
    expect(material.dispersion).toBe(0);
  });

  it('leaves no iridescence behind when oil is replaced', () => {
    const material = withLook('oil');
    applyLook(material, 'chrome');
    expect(material.iridescence).toBe(0);
    expect(material.iridescenceIOR).toBe(1.3);
    expect(material.iridescenceThicknessRange).toEqual([100, 400]);
    expect(material.clearcoat).toBe(1);
  });

  it('sets color-valued params through .set(), keeping the Color object', () => {
    const material = withLook('gem');
    expect(material.color).toBeInstanceOf(THREE.Color);
    expect(material.attenuationColor).toBeInstanceOf(THREE.Color);
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.attenuationColor.getHex()).toBe(0xd4143c);

    applyLook(material, 'gold');
    expect(material.color).toBeInstanceOf(THREE.Color);
    expect(material.color.getHex()).toBe(0xffc44d);
  });

  it('gives each material its own thickness range instead of sharing the module constant', () => {
    // Read off the spec rather than written out: this is about aliasing, and hardcoding the
    // numbers made re-tuning `oil` fail a test that has no opinion about how oil should look.
    const range = LOOKS.oil.iridescenceThicknessRange as [number, number];
    const a = withLook('oil');
    const b = withLook('oil');
    expect(a.iridescenceThicknessRange).toEqual(range);
    expect(a.iridescenceThicknessRange).not.toBe(b.iridescenceThicknessRange);

    a.iridescenceThicknessRange[1] = 999;
    expect(b.iridescenceThicknessRange[1]).toBe(range[1]);
    expect(withLook('oil').iridescenceThicknessRange[1]).toBe(range[1]);
  });

  it('marks the material for recompile, since transmission and iridescence change the program', () => {
    const material = createMaterial();
    const before = material.version;
    applyLook(material, 'gem');
    expect(material.version).toBeGreaterThan(before);
  });

  it('leaves opacity off the material, because Word owns it per frame', () => {
    const material = createMaterial();

    applyLook(material, { opacity: 0.2 });

    expect(material.opacity).toBe(1);
  });

  it('leaves emissiveIntensity off the material, because Word owns it per frame', () => {
    const material = createMaterial();

    applyLook(material, 'neon');

    // three's own default, not neon's 3.2: the value reaches the material through Word.
    expect(material.emissiveIntensity).toBe(1);
    // Everything else still lands, so this is an ownership split and not a dropped write.
    expect(material.emissive.getHex()).not.toBe(0x000000);
  });
});

describe('flake looks', () => {
  it('keeps flake and glitter distinguishable rather than two names for one look', () => {
    const flake = specOf('flake').flake as FlakeSpec;
    const glitter = specOf('glitter').flake as FlakeSpec;

    expect(flake.size).not.toBe(glitter.size);
    expect(flake.spread).toBeGreaterThan(glitter.spread);
  });

  it('keeps sparkling cells tiny, or they read as grit suspended in the letter', () => {
    for (const name of ['flake', 'glitter'] as const) {
      const spec = specOf(name).flake as FlakeSpec;
      expect(spec.size, name).toBeLessThan(0.02);
    }
  });

  it('gives leather panels far larger than any flake, being upholstery rather than sparkle', () => {
    const leather = specOf('leather').flake as FlakeSpec;
    const flake = specOf('flake').flake as FlakeSpec;

    expect(leather.size).toBeGreaterThan(flake.size * 5);
    expect(leather.bump).toBe(true);
  });

  it('makes leather the only one with rounded cells rather than facets', () => {
    expect((specOf('leather').flake as FlakeSpec).bump).toBe(true);
    expect((specOf('flake').flake as FlakeSpec).bump).toBeUndefined();
    expect((specOf('glitter').flake as FlakeSpec).bump).toBeUndefined();
  });

  it('disables the flake uniforms for a look that declares none', () => {
    const material = createMaterial();
    applyLook(material, 'glitter');
    expect(material.userData.flake.uFlakeDensity.value).toBeGreaterThan(0);

    applyLook(material, 'gold');
    expect(material.userData.flake.uFlakeDensity.value).toBe(0);
  });
});

describe('decorated looks', () => {
  it('orders every look name', () => {
    expect(Object.keys(LOOKS)).toEqual([
      'gold',
      'chrome',
      'oil',
      'gem',
      'velvet',
      'neon',
      'flake',
      'glitter',
      'leather',
      'tubing',
      'piping',
      'sequin',
    ]);
  });

  it('builds tubing and piping from the tube generator', () => {
    for (const name of ['tubing', 'piping'] as const) {
      expect(specOf(name).decoration?.kind).toBe('tube');
    }
  });

  it('builds sequin from the chunks generator', () => {
    expect(specOf('sequin').decoration?.kind).toBe('chunks');
  });

  it('makes tubing a glowing tube over a near-invisible body', () => {
    const spec = specOf('tubing');

    expect(spec.opacity).toBeLessThan(0.2);
    expect(spec.bloom).toBe(true);
    expect(spec.tintTo).toBe('decoration');
  });

  it('keeps piping tinting the hide, not the cord', () => {
    expect(tintMaterialOf(specOf('piping'))).toBe('body');
  });

  it('keeps the lit tube at its own declared emissive intensity', () => {
    const decoration = specOf('tubing').decoration;
    if (decoration?.kind !== 'tube') throw new Error('tubing lost its tube decoration');
    expect(frameOwnedBase(decoration.look).emissiveIntensity).toBe(3.4);
  });

  it('gives tubing dark glass its own look rather than a copy of the lit one', () => {
    const decoration = specOf('tubing').decoration;
    if (decoration?.kind !== 'tube') throw new Error('not a tube');

    expect(decoration.dark.color).not.toBe(decoration.look.color);
    expect(decoration.dark.emissiveIntensity ?? 0).toBeLessThan(
      decoration.look.emissiveIntensity ?? 0,
    );
    // Lightly lit, so an unlit run reads as present glass rather than a gap.
    expect(decoration.select.amount).toBeLessThan(1);
  });

  it('keeps piping continuous around corners, with its cord proud of the seam', () => {
    const decoration = specOf('piping').decoration;
    if (decoration?.kind !== 'tube') throw new Error('not a tube');

    expect(decoration.runs).toBe(1);
    expect(decoration.corners).toEqual({ break: 0, connect: 1 });
    expect(decoration.level).toBeLessThan(0);
    expect(decoration.level).toBeGreaterThan(-decoration.radius);
  });

  it('sews sequin flat to the surface rather than sprinkling it on', () => {
    const sequin = specOf('sequin').decoration;
    if (sequin?.kind !== 'chunks') throw new Error('not chunks');

    expect(sequin.shape).toBe('disc');
    // Mostly flat, and off a whole letter's shared lattice, which is the orientation align can give.
    expect(sequin.lie as number).toBeGreaterThan(0.7);
    expect(sequin.align).toBe(0);
    // Sewn on, not stood off: proud is in chunk edges, so a third of one was a third of a disc.
    expect(sequin.proud).toBeLessThan(0.1);
    // Rows, at a spacing, rather than a scatter that clumps.
    expect(sequin.bedding?.pitch).toBeGreaterThan(0);
  });
});

describe('LookSpec', () => {
  it('applies a caller spec the same way a built-in name is applied', () => {
    const material = createMaterial();
    applyLook(material, { metalness: 1, roughness: 0.5, color: 0x00ff00 });

    expect(material.metalness).toBe(1);
    expect(material.roughness).toBe(0.5);
    expect(material.color.getHex()).toBe(0x00ff00);
  });

  it('fills the rest of a spec from the defaults', () => {
    const material = createMaterial();
    applyLook(material, { metalness: 1 });

    expect(material.clearcoat).toBe(1);
    expect(material.transmission).toBe(0);
    expect(material.sheen).toBe(0);
  });

  it('clamps an out-of-range value rather than throwing mid-effect', () => {
    const material = createMaterial();
    applyLook(material, { roughness: 40, metalness: -3 });

    expect(material.roughness).toBe(1);
    expect(material.metalness).toBe(0);
  });

  it('ignores a key that is not a material param', () => {
    const material = createMaterial();
    expect(() =>
      applyLook(material, { metalness: 1, nonsense: 7 } as unknown as LookSpec),
    ).not.toThrow();
    expect(material.metalness).toBe(1);
  });

  it('honors a declared tint target on a spec', () => {
    const material = createMaterial();
    applyLook(material, { sheen: 1, tintTarget: 'sheenColor' }, 0x00ff00);

    expect(material.sheenColor.getHex()).toBe(0x00ff00);
    expect(material.color.getHex()).toBe(0xffffff);
  });
});

describe('tintTargetOf', () => {
  it('routes a transmissive look to attenuation, where its hue actually lives', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, transmission: 1 })).toBe('attenuationColor');
  });

  it('routes an emissive look to its emissive', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, emissive: 0xff2d95 })).toBe('emissive');
  });

  it('routes everything else to the base color', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, metalness: 1 })).toBe('color');
  });

  it('never infers sheenColor: a velvet reads by its body, not its highlight', () => {
    expect(tintTargetOf({ ...DEFAULT_PARAMS, sheen: 1 })).toBe('color');
  });

  it('lets a declared target win over every inference', () => {
    const declared: TintTarget = 'sheenColor';
    expect(tintTargetOf({ ...DEFAULT_PARAMS, transmission: 1 }, declared)).toBe('sheenColor');
  });
});

describe('tintMaterialOf', () => {
  it('routes a tint to the body by default', () => {
    expect(tintMaterialOf({ color: 0x112233 })).toBe('body');
  });

  it('routes a tint to the decoration when the look says so', () => {
    const spec: LookSpec = {
      tintTo: 'decoration',
      decoration: {
        kind: 'tube',
        radius: 0.04,
        segments: 8,
        spacing: 0.02,
        surfaces: ['front'],
        level: 0,
        runs: 4,
        minRun: 0.05,
        select: { by: 'seed', amount: 1 },
        colors: [0xffffff],
        look: {},
        dark: {},
      },
    };

    expect(tintMaterialOf(spec)).toBe('decoration');
  });

  it('ignores tintTo on a look with no decoration', () => {
    expect(tintMaterialOf({ tintTo: 'decoration' })).toBe('body');
  });

  it('keeps a decorated look on the body when it says so outright', () => {
    const spec: LookSpec = {
      tintTo: 'body',
      decoration: {
        kind: 'tube',
        radius: 0.04,
        segments: 8,
        spacing: 0.02,
        surfaces: ['front'],
        level: 0,
        runs: 4,
        minRun: 0.05,
        select: { by: 'seed', amount: 1 },
        colors: [0xffffff],
        look: {},
        dark: {},
      },
    };

    expect(tintMaterialOf(spec)).toBe('body');
  });
});

describe('tint', () => {
  const hex = (c: THREE.Color) => c.getHex();

  it('recolors a metal through its base color', () => {
    const material = createMaterial();
    applyLook(material, 'gold', 0xff2d6f);

    expect(hex(material.color)).toBe(0xff2d6f);
  });

  it('recolors gem through attenuation, which is where its hue actually lives', () => {
    const material = createMaterial();
    applyLook(material, 'gem', 0x2dff8f);

    expect(hex(material.attenuationColor)).toBe(0x2dff8f);
    // Clear glass: tinting the base color instead would have changed nothing visible.
    expect(hex(material.color)).toBe(0xffffff);
  });

  it('leaves every look untinted by default', () => {
    for (const name of Object.keys(LOOKS) as LookName[]) {
      const tinted = createMaterial();
      const plain = createMaterial();
      applyLook(tinted, name);
      applyLook(plain, name);

      expect(hex(tinted.color), name).toBe(hex(plain.color));
      expect(hex(tinted.attenuationColor), name).toBe(hex(plain.attenuationColor));
      expect(hex(tinted.emissive), name).toBe(hex(plain.emissive));
    }
  });

  it('changes exactly one channel, whichever carries the hue', () => {
    for (const name of Object.keys(LOOKS) as LookName[]) {
      const plain = createMaterial();
      const tinted = createMaterial();
      applyLook(plain, name);
      applyLook(tinted, name, 0x123456);

      const moved = [
        hex(plain.color) !== hex(tinted.color),
        hex(plain.attenuationColor) !== hex(tinted.attenuationColor),
        hex(plain.emissive) !== hex(tinted.emissive),
      ].filter(Boolean);

      expect(moved, name).toHaveLength(1);
    }
  });

  it('touches nothing but the hue', () => {
    const plain = createMaterial();
    const tinted = createMaterial();
    applyLook(plain, 'oil');
    applyLook(tinted, 'oil', 0x00ff00);

    expect(tinted.metalness).toBe(plain.metalness);
    expect(tinted.roughness).toBe(plain.roughness);
    expect(tinted.iridescence).toBe(plain.iridescence);
    expect(tinted.clearcoat).toBe(plain.clearcoat);
  });

  it('goes through .set() rather than replacing the Color object', () => {
    const material = createMaterial();
    const before = material.color;

    applyLook(material, 'gold', 0xff2d6f);

    // Replacing it with a number leaves a material that silently stops working.
    expect(material.color).toBe(before);
    expect(material.color).toBeInstanceOf(THREE.Color);
  });

  it('does not leak a tint into the next look applied to the same material', () => {
    const material = createMaterial();
    applyLook(material, 'gold', 0xff2d6f);
    applyLook(material, 'gold');

    expect(hex(material.color)).toBe(0xffc44d);
  });
});

describe('frameOwnedBase', () => {
  it("carries a look's own declared values", () => {
    expect(frameOwnedBase('neon')).toEqual({ opacity: 1, emissiveIntensity: 3.2 });
    expect(frameOwnedBase('tubing')).toEqual({ opacity: 0.08, emissiveIntensity: 1 });
  });

  it('falls back to the defaults when a look declares neither', () => {
    expect(frameOwnedBase('gold')).toEqual({ opacity: 1, emissiveIntensity: 1 });
  });

  it('reads opacity, which is not a LookKey', () => {
    expect(frameOwnedBase({ opacity: 0.08 }).opacity).toBe(0.08);
  });

  it('clamps a negative emissiveIntensity rather than passing it through', () => {
    expect(frameOwnedBase({ emissiveIntensity: -5 }).emissiveIntensity).toBe(0);
  });

  it('clamps opacity to 0..1, which resolveParams never sees', () => {
    expect(frameOwnedBase({ opacity: 5 }).opacity).toBe(1);
    expect(frameOwnedBase({ opacity: -1 }).opacity).toBe(0);
  });
});

describe('lightBase', () => {
  it('reads a plain look off its colour', () => {
    expect(lightBase('gold').hue).toBe(0xffc44d);
  });

  // gem is clear stone at color 0xffffff; its red is what light picks up passing through it.
  it('reads a transmissive look off its attenuation', () => {
    expect(lightBase('gem').hue).toBe(LOOKS.gem.attenuationColor);
  });

  it('reads an emissive look off its emissive', () => {
    expect(lightBase('neon').hue).toBe(LOOKS.neon.emissive);
  });

  it('carries the base emissive a lamp adds onto', () => {
    expect(lightBase('gold').emissive).toBe(0x000000);
    expect(lightBase('neon').emissive).toBe(LOOKS.neon.emissive);
  });

  it('honours a declared tintTarget over the inferred one', () => {
    expect(lightBase({ color: 0x112233, sheenColor: 0x445566, tintTarget: 'sheenColor' }).hue).toBe(
      0x445566,
    );
  });

  it('reads the tint the material was actually built with', () => {
    expect(lightBase('gold', 0xff2d6f)).toEqual({ emissive: 0x000000, hue: 0xff2d6f });
  });

  // A tinted neon's emissive IS the tint; reading the look's own would reset it every frame.
  it('moves the base emissive too when the tint landed on it', () => {
    expect(lightBase('neon', 0xff2d6f)).toEqual({ emissive: 0xff2d6f, hue: 0xff2d6f });
  });

  it('falls back to the defaults for a look that declares no colour', () => {
    expect(lightBase({ metalness: 1 })).toEqual({ emissive: 0x000000, hue: 0xffffff });
  });
});
