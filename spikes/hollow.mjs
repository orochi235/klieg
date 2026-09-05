/**
 * Hollow a letterform out as a stack of levels, and bevel the outside and the wells separately.
 *
 *   npm run build -w klieg && node spikes/hollow.mjs [--letter R] [--rim 0.05] [--well 0.16]
 *   node spikes/hollow.mjs --levels 0.05:0.10,0.09:0.06        # a stepped well
 *
 * A level is an outline and a depth: the glyph inset by `inset`, its floor `depth` below the floor
 * above it. The drinking glass is the one-level case and concentric wells are the same construction
 * with more, so nothing here hard-codes a slab under a plate.
 *
 *   node spikes/hollow.mjs --setting flush     # pockets run to the chamfer, no well
 *   node spikes/hollow.mjs --setting bezel     # the same field sunk in a well that frames it
 *
 * A `cells` level is the pavé field: one level carrying a pocket per Voronoi cell instead of one
 * outline. It is the same construction — rims, beads, walls, floors — with many rings on a plane
 * rather than one, which is why it is a level and not a plate with holes punched through it.
 * `--setting` is two settings of `--levels`, computed against the beads rather than written down;
 * `--levels 0.05:0.09,0.075:0.10:cells` still says it by hand.
 *
 * Nothing is extruded. `ExtrudeGeometry` bevels every contour it is handed at one size, which is
 * both faults it used to have at once: the outside carried a ledge where two separately bevelled
 * solids met, and a well's rim could not take a bead while the letter kept its chamfer. Walls are
 * stitched here between two offsets of one ring, so `--outer` and `--bevel` are independent and
 * the outer skin is a single unbroken surface from the back face to the front.
 *
 * Renders the body alone. A stone standing proud of a plate is visible whether or not a well was
 * ever cut, which is exactly how an uncut plate passed for a cut one.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { chromium } from 'playwright';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { isoContours, signedDistanceField } from '../packages/core/dist/render/tube/field.js';
import {
  buildGlyphGeometry,
  chamfered,
  DEFAULT_GLYPH_OPTIONS,
  glyphToShapes,
} from '../packages/core/dist/text/glyphs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);
const LETTER = arg('letter', 'R');
const OUT = resolve(arg('out', resolve(HERE, 'hollow-out')));
/** How wide the wall of the glass is, in em: the letter inset by this is the hollow. */
const RIM = Number(arg('rim', '0.05'));
/** How deep the hollow goes, in em. The letter keeps the rest of its depth below the floor. */
const WELL = Number(arg('well', '0.16'));
/** The letter's own chamfer, on the outside only. */
const OUTER = Number(arg('outer', String(DEFAULT_GLYPH_OPTIONS.bevelSize)));
/** The bead around a well's rim, on the hole only. A well wants far less than a letter does. */
const LIP = Number(arg('bevel', '0.008'));
const SEGS = Math.max(1, Number(arg('bevelSegments', '3')));

// The cell field. Only a `cells` level reads any of these.
/** Seed spacing, in em — with no gaps this is very nearly a cell's width. */
const PITCH = Number(arg('pitch', '0.055'));
/** Metal left standing between two cells, in em. Half of it comes off each cell. */
const WALL = Number(arg('wall', '0.009'));
/** How far a seed may wander off the lattice, as a fraction of the pitch. */
const JITTER = Number(arg('jitter', '0'));
/** Lloyd passes: each free seed walks to the centroid of what it owns inside the region. */
const RELAX = Number(arg('relax', '4'));
/** A cell smaller than this fraction of a whole one loses its seed; neighbours take the space. */
const MIN_AREA = Number(arg('minArea', '0.18'));
const SEED = Number(arg('seed', '7'));
/** `absorb` cuts the interior cells to the outline; `grade` gives the boundary its own smaller ones. */
const EDGE = arg('edge', 'absorb');
/** How far in from the region's edge the pinned row sits, and how far behind it the lattice does. */
const EDGE_INSET = Number(arg('edgeInset', '0.42'));
const EDGE_STEP = Number(arg('edgeStep', '0.95'));
const CLEARANCE = Number(arg('clearance', '0.62'));
/** The bead around a cell's rim. Two of them meet in the wall, so it cannot be the letter's. */
const CELL_LIP = Number(arg('cellBevel', '0.003'));
const CELL_LIP_T = Number(arg('cellLipDrop', String(CELL_LIP)));
if (2 * CELL_LIP >= WALL) {
  throw new Error(`two ${CELL_LIP} em beads meet inside a ${WALL} em wall and eat it`);
}
/** How coarsely a level's outline is walked, in em. Below the field's own cell it is all staircase. */
const SPACING = Number(arg('outlineSpacing', '0.006'));
/** Radius the letter's reflex corners are rounded to, in em: the junctions and inside the counter. */
const ROUND_IN = Number(arg('round', '0'));
/** Radius its convex corners are rounded to: the outer corners, the tips, the leg's point. */
const ROUND_OUT = Number(arg('roundOuter', '0'));
if (Math.max(ROUND_IN, ROUND_OUT) > 0.04) {
  throw new Error(`a ${Math.max(ROUND_IN, ROUND_OUT)} em radius grows past the field's own 0.05 pad`);
}
const TILT = Number(arg('tilt', '0.5'));

/** How thick the letter is, in em, before anything is taken out of it. */
const D = Number(arg('depth', String(DEFAULT_GLYPH_OPTIONS.depth)));
/** How far the outer chamfer falls, in em. Scaled off the glyph's own unless given. */
const OUTER_T = Number(
  arg('outerDrop', String((DEFAULT_GLYPH_OPTIONS.bevelThickness * OUTER) / DEFAULT_GLYPH_OPTIONS.bevelSize)),
);
if (2 * OUTER_T >= D) throw new Error(`a chamfer falling ${OUTER_T} twice does not fit ${D} of letter`);
/** How far a rim's bead falls as it narrows. Square by default, which is a 45 degree bead. */
const LIP_T = Number(arg('lipDrop', String(LIP)));

/** Metal left past what a bead strictly needs, in em. The guards below reject anything less. */
const SLACK = Number(arg('lookClearance', '0.004'));
/**
 * How the stones sit in the metal, both named for the setting they imitate. `flush` has no well:
 * the cells are the face, and the letter's own chamfer alone frames them. `bezel` sinks them in a
 * well whose wall stands around them. Each packs as close to the letter's edge as its beads allow,
 * and `--levels` overrides either. Not `--looks`, which is what the render is made of.
 */
const SETTING = arg('setting', '');
function setting() {
  if (SETTING === 'flush') return `${(OUTER + CELL_LIP + SLACK).toFixed(4)}:${WELL}:cells`;
  if (SETTING === 'bezel') {
    const rim = OUTER + LIP + SLACK;
    const field = rim + LIP + CELL_LIP + SLACK;
    const [wall, floor] = [WELL * 0.4, WELL * 0.6];
    return `${rim.toFixed(4)}:${wall.toFixed(4)},${field.toFixed(4)}:${floor.toFixed(4)}:cells`;
  }
  if (SETTING) throw new Error(`--setting is 'flush' or 'bezel', got '${SETTING}'`);
  return `${RIM}:${WELL}`;
}

/**
 * `inset:depth` pairs, outermost first, `inset:depth:cells` for the pavé field. A level's outline
 * is the glyph inset by `inset`, and its floor sits `depth` below the floor above it — so a level
 * is a step, not an absolute height. A `cells` level's own inset is the bezel: how much metal is left
 * between the wall it sits in and the outermost cell.
 */
const LEVELS = arg('levels', setting())
  .split(',')
  .filter(Boolean)
  .map((spec) => {
    const [insetText, depthText, kind] = spec.split(':');
    const inset = Number(insetText);
    const depth = Number(depthText);
    if (!Number.isFinite(inset) || !Number.isFinite(depth)) {
      throw new Error(`--levels wants inset:depth pairs, got '${spec}'`);
    }
    if (kind !== undefined && kind !== 'cells') {
      throw new Error(`a level is plain or 'cells', got '${kind}'`);
    }
    return { inset, depth, cells: kind === 'cells' };
  });
