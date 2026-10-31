import { RESCUE_LADDER } from '@core/render/tube/contours.js';
import type {
  ContourPolicy,
  CornerWeights,
  GradientSpec,
  PathSource,
  SurfaceKind,
  TubeSpec,
} from '@core/render/tube/index.js';

/** The three kinds `surfacesOf` actually produces, in canonical order. */
export const SURFACE_KINDS = ['front', 'back', 'wall'] as const satisfies readonly SurfaceKind[];

/** Every layer a run color can be set for: the surfaces, plus connectors. */
export const LAYERS: readonly SurfaceKind[] = [...SURFACE_KINDS, 'connector'];

/** The domains, plus the `off` the spec spells as no `gradient` field at all. */
export const GRADIENT_DOMAINS = [
  'off',
  'run',
  'letter',
  'runIndex',
  'surface',
  'axis',
  'radial',
] as const;
type GradientChoice = (typeof GRADIENT_DOMAINS)[number];

/** What a sweep switched on from `off` starts with, and what a raised count seeds a new stop from. */
const GRADIENT_STOPS = [0xff2d95, 0x2de0ff, 0xffd14a];
export const STOP_COUNT = GRADIENT_STOPS.length;

/** The spec fields the rail writes straight through, each a number in `TubeSpec`. */
const PLAIN = [
  'radius',
  'bend',
  'segments',
  'spacing',
  'level',
  'blockout',
  'runs',
  'minRun',
  'amplitude',
  'wallDepth',
  'wallRise',
  'connectors',
  'connectorOvershoot',
] as const;
type PlainKey = (typeof PLAIN)[number];

export function hex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function unhex(value: unknown): number {
  return typeof value === 'string' ? Number.parseInt(value.slice(1, 7), 16) : 0xffffff;
}

/** The one meaningful number behind two weights: 1 is every corner breaking, 0 every corner bending. */
function cornerMix(weights: CornerWeights): number {
  const total = weights.break + weights.connect;
  return total > 0 ? weights.break / total : 1;
}

function stopsOf(spec: TubeSpec): number[] {
  return spec.gradient?.stops ?? GRADIENT_STOPS.slice(0, 2);
}

/** `spec` as the rail's config: what each row reads, with the builder's defaults for unset fields. */
export function specValues(spec: TubeSpec): Record<string, unknown> {
  const counter = spec.contours?.counter ?? {};
  const gradient = spec.gradient;
  const stops = stopsOf(spec);
  const run = spec.colors[0] ?? 0xffffff;
  return {
    radius: spec.radius,
    bend: spec.bend ?? 2,
    segments: spec.segments,
    spacing: spec.spacing,
    level: spec.level,
    blockout: spec.blockout ?? 0,
    runs: spec.runs,
    minRun: spec.minRun,
    amplitude: spec.amplitude ?? 0,
    wallDepth: spec.wallDepth ?? 0.5,
    wallRise: spec.wallRise ?? 0,
    select: { amount: spec.select.amount ?? 1 },
    cornerMix: cornerMix(spec.corners ?? { break: 1, connect: 0 }),
    pathSource: spec.pathSource ?? 'direct',
    ...Object.fromEntries(SURFACE_KINDS.map((kind) => [kind, spec.surfaces.includes(kind)])),
    connectors: spec.connectors ?? 0,
    connectorOvershoot: spec.connectorOvershoot ?? 0.05,
    look: {
      emissive: hex(spec.look.emissive ?? 0xffffff),
      emissiveIntensity: spec.look.emissiveIntensity ?? 0,
      rim: spec.look.rim ?? 0,
    },
    runColor: hex(run),
    ...Object.fromEntries(
      LAYERS.map((kind) => [`${kind}Color`, hex(spec.surfaceColors?.[kind]?.[0] ?? run)]),
    ),
    rescue: Boolean(counter.rescue?.length),
    floor: counter.floor ?? 0.5,
    oneLit: counter.lit === 'one',
    domain: gradient?.domain.of ?? 'off',
    mode: gradient?.mode ?? 'replace',
    angle: gradient?.domain.of === 'axis' ? (gradient.domain.angle ?? 0) : 0,
    stopCount: stops.length,
    ...Object.fromEntries(GRADIENT_STOPS.map((seed, i) => [`stop${i + 1}`, hex(stops[i] ?? seed)])),
  };
}

