import {
  type ActiveSlot,
  acronym,
  type Clock,
  createKlieg,
  type EnterSlot,
  type ExitSlot,
  type FireOptions,
  fromEuler,
  type LookName,
  type MotionPiece,
  type PoseOffset,
} from 'klieg';
import * as THREE from 'three';
import { decodeConfig } from './show-config.js';

type Tick = (nowMs: number) => void;

/** Long enough that a page nobody is cycling re-fires only a handful of times a day. */
const STILL_HOLD_MS = 600_000;
const RESIZE_SETTLE_MS = 250;

/**
 * A rAF clock whose time only advances while the page is being watched, so a hidden tab or an
 * off-screen iframe costs nothing and the effect resumes where it left off instead of jumping.
 */
class ShowClock implements Clock {
  private t = 0;
  private readonly subs = new Set<Tick>();
  private raf: number | null = null;
  private last = 0;
  private awake = true;
  private drawn = false;

  constructor(private readonly onFirstFrame: () => void) {}

  now(): number {
    return this.t;
  }

  subscribe(fn: Tick): () => void {
    this.subs.add(fn);
    this.sync();
    return () => {
      this.subs.delete(fn);
      this.sync();
    };
  }

  setAwake(awake: boolean): void {
    this.awake = awake;
    this.sync();
  }