/** A cell field is a floor covered in pockets; there is no plane left for a level to sit under it. */
for (let i = 0; i < LEVELS.length - 1; i++) {
  if (LEVELS[i].cells) {
    throw new Error(`level ${i + 1} is a cell field, so nothing can sit inside it`);
  }
}
/** A level's own bead: a cell rim takes far less than a well rim, which takes less than a letter. */
const lipOf = (level) => (level.cells ? CELL_LIP : LIP);
const lipDropOf = (level) => (level.cells ? CELL_LIP_T : LIP_T);
for (let i = 1; i < LEVELS.length; i++) {
  if (LEVELS[i].inset <= LEVELS[i - 1].inset) {
    throw new Error(
      `level ${i + 1} must sit inside level ${i}: ${LEVELS[i].inset} is not past ${LEVELS[i - 1].inset}`,
    );
  }
}
const TOTAL = LEVELS.reduce((n, l) => n + l.depth, 0);
if (TOTAL >= D) throw new Error(`the levels are ${TOTAL} deep and the letter is only ${D}`);
if (LEVELS[0].inset <= OUTER + lipOf(LEVELS[0])) {
  throw new Error(
    `a ${LEVELS[0].inset} em rim leaves no metal between a ${OUTER} em chamfer and a ` +
      `${lipOf(LEVELS[0])} em bead`,
  );
}
for (const level of LEVELS) {
  if (level.depth <= lipDropOf(level)) {
    throw new Error(`a level ${level.depth} deep cannot hold a ${lipDropOf(level)} em bead`);
  }
}
// The bezel: a cell reaching the wall it sits in would open a pocket into the well's own side.
for (let i = 1; i < LEVELS.length; i++) {
  if (!LEVELS[i].cells) continue;
  const bezel = LEVELS[i].inset - LEVELS[i - 1].inset;
  if (bezel <= lipOf(LEVELS[i - 1]) + CELL_LIP) {
    throw new Error(
      `a ${bezel.toFixed(4)} em bezel leaves no metal between the wall's ` +
        `${lipOf(LEVELS[i - 1])} em bead and a cell's ${CELL_LIP} em one`,
    );
  }
}

const buf = readFileSync(resolve(ROOT, 'apps/lab/public/font.ttf'));
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const shapes = glyphToShapes(font, LETTER, 1);

const SEGMENTS = 48;
const xy = (points) => points.map((p) => [p.x, p.y]);

// ---------------------------------------------------------------------------------------------
// Rings. Every ring is oriented with the metal on its left, whether it bounds a letter, a counter,
// a well or an island standing in one — which is what lets one offset and one stitch serve all four.

const signedArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
};

/**
 * Coincident points dropped, then every point that sits on the line between its neighbours.
 *
 * The straight one matters as much as the duplicate: a resampled run down a flat side of the letter
 * is exactly collinear, and `triangulateShape` filters such a point out before triangulating — so
 * a cap's boundary skips it while the wall stitched off the same ring walks it, and the two edges
 * cannot cancel. The face is the right shape and the shell is open all along it.
 */
