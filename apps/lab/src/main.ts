import {
  ACTIVE_NAMES,
  type Align,
  acronym,
  type Clock,
  createKlieg,
  EFFECTS,
  type EffectSpec,
  ENTER_NAMES,
  EXIT_NAMES,
  type FireOptions,
  fromEuler,
  type Klieg,
  LIGHTING_NAMES,
  LOOK_NAMES,
  type Look,
  type LookSpec,
  POLICY_NAMES,
  roving,
  type SelectableMode,
  type SurfaceKind,
  specOf,
} from 'klieg';

import { CATALOG } from './fonts/catalog.js';
import { encodeConfig, type ShowConfig } from './show-config.js';

const DEG = Math.PI / 180;

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`lab: the page has no #${id}`);
  return found as T;
}

const logEl = el<HTMLPreElement>('log');
const lines: string[] = [];

function log(line: string): void {
  lines.push(`${new Date().toLocaleTimeString()} ${line}`);
  if (lines.length > 40) lines.shift();
  logEl.textContent = lines.join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

function choice<T extends string>(id: string, names: readonly T[]) {
  const select = el<HTMLSelectElement>(id);
  for (const name of names) select.add(new Option(name));
  return { select, get: () => select.value as T };
}

const enter = choice('enter', ENTER_NAMES);
const active = choice('active', ACTIVE_NAMES);
const exit = choice('exit', EXIT_NAMES);
const look = choice('look', LOOK_NAMES);
const lighting = choice('lighting', LIGHTING_NAMES);
const policy = choice('policy', POLICY_NAMES);

const textInput = el<HTMLTextAreaElement>('text');
const bloomInput = el<HTMLSelectElement>('bloom');
const wrapInput = el<HTMLInputElement>('wrap');
const selectableInput = el<HTMLSelectElement>('selectable');
const tintInput = el<HTMLInputElement>('tint');
const tintOnInput = el<HTMLInputElement>('tintOn');
const holdClickInput = el<HTMLInputElement>('holdClick');
const modalInput = el<HTMLInputElement>('modal');
const lineAlignInput = el<HTMLSelectElement>('lineAlign');
const shareChromeInput = el<HTMLInputElement>('shareChrome');
const shareReadableInput = el<HTMLInputElement>('shareReadable');
const acronymInput = el<HTMLInputElement>('acronym');
const capsTintInput = el<HTMLInputElement>('capsTint');
const grainInput = el<HTMLInputElement>('grain');
const densityInput = el<HTMLInputElement>('density');
const surfacesInput = el<HTMLSelectElement>('surfaces');
const flickerInput = el<HTMLInputElement>('flicker');
const hueInput = el<HTMLInputElement>('hue');
const rovingInput = el<HTMLInputElement>('roving');
const number = (id: string) => Number(el<HTMLInputElement>(id).value);

/** The four surface combinations the lab exposes; `connector` runs have no slider of their own. */
const SURFACE_PRESETS: Record<string, SurfaceKind[]> = {
  front: ['front'],
  'front+wall': ['front', 'wall'],
  'front+back': ['front', 'back'],
  all: ['front', 'back', 'wall'],
};

/** Reverses SURFACE_PRESETS for seeding the picker from a look's own `surfaces` array. */
function surfacesKeyFor(surfaces: SurfaceKind[]): string {
  const set = new Set(surfaces);
  for (const [key, list] of Object.entries(SURFACE_PRESETS)) {
    if (list.length === set.size && list.every((s) => set.has(s))) return key;
  }
  return 'front';
}

/**
 * Every control's value, base64 in the hash. Tuning a shader means reloading constantly, and
 * losing the whole panel on each reload makes comparing two settings impossible.
 */
const CONTROL_IDS = [
  'text',
  'enter',
  'active',
  'exit',
  'look',
  'lighting',
  'policy',
  'hold',
  'blend',
  'yaw',
  'pitch',
  'roll',
  'grain',
  'density',
  'radius',
  'level',
  'runs',
  'minRun',
  'litAmount',
  'flicker',
  'hue',
  'roving',
  'amplitude',
  'wallDepth',
  'wallRise',
  'cornerBreak',
  'cornerConnect',
  'surfaces',
  'count',
  'chunkSize',
  'align',
  'cluster',
  'proud',
  'bodyOpacity',
  'tint',
  'tintOn',
  'bloom',
  'wrap',
  'selectable',
  'holdClick',
  'modal',
  'lineAlign',
  'acronym',
  'capsTint',
  'read',
  'settle',
  'acroHold',
];

type ControlState = Record<string, string | boolean>;

function controls(): HTMLInputElement[] {
  return CONTROL_IDS.map((id) => el<HTMLInputElement>(id));
}

function readState(): ControlState {
  const state: ControlState = {};
  for (const input of controls()) {
    state[input.id] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return state;
}

function writeState(state: ControlState): void {
  for (const input of controls()) {
    const value = state[input.id];
    if (value === undefined) continue;
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value);
  }
}

function saveHash(): void {
  // replaceState rather than location.hash: assigning the hash pushes a history entry, and
  // tweaking a slider would bury the back button under hundreds of them.
  const encoded = btoa(encodeURIComponent(JSON.stringify(readState())));
  history.replaceState(null, '', `#${encoded}`);
}

function loadHash(): boolean {
  const raw = location.hash.slice(1);
  if (!raw) return false;
  try {
    writeState(JSON.parse(decodeURIComponent(atob(raw))) as ControlState);
    return true;
  } catch {
    // A hand-edited or truncated hash is not worth failing the page over.
    log('ignored an unreadable hash');
    return false;
  }
}

/**
 * Grain reads as cells per em — bigger number, finer flakes. The sliders always apply and are
 * seeded from whichever look is chosen, so they read as that look's own tuning until dragged.
 * A sentinel position cannot do this job: a range input clamps its value into [min, max], so a
 * "0 means leave it alone" reading silently becomes min and overrides every look.
 */
function chosenLook(): Look {
  const name = look.get();
  const spec = specOf(name);
  const tuned: LookSpec = { ...spec };

  if (spec.flake) {
    tuned.flake = { ...spec.flake, size: 1 / number('grain'), density: number('density') / 100 };
  }

  if (spec.opacity !== undefined) tuned.opacity = number('bodyOpacity') / 100;

  const decoration = spec.decoration;
  if (decoration?.kind === 'tube') {
    tuned.decoration = {
      ...decoration,
      radius: number('radius') / 1000,
      level: number('level') / 1000,
      runs: number('runs'),
      minRun: number('minRun') / 1000,
      select: { ...decoration.select, amount: number('litAmount') / 100 },
      amplitude: number('amplitude') / 1000,
      wallDepth: number('wallDepth') / 100,
      wallRise: number('wallRise') / 100,
      corners: {
        break: number('cornerBreak'),
        connect: number('cornerConnect'),
      },
      surfaces: SURFACE_PRESETS[surfacesInput.value] ?? decoration.surfaces,
    };
  } else if (decoration?.kind === 'chunks') {
    tuned.decoration = {
      ...decoration,
      count: number('count'),
      size: number('chunkSize') / 1000,
      align: number('align') / 100,
      cluster: number('cluster') / 100,
      proud: number('proud') / 100,
    };
  }

  return spec.flake || spec.decoration || spec.opacity !== undefined ? tuned : name;
}

/**
 * Panels and flakes live at different scales — leather sits near 3 cells per em where glitter
 * sits near 90 — so one range cannot serve both. A shared range clamps whichever look falls
 * outside it and silently retunes that look the moment it is picked.
 */
function seedSliders(): void {
  const spec = specOf(look.get());

  if (spec.flake) {
    grainInput.min = spec.flake.bump ? '1' : '20';
    grainInput.max = spec.flake.bump ? '24' : '400';
    grainInput.value = String(Math.round(1 / spec.flake.size));
    densityInput.value = String(Math.round(spec.flake.density * 100));
  }

  el<HTMLInputElement>('bodyOpacity').value = String(Math.round((spec.opacity ?? 1) * 100));

  const decoration = spec.decoration;
  if (decoration?.kind === 'tube') {
    el<HTMLInputElement>('radius').value = String(Math.round(decoration.radius * 1000));
    el<HTMLInputElement>('level').value = String(Math.round(decoration.level * 1000));
    el<HTMLInputElement>('runs').value = String(decoration.runs);
    el<HTMLInputElement>('minRun').value = String(Math.round(decoration.minRun * 1000));
    el<HTMLInputElement>('litAmount').value = String(
      Math.round((decoration.select.amount ?? 1) * 100),
    );
    el<HTMLInputElement>('amplitude').value = String(
      Math.round((decoration.amplitude ?? 0) * 1000),
    );
    el<HTMLInputElement>('wallDepth').value = String(
      Math.round((decoration.wallDepth ?? 0.5) * 100),
    );
    el<HTMLInputElement>('wallRise').value = String(Math.round((decoration.wallRise ?? 0) * 100));
    const corners = decoration.corners ?? { break: 1, connect: 0 };
    el<HTMLInputElement>('cornerBreak').value = String(Math.round(corners.break * 100));
    el<HTMLInputElement>('cornerConnect').value = String(Math.round(corners.connect * 100));
    surfacesInput.value = surfacesKeyFor(decoration.surfaces);
  } else if (decoration?.kind === 'chunks') {
    el<HTMLInputElement>('count').value = String(decoration.count);
    el<HTMLInputElement>('chunkSize').value = String(Math.round(decoration.size * 1000));
    el<HTMLInputElement>('align').value = String(Math.round(decoration.align * 100));
    el<HTMLInputElement>('cluster').value = String(Math.round(decoration.cluster * 100));
    el<HTMLInputElement>('proud').value = String(Math.round(decoration.proud * 100));
  }
}

/** One bad tube — the sign's first run, so a pinned shot always lands on the same glass. */
const FLICKER: EffectSpec[] = [
  { piece: 'flicker', target: { kind: 'run', by: 'index', count: 1 } },
];

/** Every run, since the whole sign changes colour together. */
const HUE: EffectSpec[] = [{ piece: 'hue', target: { kind: 'run', by: 'index', amount: 1 } }];

/** Every run: the wrapper picks the holder out of the pool it was given, so a subset would let the
 * fault land on a part this effect does not drive. */
const ROVING: EffectSpec[] = [
  { piece: roving(EFFECTS.flicker()), target: { kind: 'run', by: 'index', amount: 1 } },
];

function chosenEffects(): EffectSpec[] | undefined {
  const specs = [
    ...(flickerInput.checked ? FLICKER : []),
    ...(hueInput.checked ? HUE : []),
    ...(rovingInput.checked ? ROVING : []),
  ];
  return specs.length > 0 ? specs : undefined;
}

/**
 * Holds every frame at one elapsed time, so a shot of a time-varying effect is a function of the
 * pin rather than of when it was taken. `?pin=<ms>` turns it on; the visual suite needs it.
 */
class PinnedClock implements Clock {
  constructor(private readonly at: number) {}

  now(): number {
    return 0;
  }

  subscribe(fn: (nowMs: number) => void): () => void {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      fn(this.at);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }
}

const requestedPin = Number(new URLSearchParams(location.search).get('pin'));
const PIN = Number.isFinite(requestedPin) && location.search.includes('pin=') ? requestedPin : null;

const FONT_URL = `${import.meta.env.BASE_URL}font.ttf`;

/**
 * What `scripts/fonts.mjs` last downloaded, rather than the catalogue: an entry whose binary is
 * not here would offer a face that 404s. `node scripts/fonts.mjs <id>` is what adds one.
 */
const onDisk: string[] = await fetch(`${import.meta.env.BASE_URL}fonts/manifest.json`)
  .then((res) => (res.ok ? (res.json() as Promise<string[]>) : []))
  .catch(() => []);

const FACES = CATALOG.filter((face) => onDisk.includes(face.id));
const FONTS: Record<string, string> = {
  default: FONT_URL,
  ...Object.fromEntries(
    FACES.map((face) => [face.id, `${import.meta.env.BASE_URL}fonts/${face.id}.ttf`]),
  ),
};

const font = choice('font', ['default', ...FACES.map((face) => face.id)]);
for (const face of FACES) {
  const option = [...font.select.options].find((o) => o.value === face.id);
  if (!option) continue;
  // Value first: an Option built from text alone mirrors it, and relabelling would then
  // rename the font the picker asks for.
  option.value = face.id;
  option.text = `${face.name} (${face.class})`;
}

function create(): Klieg {
  const instance = createKlieg({
    fonts: FONTS,
    policy: policy.get(),
    clock: PIN === null ? undefined : new PinnedClock(PIN),
  });
  const pinned = PIN === null ? '' : `, pinned at ${PIN}ms`;
  log(
    `instance up (policy ${policy.get()}${pinned}${instance.supported ? '' : ', webgl2 UNSUPPORTED'})`,
  );
  return instance;
}

let bk = create();

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function fire(text: string): void {
  log(`fire ${JSON.stringify(text)}`);
  const acrostic = acronymInput.checked;
  // `active` and `exit` move inside the routine when it is on: they describe how the lower case
  // leaves and what the gathered acronym does, which are stages rather than the fire's own slots.
  const options: FireOptions = {
    enter: enter.get(),
    font: font.get(),
    ...(acrostic ? {} : { active: active.get(), exit: exit.get() }),
    look: chosenLook(),
    effects: chosenEffects(),
    lighting: lighting.get(),
    tint: tintOnInput.checked ? Number.parseInt(tintInput.value.slice(1), 16) : undefined,
    // Sliders are degrees for a human; fromEuler wants radians, three's XYZ order.
    transform: fromEuler(number('pitch') * DEG, number('yaw') * DEG, number('roll') * DEG),
    hold: holdClickInput.checked ? 'click' : number('hold'),
    blendMs: number('blend'),
    // Three-way rather than a checkbox: FireOptions.bloom wins over a look's own request, so an
    // unchecked box could only mean "unset" — leaving no way to switch neon's own bloom off.
    bloom: bloomInput.value === 'auto' ? undefined : bloomInput.value === 'on',
    lineAlign: lineAlignInput.value as Align,
    wrap: wrapInput.checked,
    selectable: selectableInput.value as SelectableMode,
    modal: modalInput.checked,
    placement: { kind: 'fullscreen' },
  };
  if (acrostic) {
    const click = holdClickInput.checked;
    const [, routine] = acronym(text, {
      caps: { tint: Number.parseInt(capsTintInput.value.slice(1), 16) },
      read: click ? 'click' : number('read'),
      settle: number('settle'),
      hold: click ? 'click' : number('acroHold'),
      exit: exit.get(),
      active: active.get(),
    });
    // The routine owns `hold`, `tint` and `stages`; everything else above is still the lab's.
    Object.assign(options, routine);
    const caps = [...text].filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length;
    if (caps < 2) log(`  acronym: only ${caps} capital(s) — nothing to gather`);
  }
  bk.fire(text, options).then(
    () => log(`done  ${JSON.stringify(text)}`),
    (err: unknown) => {
      log(`FAILED ${JSON.stringify(text)}: ${message(err)}`);
      console.error(err);
    },
  );
}

interface Step extends FireOptions {
  text: string;
}

const SEQUENCES: { name: string; steps: Step[] }[] = [
  {
    name: 'enters',
    steps: ENTER_NAMES.filter((name) => name !== 'none').map((name) => ({
      text: name.toUpperCase(),
      enter: name,
      active: 'none',
      exit: 'fade',
      hold: 400,
    })),
  },
  {
    name: 'looks',
    steps: LOOK_NAMES.map((name) => ({
      text: name.toUpperCase(),
      look: name,
      enter: 'rise',
      active: 'none',
      exit: 'recede',
      hold: 900,
    })),
  },
  {
    name: 'moment',
    steps: [
      { text: 'THREE', enter: 'rise', active: 'float', exit: 'recede', look: 'chrome', hold: 150 },
      { text: 'TWO', enter: 'rise', active: 'float', exit: 'recede', look: 'chrome', hold: 150 },
      { text: 'ONE', enter: 'rise', active: 'pulse', exit: 'recede', look: 'oil', hold: 150 },
      {
        text: 'JACKPOT!',
        enter: 'slam',
        active: 'none',
        exit: 'shatter',
        look: 'gold',
        hold: 2400,
        bloom: true,
      },
    ],
  },
  {
    name: 'acrostic',
    steps: [
      {
        text: 'NIGHT FALLS ON THE STREET\nEVERY WINDOW BURNS\nONLY THE SIGN KNOWS\nNOBODY READS IT',
        enter: 'rise',
        active: 'none',
        exit: 'recede',
        look: 'neon',
        tint: (l) => (l.column === 0 ? 0x2df0ff : undefined),
        hold: 'click',
        stages: [
          { keep: (l) => l.column === 0, exit: 'fade', as: 'stack', hold: 'click' },
          { as: 'line', hold: 'click', tween: { duration: 900, delayBy: { scale: 0.45 } } },
        ],
      },
    ],
  },
];

let playing = false;

async function play(sequence: (typeof SEQUENCES)[number]): Promise<void> {
  if (playing) return;
  playing = true;
  // Disabled rather than silently ignored: a sequence runs for seconds, and the greyed button is
  // the only cue that a second click would do nothing.
  for (const button of sequenceButtons) button.disabled = true;
  log(`sequence "${sequence.name}"`);
  // Captured once: bk may be reassigned mid-sequence (DESTROY, policy change), and this
  // instance's fire() must keep resolving instead of handing later steps to a new one.
  const instance = bk;
  try {
    for (const { text, ...options } of sequence.steps) {
      await instance.fire(text, options);
      log(`  done  "${text}"`);
    }
    log(`sequence "${sequence.name}" done`);
  } catch (err) {
    log(`sequence "${sequence.name}" FAILED: ${message(err)}`);
    console.error(err);
  } finally {
    playing = false;
    for (const button of sequenceButtons) button.disabled = false;
  }
}

const sequenceRow = el('sequences');
const sequenceButtons = SEQUENCES.map((sequence) => {
  const button = document.createElement('button');
  button.textContent = sequence.name;
  button.addEventListener('click', () => void play(sequence));
  sequenceRow.append(button);
  return button;
});

/**
 * The performance, not the look authoring: `/show/` validates every field on the way back in, and
 * the tube and chunk sliders would each need their own clamp for a link nobody could paste.
 * See `docs/superpowers/specs/2026-08-26-share-links-design.md`.
 */
function shareConfig(): Partial<ShowConfig> {
  const click = holdClickInput.checked;
  const yaw = number('yaw');
  const pitch = number('pitch');
  const roll = number('roll');
  return {
    text: textInput.value,
    look: look.get(),
    lighting: lighting.get(),
    enter: enter.get(),
    active: active.get(),
    exit: exit.get(),
    lineAlign: lineAlignInput.value as Align,
    transform: yaw || pitch || roll ? { yaw, pitch, roll } : undefined,
    tint: tintOnInput.checked ? Number.parseInt(tintInput.value.slice(1), 16) : undefined,
    bloom: bloomInput.value === 'auto' ? undefined : bloomInput.value === 'on',
    hold: click ? 'click' : number('hold'),
    blendMs: number('blend'),
    wrap: wrapInput.checked,
    chrome: shareChromeInput.checked,
    // `cycleMs: 0` never advances: a link presents what was composed rather than a slideshow.
    cycleMs: 0,
    acronym: acronymInput.checked
      ? {
          caps: Number.parseInt(capsTintInput.value.slice(1), 16),
          read: click ? 'click' : number('read'),
          settle: number('settle'),
          hold: click ? 'click' : number('acroHold'),
        }
      : undefined,
  };
}

const copyLinkButton = el<HTMLButtonElement>('copyLink');
copyLinkButton.addEventListener('click', () => {
  const url = new URL('show/', location.href);
  // Opaque and in the query by default. A readable hash gives the joke away before the page opens,
  // and iMessage ends the link at the '#' and sends the rest as a message of its own.
  if (shareReadableInput.checked) url.hash = encodeConfig(shareConfig());
  else url.searchParams.set('c', encodeConfig(shareConfig(), true));
  const link = url.toString();
  const done = (word: string) => {
    copyLinkButton.textContent = word;
    log(`${word}: ${link}`);
    setTimeout(() => {
      copyLinkButton.textContent = 'copy link';
    }, 2000);
  };
  // The log carries the link either way, so a denied clipboard still leaves it reachable.
  navigator.clipboard?.writeText(link).then(
    () => done('copied'),
    () => done('logged'),
  );
});

const fireCurrent = () => fire(textInput.value);

el('fire').addEventListener('click', fireCurrent);
el('burst').addEventListener('click', () => {
  for (const n of [1, 2, 3]) fire(`${textInput.value} ${n}`);
});
el('destroy').addEventListener('click', () => {
  bk.destroy();
  log('destroyed');
  bk = create();
});
policy.select.addEventListener('change', () => {
  bk.destroy();
  bk = create();
});

// Greyed rather than ignored: a look reads a grain, a tube or a chunk field only if its spec
// carries one, and a live slider that does nothing reads as a broken slider.
function syncDisabled(): void {
  const spec = specOf(look.get());
  grainInput.disabled = densityInput.disabled = spec.flake === undefined;
  const tube = spec.decoration?.kind === 'tube';
  const chunks = spec.decoration?.kind === 'chunks';
  for (const id of [
    'radius',
    'level',
    'runs',
    'minRun',
    'litAmount',
    'amplitude',
    'wallDepth',
    'wallRise',
    'cornerBreak',
    'cornerConnect',
  ]) {
    el<HTMLInputElement>(id).disabled = !tube;
  }
  surfacesInput.disabled = flickerInput.disabled = !tube;
  hueInput.disabled = rovingInput.disabled = !tube;
  for (const id of ['count', 'chunkSize', 'align', 'cluster', 'proud']) {
    el<HTMLInputElement>(id).disabled = !chunks;
  }
  el<HTMLInputElement>('bodyOpacity').disabled = spec.opacity === undefined;
}

look.select.addEventListener('change', seedSliders);

/**
 * A restored hash can carry `enter: none` / `active: none`, which renders as a live effect holding
 * one pose — indistinguishable from a lab that has stopped animating. A plain reload does not
 * clear it, so the state has to be visible rather than inferred, and reachable to undo.
 */
function announceRestored(): void {
  const still = ['enter', 'active', 'exit'].filter(
    (id) => el<HTMLSelectElement>(id).value === 'none',
  );
  const banner = el('restored');
  banner.textContent = still.length
    ? `restored from the URL, with ${still.join('/')} at none — the type will hold a pose. `
    : 'restored from the URL. ';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'reset';
  reset.addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  });
  banner.append(reset);
}

// A hash carries the sliders the viewer left them at; without one they start at the look's own.
if (loadHash()) announceRestored();
else seedSliders();
syncDisabled();
for (const input of controls()) {
  input.addEventListener('change', () => {
    syncDisabled();
    saveHash();
  });
  input.addEventListener('input', saveHash);
}

holdClickInput.addEventListener('change', () => {
  modalInput.disabled = !holdClickInput.checked;
  if (!holdClickInput.checked) modalInput.checked = false;
});
addEventListener('keydown', (e) => {
  // Space must not swallow typing, nor double-fire the button it already activated.
  const inDock = e.target instanceof HTMLElement && e.target.closest('.dock') !== null;
  if (e.code !== 'Space' || inDock) return;
  e.preventDefault();
  fireCurrent();
});

addEventListener('unhandledrejection', (e) => log(`unhandled rejection: ${String(e.reason)}`));
addEventListener('error', (e) => log(`error: ${e.message}`));

if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  log('prefers-reduced-motion is on — the type holds a pose instead of travelling');
}
