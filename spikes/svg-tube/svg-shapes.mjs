/**
 * SVG path data to `THREE.Shape[]`, the shape `buildTubeBlueprint` already takes.
 *
 * This mirrors `text/glyphs.ts` deliberately: the same y negation (SVG grows down, three grows up)
 * and the same containment-depth nesting, which decides holes without trusting winding order.
 */
import * as THREE from 'three';

const NESTING_SEGMENTS = 24;

/** Numbers may run together (`1-2`) and use exponents, so this cannot be a plain split. */
function tokenize(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) out.push(m[1] ?? Number(m[2]));
  return out;
}

/**
 * One `d` attribute to one contour per subpath, in the caller's coordinate space. `map` takes SVG
 * user units to layout em; it is applied to points rather than to the finished shape so curves stay
 * curves and the tube resampler sees the real arc length.
 */
export function pathToContours(d, map) {
  const t = tokenize(d);
  const contours = [];
  let shape = null;
  let cmd = null;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  // Reflected control point for S/T; null when the previous command was not the matching curve.
  let lastC = null;
  let lastQ = null;
  let i = 0;

  const move = (x, y) => {
    const p = map(x, y);
    shape = new THREE.Shape();
    shape.moveTo(p.x, p.y);
    contours.push(shape);
    cx = x;
    cy = y;
    startX = x;
    startY = y;
  };
  const line = (x, y) => {
    const p = map(x, y);
    shape?.lineTo(p.x, p.y);
    cx = x;
    cy = y;
  };
  const cubic = (x1, y1, x2, y2, x, y) => {
    const a = map(x1, y1);
    const b = map(x2, y2);
    const p = map(x, y);
    shape?.bezierCurveTo(a.x, a.y, b.x, b.y, p.x, p.y);
    lastC = { x: x2, y: y2 };
    cx = x;
    cy = y;
  };
  const quad = (x1, y1, x, y) => {
    const a = map(x1, y1);
    const p = map(x, y);
    shape?.quadraticCurveTo(a.x, a.y, p.x, p.y);
    lastQ = { x: x1, y: y1 };
    cx = x;
    cy = y;
  };

  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++];
    // A repeated coordinate run continues the last command; an implicit M continues as L.
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';

    const rel = cmd === cmd?.toLowerCase();
    const n = (k) => (rel ? [cx, cy][k % 2] : 0);
    const up = cmd?.toUpperCase();

    if (up !== 'C' && up !== 'S') lastC = null;
    if (up !== 'Q' && up !== 'T') lastQ = null;

    switch (up) {
      case 'M':
        move(t[i++] + n(0), t[i++] + n(1));
        break;
      case 'L':
        line(t[i++] + n(0), t[i++] + n(1));
        break;
      case 'H':
        line(t[i++] + n(0), cy);
        break;
      case 'V':
        line(cx, t[i++] + n(1));
        break;
      case 'C':
        cubic(t[i++] + n(0), t[i++] + n(1), t[i++] + n(0), t[i++] + n(1), t[i++] + n(0), t[i++] + n(1));
        break;
      case 'S': {
        // The first control point mirrors the previous curve's second about the current point.
        const rx = lastC ? 2 * cx - lastC.x : cx;
        const ry = lastC ? 2 * cy - lastC.y : cy;
        cubic(rx, ry, t[i++] + n(0), t[i++] + n(1), t[i++] + n(0), t[i++] + n(1));
        break;
      }
      case 'Q':
        quad(t[i++] + n(0), t[i++] + n(1), t[i++] + n(0), t[i++] + n(1));
        break;
      case 'T': {
        const rx = lastQ ? 2 * cx - lastQ.x : cx;
        const ry = lastQ ? 2 * cy - lastQ.y : cy;
        quad(rx, ry, t[i++] + n(0), t[i++] + n(1));
        break;
      }
      case 'Z':
        if (shape?.curves.length) shape.closePath();
        cx = startX;
        cy = startY;
        break;
      case 'A':
        throw new Error('svg-shapes: elliptical arcs are not supported; flatten them first');
      default:
        throw new Error(`svg-shapes: unknown path command ${cmd}`);
    }
  }
  return contours;
}

function containsPoint(polygon, point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Odd nesting depth is a hole in the contour that contains it. Ported from `text/glyphs.ts`. */
export function nest(contours) {
  const drawn = contours
    .map((contour) => ({ contour, polygon: contour.getPoints(NESTING_SEGMENTS) }))
    .filter((c) => c.polygon.length >= 3)
    .map((c) => ({ ...c, anchor: c.polygon[0] }));
  const outlines = drawn.map((o) => ({
    ...o,
    level: drawn.filter((other) => other !== o && containsPoint(other.polygon, o.anchor)).length,
  }));

  const shapes = [];
  for (const outline of outlines) {
    const container =
      outline.level % 2 === 1
        ? outlines.find((o) => o.level === outline.level - 1 && containsPoint(o.polygon, outline.anchor))
        : undefined;
    if (container) container.contour.holes.push(outline.contour);
    else shapes.push(outline.contour);
  }
  return shapes;
}

/**
 * Every `d` in an SVG string, each as its own shape list — one entry per `<path>`, which is what
 * makes a path the unit a tube blueprint is built from, the way a glyph is for text.
 */
export function svgToShapeGroups(svgText, emPerViewBoxHeight = 1) {
  const box = /viewBox="([^"]+)"/.exec(svgText);
  if (!box) throw new Error('svg-shapes: no viewBox');
  const [vx, vy, vw, vh] = box[1].trim().split(/[\s,]+/).map(Number);
  const s = emPerViewBoxHeight / vh;
  const cx = vx + vw / 2;
  const cy = vy + vh / 2;
  // Centred on the origin and y-negated, so the art lands where a word does.
  const map = (x, y) => ({ x: (x - cx) * s, y: -(y - cy) * s });

  const groups = [];
  for (const m of svgText.matchAll(/\sd="([^"]*)"/g)) {
    const shapes = nest(pathToContours(m[1], map));
    if (shapes.length) groups.push(shapes);
  }
  return { groups, width: vw * s, height: vh * s };
}