const dedupe = (ring) => {
  let out = ring.filter((p, i) => {
    const q = ring[(i - 1 + ring.length) % ring.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });
  for (let again = true; again && out.length > 3; ) {
    again = false;
    const keep = out.filter((p, i) => {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[(i + 1) % out.length];
      const cross = (p[1] - a[1]) * (b[0] - p[0]) - (p[0] - a[0]) * (b[1] - p[1]);
      return Math.abs(cross) > 1e-14;
    });
    if (keep.length !== out.length && keep.length >= 3) {
      out = keep;
      again = true;
    }
  }
  return out;
};

/** `metalInside` is whether the material is enclosed by the ring or surrounds it. */
const orient = (ring, metalInside) => {
  const clean = dedupe(ring);
  return signedArea(clean) > 0 === metalInside ? clean : clean.slice().reverse();
};

/**
 * A ring walked at a fixed spacing. An iso-contour arrives at the field's own resolution, and its
 * staircase is finer than any bevel or bead the letter carries — a level outline on the R goes from
 * 1,964 points to 300 and reads the same.
 */
function resample(ring, spacing) {
  const n = ring.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const q = ring[(i + 1) % n];
    total += Math.hypot(q[0] - ring[i][0], q[1] - ring[i][1]);
  }
  const steps = Math.max(8, Math.round(total / spacing));
  const step = total / steps;
  const out = [];
  let carried = 0;
  let want = 0;
  for (let i = 0; i < n && out.length < steps; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (want < carried + seg && out.length < steps) {
      const t = (want - carried) / (seg || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      want += step;
    }
    carried += seg;
  }
  return out;
}

/** Three passes of the same filter the tube pipeline runs, for the same staircase. */
function smooth(ring, passes) {
  let out = ring;
  for (let k = 0; k < passes; k++) {
    const n = out.length;
    out = out.map((p, i) => {
      const a = out[(i - 1 + n) % n];
      const b = out[(i + 1) % n];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  return out;
}

const inside = (ring, px, py) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      hit = !hit;
    }
  }
  return hit;
};

/** Contours and their holes, by containment depth — `isoContours` answers rings with no nesting. */
function nest(loops) {
  const depth = loops.map((r, i) =>
    loops.reduce((n, other, j) => (i !== j && inside(other, r[0][0], r[0][1]) ? n + 1 : n), 0),
  );
  const parent = loops.map((r, i) => {
    let best = -1;
    for (let j = 0; j < loops.length; j++) {
      if (i === j || !inside(loops[j], r[0][0], r[0][1])) continue;
      if (best === -1 || depth[j] > depth[best]) best = j;
    }
    return best;
  });
  return loops
    .map((loop, i) => ({ loop, i }))
    .filter(({ i }) => depth[i] % 2 === 0)
    .map(({ loop, i }) => [loop, ...loops.filter((_, j) => depth[j] % 2 === 1 && parent[j] === i)]);
}

// The letter, chamfered first: a chamfer cuts a sharp corner back so the miter above has something
// to work with, and it is what the shipped letter is built from anyway.
const CH = chamfered(shapes, DEFAULT_GLYPH_OPTIONS);
/** The glyph as regions of `{ outer, holes }`, all rings metal-on-the-left. */
let GLYPH = CH.map((shape) => ({
  outer: orient(xy(shape.getPoints(SEGMENTS)), true),
  holes: shape.holes.map((h) => orient(xy(h.getPoints(SEGMENTS)), false)),
}));

// Every level's outline is an iso-contour of the letter's own distance field. A counter erodes
// outward and the outline inward, and the field knows both — which a ring offset does not.
const rings = [];
for (const shape of shapes) {
  rings.push(shape.getPoints(SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
  for (const hole of shape.holes) {
    rings.push(hole.getPoints(SEGMENTS).map((p) => ({ x: p.x, y: p.y })));
  }
}
const FIELD = { resolution: Number(arg('resolution', '512')), pad: 0.05 };
let field = signedDistanceField(rings, FIELD);

/**
 * A level's outline, as void regions. The orientation is inverted against the glyph's: a well's own
 * boundary has the metal outside it, and the island the R's counter leaves standing inside a well
 * has the metal inside — the same two roles the letter and its counter have, the other way round.
 */
const clean = (ring) => smooth(resample(ring, SPACING), 3);
const outlineAt = (inset) =>
  nest(isoContours(cutting(), cutAt(inset)).map((r) => clean(xy(r)))).map((poly) => ({
    outer: orient(poly[0], false),
    holes: poly.slice(1).map((h) => orient(h, true)),
  }));

// ---------------------------------------------------------------------------------------------
// Rounding, which is the field's job rather than a corner's.

const fieldOf = (regions) =>
  signedDistanceField(
    regions.flatMap((g) => [g.outer, ...g.holes]).map((r) => r.map(([x, y]) => ({ x, y }))),
    FIELD,
  );

/** The metal at one iso level of `f`, as regions — negative erodes it, positive grows it. */
const metalAt = (f, level) =>
  nest(isoContours(f, level).map((r) => clean(xy(r)))).map((poly) => ({
    outer: orient(poly[0], true),
    holes: poly.slice(1).map((h) => orient(h, false)),
  }));

/**
 * A radius rolled along the outline, which is what rounds a corner without having to find one.
 * Growing the metal and shrinking it back leaves every reflex corner filled to the radius and every
 * convex corner where it was; doing it the other way round rounds the convex corners instead.
 *
 * It cannot be done by shifting one field's levels — the distance field of a grown shape is the
 * original minus the radius only on the outside, and the inside is exactly where a filled corner
 * changes what the nearest edge is. So each half rebuilds the field, and the radius is a real one.
 */
const roll = (regions, r, outward) =>
  metalAt(fieldOf(metalAt(fieldOf(regions), outward ? r : -r)), outward ? -r : r);

if (ROUND_IN > 0) {
  GLYPH = roll(GLYPH, ROUND_IN, true);
  field = fieldOf(GLYPH);
}
if (ROUND_OUT > 0) {
  GLYPH = roll(GLYPH, ROUND_OUT, false);
  field = fieldOf(GLYPH);
}

// ---------------------------------------------------------------------------------------------
// Proportional insets. A uniform inset takes the same absolute amount off both sides of every
// stroke, so a thin stroke loses a larger fraction of itself than a thick one and the letter's own
// contrast is exaggerated — on this R, 1.26 on the glyph reads as 1.47 on the top face. Scaling
// each inset by the local stroke width instead leaves every stroke the same fraction of itself.

/**
 * The half-width of the stroke each cell belongs to. A ridge cell — a local maximum of the depth —
 * sits equidistant from both sides of its stroke, so its depth is that stroke's half-width; every
 * other cell inherits from its steepest uphill neighbour, which is the ridge it drains to.
 */
function widthField(f, smoothEm) {
  const { data, size, emPerCell } = f;
  const n = size * size;
  const depth = new Float64Array(n);
  for (let i = 0; i < n; i++) depth[i] = Math.max(0, -data[i]);

  const inside = [];
  for (let i = 0; i < n; i++) if (depth[i] > 0) inside.push(i);
  inside.sort((a, b) => depth[b] - depth[a]);

  const w = new Float64Array(n);
  for (const i of inside) {
    const ix = i % size;
    const iy = (i - ix) / size;
    let parent = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const jx = ix + dx;
        const jy = iy + dy;
        if (jx < 0 || jy < 0 || jx >= size || jy >= size) continue;
        const j = jy * size + jx;
        if (depth[j] > depth[i] && (parent === -1 || depth[j] > depth[parent])) parent = j;
      }
    }
    w[i] = parent === -1 ? depth[i] : w[parent];
  }

  // Snapped to the letter's actual stroke widths, because a straight edge only stays straight if
  // the width is constant along it. The pointwise value is not: it climbs wherever a stroke runs
  // into a wider one, and an inset that follows it eats a straight edge unevenly and bows it —
  // which is what a proportional R's counter did. A corner's own inflated ridge snaps back to the
  // stroke it belongs to for the same reason.
  const peaks = [];
  for (const i of inside) if (w[i] === depth[i]) peaks.push(depth[i]);
  peaks.sort((a, b) => a - b);
  const classes = [];
  for (const d of peaks) {
    const run = classes.at(-1);
    if (run && d - run.at(-1) <= Math.max(3 * emPerCell, 0.03 * d)) run.push(d);
    else classes.push([d]);
  }
  const widths = classes
    .filter((run) => run.length >= Math.max(3, 0.004 * peaks.length))
    .map((run) => run[Math.floor(run.length / 2)]);
  if (widths.length > 0) {
    for (const i of inside) {
      let best = widths[0];
      for (const v of widths) if (Math.abs(v - w[i]) < Math.abs(best - w[i])) best = v;
      w[i] = best;
    }
  }

  // A snapped width steps at a junction. Smoothed, the step becomes a short ramp and the chamfer
  // runs into its neighbour instead of jumping.
  const s = Math.max(0, smoothEm) / emPerCell;
  const passes = Math.min(400, Math.round(1.5 * s * s));
  let cur = w;
  for (let p = 0; p < passes; p++) {
    const next = new Float64Array(cur);
    for (const i of inside) {
      const ix = i % size;
      const iy = (i - ix) / size;
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const jx = ix + dx;
          const jy = iy + dy;
          if (jx < 0 || jy < 0 || jx >= size || jy >= size) continue;
          const j = jy * size + jx;
          if (depth[j] <= 0) continue;
          sum += cur[j];
          count++;
        }
      }
      if (count > 0) next[i] = sum / count;
    }
    cur = next;
  }

  let max = 0;
  for (const i of inside) max = Math.max(max, cur[i]);
  const named = widths.length > 0 ? widths : [max];
  // Outside the metal there is no stroke to be a fraction of, so it scales with the thickest one.
  for (let i = 0; i < n; i++) if (depth[i] <= 0) cur[i] = max;
  return { width: cur, max, widths: named };
}

const INSETS = arg('insets', 'uniform');
if (INSETS !== 'uniform' && INSETS !== 'proportional') {
  throw new Error(`--insets is 'uniform' or 'proportional', got '${INSETS}'`);
}
const PROPORTIONAL = INSETS === 'proportional';
/** How far a width jump at a junction is spread, in em. */
const WIDTH_SMOOTH = Number(arg('widthSmooth', '0.02'));

let WMAX = 1;
/** The stroke half-widths the letter turned out to have, which every inset is snapped to. */
let STROKES = [];
/**
 * The field divided by the local half-width, so its levels run 0 at the outline to -1 at the ridge
 * whatever a stroke's width. A nominal inset `c` is level `-c / WMAX`, which is `c` on the thickest
 * stroke and the same fraction of every thinner one.
 */
let scaled = null;
if (PROPORTIONAL) {
  const { width, max, widths } = widthField(field, WIDTH_SMOOTH);
  WMAX = max;
  STROKES = widths;
  const data = new Float64Array(field.data.length);
  for (let i = 0; i < data.length; i++) data[i] = field.data[i] / width[i];
  const { size, emPerCell, originX, originY } = field;
  scaled = {
    data,
    size,
    emPerCell,
    originX,
    originY,
    sample(x, y) {
      const gx = Math.round((x - originX) / emPerCell);
      const gy = Math.round((y - originY) / emPerCell);
      if (gx < 0 || gy < 0 || gx >= size || gy >= size) return Number.POSITIVE_INFINITY;
      return data[gy * size + gx];
    },
  };
}

/** The level that cuts `inset` off the thickest stroke, on whichever field is doing the cutting. */
const cutAt = (inset) => (PROPORTIONAL ? -inset / WMAX : -inset);
const cutting = () => (PROPORTIONAL ? scaled : field);
if (PROPORTIONAL && LEVELS.at(-1).inset >= WMAX) {
  throw new Error(
    `a ${LEVELS.at(-1).inset} em inset eats the thickest stroke, whose half-width is ` +
      `${WMAX.toFixed(4)}`,
  );
}

// ---------------------------------------------------------------------------------------------
// The cell field. A level whose void is many pockets rather than one, packed to fill what the level
// above it left. Voronoi does the packing: every point belongs to its nearest seed, so there is no
// dead space to fill — leftover only exists if a cell is deleted, which is why a cell too small
// to set loses its seed and its neighbours grow into exactly the space it held.

const area = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(a) / 2;
};

const centroidOf = (poly) => {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-12) return poly[0];
  return [cx / (3 * a), cy / (3 * a)];
};

/** Clip a convex polygon by the line through `(ax, ay)` with normal `(nx, ny)`, keeping behind. */
function clipHalf(poly, ax, ay, nx, ny) {
  const side = (p) => (p[0] - ax) * nx + (p[1] - ay) * ny;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const dCur = side(cur);
    const dPrev = side(prev);
    if (dPrev <= 0 !== dCur <= 0) {
      const t = dPrev / (dPrev - dCur);
      out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
    }
    if (dCur <= 0) out.push(cur);
  }
  return out;
}

