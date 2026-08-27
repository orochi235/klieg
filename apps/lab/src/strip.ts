import {
  type Align,
  createKlieg,
  EFFECTS,
  type FireOptions,
  type Klieg,
  lamp,
  orbit,
  sweep,
  track,
} from 'klieg';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`strip: the page has no #${id}`);
  return found as T;
}

const masthead = el<HTMLElement>('masthead');
const align = el<HTMLSelectElement>('align');
const liveness = el<HTMLSelectElement>('liveness');
const heading = el<HTMLHeadingElement>('heading');
const notes = el<HTMLParagraphElement>('notes');

// The consumer's own call, not the library's: the page keeps its plain heading and never fires.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Every liveness preset below is about what a sign does over a long hold; eight seconds shows
 * none of them. */
const HOLD_MS = 40000;

let klieg: Klieg | null = null;
// Framing is fixed for an instance's lifetime, so changing the alignment rebuilds it.
let built: string | null = null;

function instance(): Klieg {
  const wanted = align.value as Align | '';
  if (klieg && built === wanted) return klieg;
  klieg?.destroy();
  built = wanted;
  klieg = createKlieg({
    fontUrl: '/font.ttf',
    placement: { kind: 'element', el: masthead },
    // Unset on purpose when the page asks for it: the default is what a consumer gets.
    framing: { width: 0.94, height: 0.66, ...(wanted ? { align: wanted } : {}) },
  });
  return klieg;
}

/**
 * Four ways to keep an anchored sign alive over a long hold. Each is built per call: `track` and the
 * clock-driven lamp sources carry their own state, so one piece belongs to one fire.
 */
const LIVENESS: Record<string, () => Partial<FireOptions>> = {
  none: () => ({}),
  // Turns the shared environment on a clock. Never moves a letter, so an anchored canvas has
  // nothing to crop, and it leaves `tint` alone.
  raking: () => ({ lighting: [sweep({ periodMs: 14000 }), track({ yawRange: 0 })] }),
  // Light on the parts near a position rather than a turn of the whole room. Driven by the clock
  // rather than the cursor, which `lighting: 'pointer'` already has.
  lamp: () => ({
    lighting: 'static',
    effects: [
      {
        piece: lamp({ source: orbit({ radius: 0.4 }), radius: 0.5, strength: 1.4, duration: 9000 }),
        target: { kind: 'run', by: 'index', amount: 1 },
      },
    ],
  }),
  // The only one that moves geometry, which is what an anchored canvas crops. Its yaw is small
  // enough to survive most framings; `float`'s bob is the one that wants a lower `framing` share.
  shimmer: () => ({ active: 'shimmer' }),
  // A hue piece writes color every frame and so overrides `tint`. Only `span: 1` meets itself at
  // the loop seam; a narrow span stays near the tinted color and snaps back there once a pass.
  breathing: () => ({
    effects: [
      {
        piece: EFFECTS.hue({ span: 0.08, spread: 0.3, duration: 12000 }),
        target: { kind: 'run', by: 'index', amount: 1 },
      },
    ],
  }),
};

async function fire(text: string): Promise<void> {
  if (still) {
    notes.textContent = 'reduced motion: the page keeps its heading and klieg never fires.';
    return;
  }
  const k = instance();
  if (!k.supported) {
    notes.textContent = 'no webgl: the page keeps its heading.';
    return;
  }
  masthead.classList.add('masthead--lit');
  notes.textContent = `anchor box ${masthead.clientWidth}×${masthead.clientHeight}, align ${align.value || '(default)'}`;
  // `tubing` rather than `gold`: `lamp` and `breathing` reach run parts, and only the tube looks
  // have any.
  await k.fire(text, { look: 'tubing', hold: HOLD_MS, ...LIVENESS[liveness.value]?.() });
  masthead.classList.remove('masthead--lit');
}

el<HTMLButtonElement>('fire').addEventListener('click', () => void fire('klieg'));
el<HTMLButtonElement>('fireLong').addEventListener('click', () => void fire('anchored type'));
align.addEventListener('change', () => void fire(heading.textContent ?? 'klieg'));
liveness.addEventListener('change', () => void fire(heading.textContent ?? 'klieg'));
el<HTMLButtonElement>('destroy').addEventListener('click', () => {
  klieg?.destroy();
  klieg = null;
  masthead.classList.remove('masthead--lit');
  notes.textContent = `destroyed; anchor position is now "${masthead.style.position || '(unset)'}"`;
});

heading.textContent = 'klieg';
void fire('klieg');