  private sync(): void {
    const wanted = this.awake && this.subs.size > 0;
    if (wanted === (this.raf !== null)) return;
    if (wanted) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    } else {
      if (this.raf !== null) cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  private readonly loop = (now: number): void => {
    // Reschedule first, as RafClock does: a throwing subscriber must not kill the loop.
    this.raf = requestAnimationFrame(this.loop);
    // Clamped, so a frame the browser skipped cannot teleport the effect forward on the next one.
    this.t += Math.min(64, Math.max(0, now - this.last));
    this.last = now;
    for (const fn of [...this.subs]) {
      if (!this.subs.has(fn)) continue;
      try {
        fn(this.t);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
    if (!this.drawn) {
      this.drawn = true;
      this.onFirstFrame();
    }
    this.sync();
  };
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`show: the page has no #${id}`);
  return found as T;
}

const stage = el('stage');
const veil = el('veil');
const looks = el('looks');
const looksRow = el('looksRow');
const fallback = el('fallback');

const config = decodeConfig(
  location.hash.slice(1) || new URLSearchParams(location.search).get('c'),
);
document.title = config.text.replace(/\s+/g, ' ').trim();
fallback.textContent = config.text;

const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cycling = !quiet && config.cycleMs > 0 && config.looks.length > 1;

const SETTLE_MS = 620;
const view = { yaw: 0, pitch: 0 };
const euler = new THREE.Euler(0, 0, 0, 'XYZ');
const point = new THREE.Vector3();
const turned: PoseOffset = { position: [0, 0, 0], rotation: [0, 0, 0] };

/**
 * Turns the whole word as one rigid body: every letter takes the shared rotation and moves to
 * where that rotation carries its own layout position. `transform` does this in one step, but it
 * is read once when the effect fires and this has to follow a live drag.
 */
const pivot: MotionPiece = {
  duration: 1,
  offset(_t, letter) {
    const x = letter.x ?? 0;
    const y = letter.y ?? 0;
    euler.set(view.pitch, view.yaw, 0);
    point.set(x, y, 0).applyEuler(euler);
    const position = turned.position as [number, number, number];
    const rotation = turned.rotation as [number, number, number];
    position[0] = point.x - x;
    position[1] = point.y - y;
    position[2] = point.z;
    rotation[0] = view.pitch;
    rotation[1] = view.yaw;
    return turned;
  },
};

// Layered into all three slots rather than just `active`: the slot weights are complementary, so
// this way the pivot holds steady through the enter and the exit instead of unwinding to head-on.
const layer = <T>(name: T, on: boolean): T | [T, typeof pivot] => (on ? [name, pivot] : name);
const enter = layer(config.enter ?? 'rise', config.pivot) as EnterSlot;
const active = layer(config.active ?? 'float', config.pivot) as ActiveSlot;
const exit = layer(config.exit ?? 'recede', config.pivot) as ExitSlot;

const DEG = Math.PI / 180;

function options(look: LookName): FireOptions {
  const base: FireOptions = {
    look,
    lighting: config.lighting,
    bloom: config.bloom,
    tint: config.tint,
    enter,
    active,
    exit,
    lineAlign: config.lineAlign,
    hold: cycling ? config.cycleMs : (config.hold ?? STILL_HOLD_MS),
    blendMs: config.blendMs,
    transform: config.transform
      ? fromEuler(
          config.transform.pitch * DEG,
          config.transform.yaw * DEG,
          config.transform.roll * DEG,
        )
      : undefined,
    // A long word in portrait is unreadable on one line; wrapping picks whatever fits largest.
    wrap: config.wrap,
  };
  if (!config.acronym) return base;
  const [, routine] = acronym(config.text, {
    caps: { tint: config.acronym.caps },
    read: config.acronym.read,
    settle: config.acronym.settle,
    hold: config.acronym.hold,
    exit: config.exit ?? 'fade',
    active: config.active ?? 'none',
  });
  // The routine owns `hold`, `tint`, `stages` and `lineAlign`; applying the config's own `hold`
  // after it would silently replace the read beat with the cycle's.
  return { ...base, ...routine };
}

const clock = new ShowClock(() => veil.classList.add('veil--gone'));
const klieg = createKlieg({
  fontUrl: `${import.meta.env.BASE_URL}font.ttf`,
  clock,
  policy: 'replace',
  // Anchored to the stage, which is `inset: 0` — the same box a fullscreen overlay would take, but
  // an anchored placement lifts `FIT_CAP`. Without that the framing below never binds: a short word
  // stops at 2.2x its natural size, which is the cap protecting a page the overlay is guest on.
  // `clickAnywhere` because the stage is `inset: 0`: there is no click on this page that is not a
  // click on the type, so a shared link may hold until the viewer presses.
  placement: { kind: 'element', el: stage, clickAnywhere: true },
  // Nothing shares this page with the type, so it takes far more of the frame than the library
  // leaves an overlay. Width was tuned on a 390x844 phone, where it is what binds a single line;
  // height only binds in a box far flatter than a phone — an embed in a wide tile — where 0.46 left
  // the word at a quarter of the width. Raising it cannot affect portrait, where width still binds.
  // `align` is explicit because an element placement defaults to `start`: the stage is the whole
  // page rather than a column of prose, so there is no text edge here for the word to meet.
  framing: { width: 0.84, height: 0.72, align: 'center' },
});

let index = 0;
let generation = 0;

function play(next: number): void {
  index = next;
  markActive(index);
  const gen = ++generation;
  void klieg.fire(config.text, options(config.looks[index] ?? 'gold')).then(() => {
    // A chip press or a resize fires again and bumps the generation; the effect it replaced must
    // not then queue a second one behind it.
    if (gen === generation) play(cycling ? (index + 1) % config.looks.length : index);
  });
}

const chips = config.looks.map((name, at) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = name;
  chip.addEventListener('click', () => play(at));
  looksRow.append(chip);
  return chip;
});

if (chips.length < 2 || !config.chrome) looks.classList.add('looks--hidden');

function markActive(at: number): void {
  for (const [k, chip] of chips.entries()) {
    chip.classList.toggle('chip--on', k === at);
    if (k === at) chip.setAttribute('aria-current', 'true');
    else chip.removeAttribute('aria-current');
  }
  chips[at]?.scrollIntoView({
    inline: 'center',
    block: 'nearest',
    behavior: quiet ? 'auto' : 'smooth',
  });
}

let resting = 0;

/** Eases the word back to head-on so a let-go always resolves, rather than leaving it askew. */
function returnToRest(): void {
  cancelAnimationFrame(resting);
  if (quiet) {
    view.yaw = 0;
    view.pitch = 0;
    return;
  }
  const from = { yaw: view.yaw, pitch: view.pitch };
  const start = performance.now();
  const step = (now: number) => {
    // rAF reports the frame's start time, which can precede the performance.now() taken on
    // release; an unclamped negative t inverts the ease and kicks the word further off-axis.
    const t = Math.min(1, Math.max(0, (now - start) / SETTLE_MS));
    const eased = 1 - (1 - t) ** 3;
    view.yaw = from.yaw * (1 - eased);
    view.pitch = from.pitch * (1 - eased);
    if (t < 1) resting = requestAnimationFrame(step);
  };
  resting = requestAnimationFrame(step);
}

if (config.pivot) {
  stage.addEventListener('pointerdown', (event) => {
    cancelAnimationFrame(resting);
    stage.setPointerCapture(event.pointerId);
    let last = { x: event.clientX, y: event.clientY };
    const move = (e: PointerEvent) => {
      // A half turn across the viewport's own width, so the gesture scales with the screen.
      const span = Math.max(1, stage.clientWidth);
      view.yaw += ((e.clientX - last.x) / span) * Math.PI;
      view.pitch += ((e.clientY - last.y) / span) * Math.PI;
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      stage.removeEventListener('lostpointercapture', up);
      returnToRest();
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    // Capture can go without a pointerup, and after that neither move nor up fires here — which
    // would leave a buttonless hover still turning the word.
    stage.addEventListener('lostpointercapture', up);
  });
}

let visible = !document.hidden;
let onScreen = true;
const wake = () => clock.setAwake(visible && onScreen);

document.addEventListener('visibilitychange', () => {
  visible = !document.hidden;
  wake();
});

// document.hidden says nothing about an iframe scrolled out of the host page's viewport, which is
// exactly how this route gets embedded.
new IntersectionObserver((entries) => {
  const latest = entries.at(-1);
  if (!latest) return;
  onScreen = latest.isIntersecting;
  wake();
}).observe(stage);

let viewport = `${innerWidth}x${innerHeight}`;
let settle: ReturnType<typeof setTimeout> | undefined;

addEventListener('resize', () => {
  clearTimeout(settle);
  settle = setTimeout(() => {
    const now = `${innerWidth}x${innerHeight}`;
    if (now === viewport) return;
    viewport = now;
    // The word's fit is measured when it is built, so a rotated phone needs a fresh one.
    play(index);
  }, RESIZE_SETTLE_MS);
});

if (klieg.supported) {
  play(0);
} else {
  document.body.classList.add('is-unsupported');
  veil.classList.add('veil--gone');
}