/**
 * Every edge of a convex polygon pushed in by `d`, or out by it when `d` is negative. The line is
 * moved *against* its own outward normal because `clipHalf` keeps what is behind it: pushing it the
 * way the normal points grows the polygon instead, which leaves neighbouring cells sharing the wall
 * they were supposed to be separated by rather than a gap.
 */
function shrink(poly, d) {
  let out = poly;
  for (let i = 0; i < poly.length && out.length >= 3; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1e-12;
    const nx = ey / len;
    const ny = -ex / len;
    out = clipHalf(out, a[0] - nx * d, a[1] - ny * d, nx, ny);
  }
  return out;
}

/** Bilinear, unlike `Field.sample`, which rounds — the inward push needs a smooth gradient. */
function depthAt(x, y) {
  const { data, size, emPerCell, originX, originY } = field;
  const gx = Math.min(Math.max((x - originX) / emPerCell, 0), size - 1.0001);
  const gy = Math.min(Math.max((y - originY) / emPerCell, 0), size - 1.0001);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const d00 = data[y0 * size + x0];
  const d10 = data[y0 * size + x0 + 1];
  const d01 = data[(y0 + 1) * size + x0];
  const d11 = data[(y0 + 1) * size + x0 + 1];
  return (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
}

/**
 * A point moved `dist` further inside the letter, along the field's own gradient. Off the field
 * rather than off a ring's normal is what makes a counter behave like the outer edge: inward is
 * wherever the metal is, and the field already knows.
 */
function pushInward(x, y, dist) {
  const h = field.emPerCell;
  const gx = (depthAt(x + h, y) - depthAt(x - h, y)) / (2 * h);
  const gy = (depthAt(x, y + h) - depthAt(x, y - h)) / (2 * h);
  const len = Math.hypot(gx, gy) || 1e-9;
  return [x - (gx / len) * dist, y - (gy / len) * dist];
}

/** The glyph inset by `ins` as a multipolygon, cleaned the same way a level's outline is. */
const regionAt = (ins) => nest(isoContours(cutting(), cutAt(ins)).map((r) => clean(xy(r))));

/** Every piece of `cell` the region leaves. A cell is one pocket, so only its outer ring is kept. */
function clipTo(cell, region) {
  if (cell.length < 3) return [];
  try {
    return (polygonClipping.intersection([cell], region) ?? [])
      .filter((piece) => piece[0] && piece[0].length >= 4)
      .map((piece) => ({ ring: piece[0].slice(0, -1), holes: piece.length - 1 }));
  } catch {
    return [];
  }
}

const ROW = Math.sqrt(3) / 2;
/** A honeycomb cell at this pitch, and what is left of one once the wall has come off it. */
const WHOLE_CELL = PITCH * PITCH * ROW;
const WHOLE_SET = (PITCH - WALL) * (PITCH - WALL) * ROW;

/**
 * The cells of one level, at each of the growths its bead asks for. Every ring is re-derived from
 * the same seeds rather than offset off the one below it: a bead step is the cell built with half a
 * wall less taken off it, inside a region grown by the same amount. A clipped cell is not convex,
 * so there is nothing to offset it with — but the thing it was clipped from is.
 */
function cellField(ins, growths) {
  const regions = growths.map((g) => regionAt(ins - g));
  const base = regions[0];
  if (base.length === 0) throw new Error(`a ${ins} em bezel leaves nothing for a cell field`);

  // The letter's own box, not the region's: a seed out in the bezel is culled, but while it stands
  // it is what stops the cell beside it ballooning out to meet the outline on its own.
  const box = new THREE.Box2();
  for (const g of GLYPH) for (const [x, y] of g.outer) box.expandByPoint(new THREE.Vector2(x, y));

  let rand = SEED;
  const random = () => {
    rand = (rand * 1664525 + 1013904223) % 4294967296;
    return rand / 4294967296;
  };

  /**
   * Seeds in two sets. `grade` lays a pinned row along the region's own edge, so the boundary is a
   * place stones are laid rather than a place they are cut off, and the lattice behind it starts
   * far enough back not to crowd it. `absorb` seeds the lattice alone and lets the outline do the
   * cutting. The pinned row never relaxes — let it and it migrates inward, and the grading goes too.
   */
  const pinned = [];
  const edgeStep = PITCH * EDGE_STEP;
  for (const rings of EDGE === 'grade' ? base : []) {
    for (const ring of rings) {
      let carry = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let t = carry; t < seg; t += edgeStep) {
          const u = t / seg;
          pinned.push(
            pushInward(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, EDGE_INSET * PITCH),
          );
        }
        carry = seg > 0 ? (((carry - seg) % edgeStep) + edgeStep) % edgeStep : carry;
      }
    }
  }

  const free = [];
  const rowStep = PITCH * ROW;
  // `grade` starts the lattice far enough back not to crowd the row pinned along the region's edge.
  // `absorb` has nothing to clear, and takes every seed inside the metal at all.
  const clearance = EDGE === 'grade' ? ins + EDGE_INSET * PITCH + PITCH * CLEARANCE : 0;
  for (let r = -1; r * rowStep + box.min.y <= box.max.y + rowStep; r++) {
    const y = box.min.y + r * rowStep;
    const stagger = r % 2 ? PITCH / 2 : 0;
    for (let x = box.min.x - PITCH + stagger; x <= box.max.x + PITCH; x += PITCH) {
      const jx = x + (random() - 0.5) * PITCH * JITTER;
      const jy = y + (random() - 0.5) * PITCH * JITTER;
      if (depthAt(jx, jy) < -clearance) free.push([jx, jy]);
    }
  }

  /**
   * The Voronoi cell of `seeds[i]`, before the wall comes off it. The box it starts as reaches
   * `2.2 * PITCH` along an axis and `√2` of that into a corner, so a seed is bisected against
   * anything whose own box could reach it — cull a seed and its neighbours are what grow into it.
   * A cutoff shorter than that leaves two cells overlapping wherever the lattice has a gap in it,
   * and two pockets sharing floor is a hole in the shell rather than anything a render shows.
   */
  const voronoiCell = (i, seeds) => {
    const [sx, sy] = seeds[i];
    const r = PITCH * 2.2;
    const reach = 2 * r * Math.SQRT2;
    let cell = [
      [sx - r, sy - r],
      [sx + r, sy - r],
      [sx + r, sy + r],
      [sx - r, sy + r],
    ];
    for (let j = 0; j < seeds.length; j++) {
      if (j === i) continue;
      const dx = seeds[j][0] - sx;
      const dy = seeds[j][1] - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 < 1e-12 || d2 > reach * reach) continue;
      const len = Math.sqrt(d2);
      cell = clipHalf(cell, sx + dx / 2, sy + dy / 2, dx / len, dy / len);
      if (cell.length < 3) break;
    }
    return cell;
  };

  // Lloyd: each free seed walks to the centroid of what it actually owns inside the region, which
  // is what turns a lattice clipped by an outline into a field that fits it.
  for (let pass = 0; pass < RELAX; pass++) {
    const all = [...pinned, ...free];
    for (let i = 0; i < free.length; i++) {
      const pieces = clipTo(voronoiCell(pinned.length + i, all), base);
      if (pieces.length === 0) continue;
      const biggest = pieces.reduce((a, b) => (area(a.ring) > area(b.ring) ? a : b)).ring;
      if (area(biggest) < WHOLE_CELL * 0.05) continue;
      free[i] = centroidOf(biggest);
    }
  }

  // Cull the seed, never the cell: a cell too small to set is dead space only once it is deleted.
  // Take the seed away and every point it held goes to whichever seed is next nearest.
  let seeds = [...pinned, ...free];
  let culled = 0;
  for (let pass = 0; pass < 8; pass++) {
    const doomed = new Set();
    for (let i = pinned.length; i < seeds.length; i++) {
      const held = clipTo(shrink(voronoiCell(i, seeds), WALL / 2), base).reduce(
        (n, p) => n + area(p.ring),
        0,
      );
      if (held < WHOLE_CELL * MIN_AREA) doomed.add(i);
    }
    if (doomed.size === 0) break;
    culled += doomed.size;
    seeds = seeds.filter((_, i) => !doomed.has(i));
  }

  // One ring per seed per growth, or the seed is dropped. Every growth has to answer with the same
  // rings in the same order — `pair` matches a band's two ends by count first, and a cell that
  // arrives at one step and not the next is a band that cannot be stitched at all.
  const rings = growths.map(() => []);
  let split = 0;
  let pierced = 0;
  let dropped = 0;
  for (let i = 0; i < seeds.length; i++) {
    const cell = voronoiCell(i, seeds);
    const perStep = growths.map((g, s) => {
      const pieces = clipTo(shrink(cell, WALL / 2 - g), regions[s]);
      if (pieces.length === 0) return null;
      const best = pieces.reduce((a, b) => (area(a.ring) > area(b.ring) ? a : b));
      return { ...best, extra: pieces.length - 1 };
    });
    if (perStep.some((p) => p === null) || area(perStep[0].ring) < WHOLE_CELL * MIN_AREA) {
      dropped++;
      continue;
    }
    if (perStep[0].extra > 0) split++;
    if (perStep[0].holes > 0) pierced++;
    // Symbolic perturbation, a millionth of a cell wide. A lattice puts whole rows of cells on one
    // line — a row's floors share a y, and so do the edges two of them are cut to where the letter
    // runs straight. Three points from two rings on one line is a zero-area ear, and the triangle
    // earcut makes of it walks an edge between two pockets that nothing walks back, so the floor
    // they sit in reads as open. Nudged by its own amount, no two cells have a line to share.
    const nudge = 1 - (i + 1) * 4e-9;
    perStep.forEach((p, s) => {
      const c = centroidOf(p.ring);
      const shrunk = p.ring.map(([x, y]) => [c[0] + (x - c[0]) * nudge, c[1] + (y - c[1]) * nudge]);
      rings[s].push(orient(shrunk, false));
    });
  }
  if (rings[0].length === 0) throw new Error('no cell survived — try a smaller wall or pitch');

  const whole = rings[0].filter((r) => area(r) > WHOLE_SET * 0.92).length;
  return {
    rings,
    report:
      `${rings[0].length} cells at pitch ${PITCH}, wall ${WALL}, bezel ${ins}\n` +
      `    edge '${EDGE}': ${pinned.length} pinned, ${free.length} laid, ` +
      `${culled} culled so neighbours took the space, ${dropped} too small to set\n` +
      `    ${whole} whole, ${rings[0].length - whole} shaped by the outline` +
      (split > 0 ? `, ${split} broken in two by it and set as the bigger half` : '') +
      (pierced > 0 ? `, ${pierced} closed around a standing island` : ''),
  };
}