function withGradient(spec: TubeSpec, next: GradientSpec | null): TubeSpec {
  const { gradient: _off, ...rest } = spec;
  return next ? { ...rest, gradient: next } : rest;
}

function withCounter(spec: TubeSpec, part: ContourPolicy): TubeSpec {
  const counter = spec.contours?.counter ?? {};
  return { ...spec, contours: { ...spec.contours, counter: { ...counter, ...part } } };
}

function withGradientPart(spec: TubeSpec, path: string, value: unknown): TubeSpec {
  const gradient = spec.gradient;
  if (path === 'domain') {
    const choice = value as GradientChoice;
    if (choice === 'off') return withGradient(spec, null);
    return withGradient(spec, {
      domain: { of: choice },
      stops: stopsOf(spec),
      mode: gradient?.mode ?? 'replace',
    });
  }
  if (!gradient) return spec;
  if (path === 'mode')
    return withGradient(spec, { ...gradient, mode: value as GradientSpec['mode'] });
  if (path === 'angle') {
    return withGradient(spec, { ...gradient, domain: { of: 'axis', angle: value as number } });
  }
  const stops = stopsOf(spec);
  if (path === 'stopCount') {
    const count = value as number;
    return withGradient(spec, {
      ...gradient,
      stops: GRADIENT_STOPS.slice(0, count).map((seed, i) => stops[i] ?? seed),
    });
  }
  const index = Number(path.slice('stop'.length)) - 1;
  return withGradient(spec, {
    ...gradient,
    stops: stops.map((stop, j) => (j === index ? unhex(value) : stop)),
  });
}

/** `spec` with the rail's row at `path` set to `value`, or `null` for a path that is no spec row. */
export function withSpecValue(spec: TubeSpec, path: string, value: unknown): TubeSpec | null {
  if ((PLAIN as readonly string[]).includes(path)) {
    return { ...spec, [path as PlainKey]: value as number };
  }
  if ((SURFACE_KINDS as readonly string[]).includes(path)) {
    return {
      ...spec,
      surfaces: SURFACE_KINDS.filter((s) =>
        s === path ? value === true : spec.surfaces.includes(s),
      ),
    };
  }
  if (path.endsWith('Color') && path !== 'runColor') {
    const kind = path.slice(0, -'Color'.length) as SurfaceKind;
    return { ...spec, surfaceColors: { ...spec.surfaceColors, [kind]: [unhex(value)] } };
  }
  if (path === 'domain' || path === 'mode' || path === 'angle' || path.startsWith('stop')) {
    return withGradientPart(spec, path, value);
  }
  switch (path) {
    case 'select.amount':
      return { ...spec, select: { ...spec.select, amount: value as number } };
    case 'cornerMix': {
      const mix = value as number;
      return { ...spec, corners: { break: mix, connect: 1 - mix } };
    }
    case 'pathSource':
      return { ...spec, pathSource: value as PathSource };
    case 'look.emissive':
      return { ...spec, look: { ...spec.look, emissive: unhex(value) } };
    case 'look.emissiveIntensity':
      return { ...spec, look: { ...spec.look, emissiveIntensity: value as number } };
    case 'look.rim':
      return { ...spec, look: { ...spec.look, rim: value as number } };
    case 'runColor':
      return { ...spec, colors: [unhex(value)] };
    case 'rescue':
      return withCounter(spec, { rescue: value === true ? RESCUE_LADDER : [] });
    case 'floor':
      return withCounter(spec, { floor: value as number });
    case 'oneLit':
      return withCounter(spec, { lit: value === true ? 'one' : 'select' });
    default:
      return null;
  }
}