const OUTLINES = LEVELS.map(({ inset }, i) => {
  const poly = outlineAt(inset);
  if (poly.length === 0) {
    throw new Error(`level ${i + 1}'s ${inset} em inset leaves nothing on '${LETTER}'`);
  }
  return poly;
});

/** The floor of each level, measured down from the letter's top face; descending. */
const FLOORS = [];
let running = D;
for (const { depth } of LEVELS) {
  running -= depth;
  FLOORS.push(running);
}

// ---------------------------------------------------------------------------------------------
// The shell: caps and walls, and nothing else.

const pos = [];
const tri = (a, b, c) => {
  pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
};

/** A quad strip between two offsets of one ring. `lower` first, so the metal ends up on the left. */
function wall(lower, zLo, upper, zHi) {
  if (Math.abs(zHi - zLo) < 1e-12) return;
  for (let i = 0; i < lower.length; i++) {
    const j = (i + 1) % lower.length;
    const a = [lower[i][0], lower[i][1], zLo];
    const b = [lower[j][0], lower[j][1], zLo];
    const c = [upper[j][0], upper[j][1], zHi];
    const e = [upper[i][0], upper[i][1], zHi];
    tri(a, b, c);
    tri(a, c, e);
  }
}

/**
 * A quad strip between two rings that need not correspond. Both are walked by their own arc length
 * and whichever is behind advances, so the strip closes whatever the point counts are.
 *
 * That is what lets every ring come from the field. A miter keeps the point count and so cannot
 * survive being asked for more than a corner's own radius — past that the offset has to invert, and
 * no amount of clamping or fold repair changes the geometry. An iso-contour never folds; it just
 * does not correspond, and this is the correspondence.
 */
function stitch(lower, zLo, upper, zHi) {
  const na = lower.length;
  const nb = upper.length;
  if (na < 3 || nb < 3) return;
  const arc = (ring) => {
    const t = [0];
    for (let i = 1; i <= ring.length; i++) {
      const p = ring[i - 1];
      const q = ring[i % ring.length];
      t.push(t[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
    return t.map((v) => v / (t[t.length - 1] || 1));
  };
  // Rings from two iso levels start wherever marching squares happened to start them; without this
  // the strip is built with a twist in it and every quad crosses the letter.
  let off = 0;
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k < nb; k++) {
    const d = Math.hypot(upper[k][0] - lower[0][0], upper[k][1] - lower[0][1]);
    if (d < best) {
      best = d;
      off = k;
    }
  }
  const b = upper.slice(off).concat(upper.slice(0, off));
  const ta = arc(lower);
  const tb = arc(b);
  const A = (i) => [lower[i % na][0], lower[i % na][1], zLo];
  const B = (j) => [b[j % nb][0], b[j % nb][1], zHi];
  let i = 0;
  let j = 0;
  while (i < na || j < nb) {
    if (j >= nb || (i < na && ta[i + 1] <= tb[j + 1])) {
      tri(A(i), A(i + 1), B(j));
      i++;
    } else {
      tri(A(i), B(j + 1), B(j));
      j++;
    }
  }
}

/**
 * A flat face. Its facing is asserted per triangle rather than inherited from the ring order, so a
 * ring that arrives wound the other way darkens nothing — a lid facing into the solid is invisible
 * and reads as a missing cap, which is a long way to chase for a sign flip.
 */
function cap(contour, holes, z, up) {
  const c = contour.map(([x, y]) => new THREE.Vector2(x, y));
  const hs = holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
  const faces = THREE.ShapeUtils.triangulateShape(c, hs);
  const all = [c, ...hs].flat();
  if (process.env.HOLLOW_EDGES) {
    // Area, never a face count. Earcut bridges each hole with a pair of duplicated vertices, so the
    // triangle count is not `n + 2h - 2` and reading it as one calls a correct cap a broken one.
    const flat = (ring) => ring.map((v) => [v.x, v.y]);
    const want = area(flat(c)) - hs.reduce((n, h) => n + area(flat(h)), 0);
    let got = 0;
    for (const [ia, ib, ic] of faces) {
      const a = all[ia];
      const b = all[ib];
      const d = all[ic];
      got += Math.abs((b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y)) / 2;
    }
    const miss = want > 0 ? (1 - got / want) * 100 : 0;
    console.log(
      `    cap z ${z}: ${all.length} pts, ${hs.length} holes → ${faces.length} faces, ` +
        `${miss.toFixed(2)}% of the face left uncovered`,
    );
  }
  for (const [ia, ib, ic] of faces) {
    const a = all[ia];
    const b = all[ib];
    const d = all[ic];
    const twice = (b.x - a.x) * (d.y - a.y) - (d.x - a.x) * (b.y - a.y);
    const ccw = twice > 0;
    const p = (v) => [v.x, v.y, z];
    if (ccw === up) tri(p(a), p(b), p(d));
    else tri(p(d), p(b), p(a));
  }
}

/**
 * A bevel as offsets of one ring: `size` toward the metal at the near end, nothing at the far end,
 * over `thick` of height. A quarter ellipse, which is the profile `ExtrudeGeometry` walks too.
 */
const bevelSteps = (size, thick, segs) =>
  Array.from({ length: segs + 1 }, (_, k) => {
    const t = k / segs;
    return { inset: size * Math.cos((t * Math.PI) / 2), dz: thick * Math.sin((t * Math.PI) / 2) };
  });

/**
 * Every ring in the letter is an iso-contour of its own field, at the level that ring sits at, and
 * every band between two of them is stitched. Nothing is offset, so nothing can fold.
 */
const skinAt = (inset) => metalAt(cutting(), cutAt(inset)).flatMap((g) => [g.outer, ...g.holes]);
const voidAt = (inset) => outlineAt(inset).flatMap((r) => [r.outer, ...r.holes]);

/**
 * Which ring of one level answers which of the next. Two iso levels of the same letter run
 * parallel, so a ring is answered by the one nearest it that is also about the same size and going
 * the same way round — a hole and an outline wind opposite ways and can never be each other.
 *
 * Centroid alone is not enough, and an O is why: its outline and its counter share a centre, so
 * whichever came out marginally closer won, and the outline of one level got stitched to the
 * counter of the next. That is a sheet of quads drawn straight across the counter, which is exactly
 * what it looked like. Cheapest pair first rather than in ring order, so one ring's near miss
 * cannot push every ring after it onto the wrong partner.
 */
function pair(a, b) {
  if (a.length !== b.length) return null;
  const of = (ring) => {
    let x = 0;
    let y = 0;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      x += ring[i][0];
      y += ring[i][1];
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return { x: x / ring.length, y: y / ring.length, area: area / 2 };
  };
  const ma = a.map(of);
  const mb = b.map(of);
  /** As a radius, so it is in em and adds to a distance rather than dwarfing it. */
  const radius = (m) => Math.sqrt(Math.abs(m.area) / Math.PI);
  const costs = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const turn = Math.sign(ma[i].area) !== Math.sign(mb[j].area) ? 1e3 : 0;
      const gap = Math.hypot(ma[i].x - mb[j].x, ma[i].y - mb[j].y);
      costs.push([gap + Math.abs(radius(ma[i]) - radius(mb[j])) + turn, i, j]);
    }
  }
  costs.sort((p, q) => p[0] - q[0]);
  const from = new Set();
  const to = new Set();
  const out = [];
  for (const [cost, i, j] of costs) {
    if (from.has(i) || to.has(j) || cost >= 1e3) continue;
    from.add(i);
    to.add(j);
    out.push([a[i], b[j]]);
  }
  return out.length === a.length ? out : null;
}

let unpaired = 0;
/** A run of bands between successive levels, from `zAt(k)` for each step. */
function band(rings, zAt) {
  for (let k = 0; k < rings.length - 1; k++) {
    const pairs = pair(rings[k], rings[k + 1]);
    if (pairs === null) {
      unpaired++;
      continue;
    }
    for (const [lo, hi] of pairs) stitch(lo, zAt(k), hi, zAt(k + 1));
  }
}

/** The letter's outer skin: chamfer up off the back face, one straight wall, chamfer in to the front. */
const OUTER_STEPS = OUTER > 0 && OUTER_T > 0 ? bevelSteps(OUTER, OUTER_T, SEGS) : [{ inset: 0, dz: 0 }];
const SKIN = OUTER_STEPS.map((step) => skinAt(step.inset));
band(SKIN, (k) => OUTER_STEPS[k].dz);
for (const ring of SKIN[SKIN.length - 1]) {
  stitch(ring, OUTER_T, ring, D - OUTER_T);
}
band([...SKIN].reverse(), (k) => D - OUTER_STEPS[OUTER_STEPS.length - 1 - k].dz);

/**
 * A flat face from every ring that lands on its plane, nested by containment. A well inside a
 * letter can hold an island — the metal the R's counter leaves standing — and that island holds the
 * counter, so a face is four rings deep and a flat contour-with-holes cannot say so.
 */
const capPlane = (planeRings, z, up) => {
  for (const [contour, ...holes] of nest(planeRings)) cap(contour, holes, z, up);
};

/** The back face, which no level reaches. */
capPlane(SKIN[0], 0, false);

/**
 * A rim: the void its own bead wider at the ceiling, back to its outline the bead's drop below. A
 * cell field is the same thing many times over, so it differs only in where its rings come from.
 */
const STEPS = LEVELS.map((level) => {
  const size = lipOf(level);
  const drop = lipDropOf(level);
  return size > 0 && drop > 0 ? bevelSteps(size, drop, SEGS) : [{ inset: 0, dz: 0 }];
});
const CELLS = LEVELS.map((level, i) =>
  level.cells ? cellField(level.inset, STEPS[i].map((step) => step.inset)) : null,
);
const BEAD = LEVELS.map((level, i) =>
  level.cells ? CELLS[i].rings : STEPS[i].map((step) => voidAt(level.inset - step.inset)),
);
const RIM_RINGS = BEAD.map((steps) => steps[0]);
const last = (i) => STEPS[i].length - 1;

for (let i = 0; i < LEVELS.length; i++) {
  const ceiling = i === 0 ? D : FLOORS[i - 1];
  band([...BEAD[i]].reverse(), (k) => ceiling - STEPS[i][last(i) - k].dz);
  for (const ring of BEAD[i][last(i)]) {
    stitch(ring, FLOORS[i], ring, ceiling - lipDropOf(LEVELS[i]));
  }
}

/** The letter's front, then one floor per level: what the level leaves, opened by the level below. */
capPlane([...SKIN[0], ...RIM_RINGS[0]], D, true);
for (let i = 0; i < LEVELS.length; i++) {
  capPlane([...BEAD[i][last(i)], ...(RIM_RINGS[i + 1] ?? [])], FLOORS[i], true);
}

const body = new THREE.BufferGeometry();
body.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pos), 3));
body.computeVertexNormals();

// The control. `--plain` renders the letter the shipped path builds, wells and all removed, so the
// outside has something to be judged against rather than only a memory of what it should look like.
const plain = has('plain')
  ? buildGlyphGeometry(font, LETTER, 1, {
      ...DEFAULT_GLYPH_OPTIONS,
      depth: D,
      bevelSize: OUTER,
      bevelThickness: OUTER_T,
    })
  : null;

// ---------------------------------------------------------------------------------------------
// What a render cannot say.

/**
 * A hand-built shell is either closed or it is not, and nothing in a render distinguishes a missing
 * cap from a dark one. Every edge of a closed surface is walked once in each direction.
 */
function openEdges() {
  const seen = new Map();
  const key = (i) => `${pos[i].toFixed(9)},${pos[i + 1].toFixed(9)},${pos[i + 2].toFixed(9)}`;
  for (let i = 0; i < pos.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      if (a === b) continue;
      seen.set(`${a}|${b}`, (seen.get(`${a}|${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  const where = new Map();
  for (const [edge, n] of seen) {
    const [a, b] = edge.split('|');
    if (n === (seen.get(`${b}|${a}`) ?? 0)) continue;
    open++;
    const z = a.split(',')[2];
    where.set(z, (where.get(z) ?? 0) + 1);
  }
  if (open > 0 && process.env.HOLLOW_EDGES) {
    for (const [z, n] of [...where].sort((x, y) => y[1] - x[1]).slice(0, 8)) {
      console.log(`    z ${z}: ${n} open edges`);
    }
  }
  return open;
}

console.log(`"${LETTER}" — ${LEVELS.length} level(s), ${TOTAL} em of ${D} em hollowed out`);
if (ROUND_IN > 0 || ROUND_OUT > 0) {
  console.log(
    `  rounded: reflex corners to ${ROUND_IN || 'nothing'}, convex to ${ROUND_OUT || 'nothing'}`,
  );
}
console.log(
  `  ${D} em thick, chamfer ${OUTER} falling ${OUTER_T} on the outside, ` +
    `bead ${LIP} falling ${LIP_T} on every rim, ${SEGS} segments each`,
);
if (PROPORTIONAL) {
  console.log(
    `  insets proportional: every one is ${((100 * OUTER) / WMAX).toFixed(0)}% of the stroke it ` +
      `cuts, being ${OUTER} at the widest of its ${STROKES.length} stroke width(s) ` +
      `(${STROKES.map((v) => (2 * v).toFixed(3)).join(', ')} em)`,
  );
}
for (let i = 0; i < LEVELS.length; i++) {
  console.log(
    `  level ${i + 1}: inset ${LEVELS[i].inset}, floor z ${FLOORS[i].toFixed(4)}, ` +
      `${OUTLINES[i].length} region(s), ${RIM_RINGS[i].length} ring(s)`,
  );
  if (CELLS[i]) console.log(`    ${CELLS[i].report}`);
}
const open = openEdges();
if (unpaired > 0) {
  console.log(`  ${unpaired} band(s) unstitched — a stroke closed up or split between two levels`);
}
console.log(`  body ${body.getAttribute('position').count} verts, ${pos.length / 9} triangles`);
console.log(
  open === 0
    ? '  shell: closed — every edge walked once each way'
    : `  shell: ${open} edges walked only one way — there is a hole in it`,
);

const dump = (geo) => ({
  position: [...geo.getAttribute('position').array],
  normal: [...geo.getAttribute('normal').array],
});
// ---------------------------------------------------------------------------------------------
// The stones. A pocket is a ring and a floor, and a cut is a profile over it: a list of rings
// scaled toward an interior point, stitched the way every other pair of rings here is. The cell's
// own outline is the girdle, so a stone at the letter's edge is a fragment of a stone rather than
// a whole one hanging over it, and every facet around the perimeter is one of the cell's edges.

/**
 * `k` is how far a ring is scaled toward the interior point, `t` how far it is along the crown's
 * height or the pavilion's depth. `zig` pulls alternate vertices in and out, which is what turns a
 * plain cone into crown facets. A pavilion of `k: 1` is a flat back: the stone runs straight down
 * to the floor of its own pocket and sits on it.
 */
const CUTS = {
  brilliant: {
    crown: [{ k: 0.78, t: 0.42, zig: 0.17 }, { k: 0.56, t: 1 }],
    pavilion: [{ k: 0.62, t: 0.45, zig: 0.13 }, { k: 0.12, t: 1 }],
  },
  step: {
    crown: [{ k: 0.86, t: 0.34 }, { k: 0.72, t: 0.67 }, { k: 0.58, t: 1 }],
    pavilion: [{ k: 0.74, t: 0.34 }, { k: 0.46, t: 0.67 }, { k: 0.12, t: 1 }],
  },
  rose: {
    crown: [{ k: 0.72, t: 0.44, zig: 0.12 }, { k: 0.4, t: 0.78 }, { k: 0.13, t: 1 }],
    pavilion: [{ k: 1, t: 1 }],
  },
  cabochon: {
    crown: [
      { k: 0.97, t: 0.26 },
      { k: 0.87, t: 0.5 },
      { k: 0.71, t: 0.71 },
      { k: 0.5, t: 0.87 },
      { k: 0.26, t: 0.97 },
      { k: 0.06, t: 1 },
    ],
    pavilion: [{ k: 1, t: 1 }],
  },
  briolette: {
    crown: [{ k: 0.87, t: 0.5 }, { k: 0.5, t: 0.87 }, { k: 0.09, t: 1 }],
    pavilion: [{ k: 0.87, t: 0.5 }, { k: 0.5, t: 0.87 }, { k: 0.09, t: 1 }],
  },
  sugarloaf: {
    crown: [{ k: 0.66, t: 0.45 }, { k: 0.34, t: 0.79 }, { k: 0.08, t: 1 }],
    pavilion: [{ k: 0.6, t: 0.5 }, { k: 0.12, t: 1 }],
  },
  table: {
    crown: [{ k: 0.88, t: 1 }],
    pavilion: [{ k: 0.66, t: 0.42 }, { k: 0.12, t: 1 }],
  },
};

/**
 * Colour, and what the material does with light. `transmission` and `ior` are what make a gem read
 * as one rather than as painted plastic; `attenuation` is the colour light picks up on its way
 * through, which is where the depth of a ruby actually comes from. The opaque ones are opaque on
 * purpose — onyx, pearl and turquoise are not transparent stones.
 */
const GEMS = {
  diamond: { color: '#fbfcff', ior: 2.42, transmission: 1, roughness: 0.02, attenuation: '#f2f6ff', distance: 0.6 },
  ruby: { color: '#c4082f', ior: 1.77, transmission: 0.95, roughness: 0.03, attenuation: '#7c0016', distance: 0.09 },
  sapphire: { color: '#12439c', ior: 1.77, transmission: 0.95, roughness: 0.03, attenuation: '#04173f', distance: 0.09 },
  emerald: { color: '#0b7d51', ior: 1.58, transmission: 0.92, roughness: 0.05, attenuation: '#023a24', distance: 0.1 },
  amethyst: { color: '#7d43ac', ior: 1.54, transmission: 0.95, roughness: 0.03, attenuation: '#3d1a5c', distance: 0.12 },
  citrine: { color: '#e0a022', ior: 1.55, transmission: 0.95, roughness: 0.03, attenuation: '#8a5504', distance: 0.14 },
  topaz: { color: '#37a9d1', ior: 1.62, transmission: 0.95, roughness: 0.03, attenuation: '#0a5d7c', distance: 0.14 },
  peridot: { color: '#93c01f', ior: 1.65, transmission: 0.93, roughness: 0.04, attenuation: '#4c6b05', distance: 0.13 },
  garnet: { color: '#8a1424', ior: 1.79, transmission: 0.9, roughness: 0.04, attenuation: '#480009', distance: 0.08 },
  aquamarine: { color: '#79d4e4', ior: 1.58, transmission: 0.97, roughness: 0.03, attenuation: '#2b8fa4', distance: 0.2 },
  morganite: { color: '#f2ada6', ior: 1.58, transmission: 0.96, roughness: 0.03, attenuation: '#b96f68', distance: 0.2 },
  tanzanite: { color: '#4a3fc0', ior: 1.7, transmission: 0.94, roughness: 0.03, attenuation: '#1e1466', distance: 0.1 },
  tourmaline: { color: '#d8477e', ior: 1.62, transmission: 0.94, roughness: 0.04, attenuation: '#7a1340', distance: 0.11 },
  spinel: { color: '#e8546f', ior: 1.71, transmission: 0.93, roughness: 0.03, attenuation: '#8c1330', distance: 0.11 },
  moonstone: { color: '#dbe6f5', ior: 1.52, transmission: 0.72, roughness: 0.16, attenuation: '#9fb4d4', distance: 0.3 },
  opal: { color: '#d5eae4', ior: 1.45, transmission: 0.6, roughness: 0.2, attenuation: '#8fc3bb', distance: 0.25, iridescence: 1 },
  onyx: { color: '#111318', ior: 1.5, transmission: 0, roughness: 0.07 },
  pearl: { color: '#f6efe2', ior: 1.53, transmission: 0, roughness: 0.22, clearcoat: 1 },
  turquoise: { color: '#33b3ad', ior: 1.62, transmission: 0, roughness: 0.3 },
  jade: { color: '#3f9c6d', ior: 1.66, transmission: 0.45, roughness: 0.18, attenuation: '#134d30', distance: 0.06 },
};

/** A named list, `all` for every one of them, in the order the table gives. */
function chosen(what, table, flag) {
  if (what === 'all') return Object.keys(table);
  const names = what.split(',').filter(Boolean);
  for (const name of names) {
    if (!table[name]) throw new Error(`--${flag} does not know '${name}'; it has ${Object.keys(table).join(', ')}`);
  }
  if (names.length === 0) throw new Error(`--${flag} was given nothing`);
  return names;
}

const CUT_NAMES = chosen(arg('cuts', 'all'), CUTS, 'cuts');
const GEM_NAMES = chosen(arg('gems', 'all'), GEMS, 'gems');
/** How far every table stands above the metal, in em. Constant, so the tables are coplanar. */
const PROUD = Number(arg('proud', '0.005'));
/** A pavilion as a fraction of the stone's own width, and how much of the pocket it may use. */
const PAVILION = Number(arg('pavilion', '0.42'));
const STONE_SEED = Number(arg('stoneSeed', '11'));
const PARTS = arg('parts', 'all');
if (PARTS !== 'all' && PARTS !== 'body') {
  throw new Error(`--parts is 'all' or 'body', got '${PARTS}'`);
}

const signed = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return a / 2;
};

/**
 * A point the whole cell can be seen from, which the centroid is not once the outline has taken a
 * bite out of it. Scaling a ring toward a point outside it turns the ring inside out, and a cap
 * drawn from one throws triangles clean outside the cell.
 */
function interiorPoint(poly) {
  const c = centroidOf(poly);
  if (inside(poly, c[0], c[1])) return c;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  let best = poly[0];
  let bestD = -1;
  const N = 14;
  for (let i = 1; i < N; i++) {
    for (let j = 1; j < N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const y = minY + ((maxY - minY) * j) / N;
      if (!inside(poly, x, y)) continue;
      let d = Infinity;
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) {
        const [ax, ay] = poly[l];
        const ex = poly[k][0] - ax;
        const ey = poly[k][1] - ay;
        const len2 = ex * ex + ey * ey || 1e-24;
        const t = Math.min(Math.max(((x - ax) * ex + (y - ay) * ey) / len2, 0), 1);
        d = Math.min(d, Math.hypot(x - (ax + t * ex), y - (ay + t * ey)));
      }
      if (d > bestD) {
        bestD = d;
        best = [x, y];
      }
    }
  }
  return best;
}

const byGem = new Map();
const cutCount = new Map();
let flattened = 0;
let unset = 0;

/** One stone in one pocket: the girdle where the pocket's wall goes vertical, the table above it. */
function setStone(poly, girdleZ, floorZ, cut, gem) {
  if (poly.length < 3) return false;
  const ring = signed(poly) < 0 ? [...poly].reverse() : poly;
  const c = interiorPoint(ring);
  if (!inside(ring, c[0], c[1])) return false;
  const width = Math.sqrt(area(ring));
  const crownH = PROUD + (girdleZ < D ? D - girdleZ : 0);
  // A pavilion with no room shallows rather than flattens: a stone with a flat bottom sitting on
  // the floor of its own pocket is a tile in a hole, which is what the wide cells used to read as.
  const room = (girdleZ - floorZ) * 0.94;
  const want = PAVILION * width;
  if (want > room) flattened++;
  const drop = Math.min(want, room);

  const at = (k, z, zig = 0) =>
    ring.map(([x, y], n) => {
      const s = zig ? k * (1 + (n % 2 ? zig : -zig)) : k;
      return [c[0] + (x - c[0]) * s, c[1] + (y - c[1]) * s, z];
    });
  const up = [at(1, girdleZ), ...cut.crown.map((r) => at(r.k, girdleZ + r.t * crownH, r.zig))];
  const down = [at(1, girdleZ), ...cut.pavilion.map((r) => at(r.k, girdleZ - r.t * drop, r.zig))];

  const out = byGem.get(gem) ?? [];
  const push = (...ps) => {
    for (const p of ps) out.push(p[0], p[1], p[2]);
  };
  for (const [lower, upper] of up.slice(0, -1).map((r, n) => [r, up[n + 1]])) {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      push(lower[i], lower[j], upper[j]);
      push(lower[i], upper[j], upper[i]);
    }
  }
  for (const [upper, lower] of down.slice(0, -1).map((r, n) => [r, down[n + 1]])) {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      push(upper[j], upper[i], lower[i]);
      push(upper[j], lower[i], lower[j]);
    }
  }
  // Both caps triangulated rather than fanned, for the same reason the apex is a ring and not a
  // point: a clipped cell is not convex, and a fan from one vertex leaves the cell.
  const faces = THREE.ShapeUtils.triangulateShape(
    ring.map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );
  const top = up.at(-1);
  const base = down.at(-1);
  for (const [a, b, d] of faces) {
    push(top[a], top[b], top[d]);
    push(base[d], base[b], base[a]);
  }
  byGem.set(gem, out);
  return true;
}

if (PARTS === 'all') {
  let rand = STONE_SEED;
  const random = () => {
    rand = (rand * 1664525 + 1013904223) % 4294967296;
    return rand / 4294967296;
  };
  for (let i = 0; i < LEVELS.length; i++) {
    if (!CELLS[i]) continue;
    const ceiling = i === 0 ? D : FLOORS[i - 1];
    const girdleZ = ceiling - lipDropOf(LEVELS[i]);
    for (const poly of CELLS[i].rings[last(i)]) {
      const cut = CUT_NAMES[Math.floor(random() * CUT_NAMES.length)];
      const gem = GEM_NAMES[Math.floor(random() * GEM_NAMES.length)];
      if (setStone(poly, girdleZ, FLOORS[i], CUTS[cut], gem)) {
        cutCount.set(cut, (cutCount.get(cut) ?? 0) + 1);
      } else unset++;
    }
  }
}

const SET = [...byGem].map(([gem, position]) => ({ gem, spec: GEMS[gem], position }));
if (SET.length > 0) {
  const total = [...cutCount.values()].reduce((n, c) => n + c, 0);
  console.log(`  ${total} stones set, in ${byGem.size} of ${GEM_NAMES.length} kinds of stone`);
  console.log(
    `    ${[...cutCount].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}`,
  );
  if (flattened > 0) {
    console.log(`    ${flattened} pavilion(s) shallowed to stay off the floor of the pocket`);
  }
  if (unset > 0) console.log(`    ${unset} pocket(s) too ragged to seat a stone in`);
}

const payload = { letter: LETTER, body: dump(plain ?? body), tilt: TILT, stones: SET };
const DUMP = arg('dump', '');
if (DUMP) {
  mkdirSync(dirname(resolve(DUMP)), { recursive: true });
  writeFileSync(resolve(DUMP), JSON.stringify(payload));
  console.log(`  wrote ${resolve(DUMP)}`);
  process.exit(0);
}
if (has('no-render')) process.exit(0);

mkdirSync(OUT, { recursive: true });
const TREES = {
  '/klieg/': resolve(ROOT, 'packages/core/dist'),
  '/three/': resolve(ROOT, 'node_modules/three/build'),
};
const FILES = {
  '/': [readFileSync(resolve(HERE, 'hollow.html')), 'text/html'],
  '/geometry.json': [Buffer.from(JSON.stringify(payload)), 'application/json'],
};


// Served by intercepting the page's own requests rather than over a socket: the page has to fetch
// its modules over http because `import` does not work from `file://`, but nothing about that
// needs a listening port — and a loopback that intermittently answers EADDRNOTAVAIL was failing
// runs after all the geometry was built.
const ORIGIN = 'http://klieg.spike';
async function serve(page) {
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const hit = FILES[path];
    if (hit) return route.fulfill({ body: hit[0], contentType: hit[1] });
    for (const [prefix, dir] of Object.entries(TREES)) {
      if (!path.startsWith(prefix)) continue;
      const file = resolve(dir, path.slice(prefix.length));
      if (!file.startsWith(dir)) return route.fulfill({ status: 403, body: '' });
      try {
        return route.fulfill({ body: readFileSync(file), contentType: 'text/javascript' });
      } catch {
        return route.fulfill({ status: 404, body: '' });
      }
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));
page.on('console', (m) => m.type() === 'error' && console.log(`  [console] ${m.text()}`));
await serve(page);
for (const look of arg('looks', 'gold').split(',')) {
  await page.goto(`${ORIGIN}/?look=${look}`);
  await page.waitForFunction(() => window.__shot === true, null, { timeout: 120_000 });
  const file = resolve(OUT, `hollow-${LETTER}-${look}.png`);
  writeFileSync(file, await page.screenshot());
  console.log(`  wrote ${file}`);
}
await browser.close();
process.exit(0);
