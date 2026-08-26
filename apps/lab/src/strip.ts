import { type Align, createKlieg, type Klieg } from 'klieg';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`strip: the page has no #${id}`);
  return found as T;
}

const masthead = el<HTMLElement>('masthead');
const align = el<HTMLSelectElement>('align');
const heading = el<HTMLHeadingElement>('heading');
const notes = el<HTMLParagraphElement>('notes');

// The consumer's own call, not the library's: the page keeps its plain heading and never fires.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Long enough to inspect the fit; a real masthead would hold a fraction of this. */
const HOLD_MS = 8000;

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
  await k.fire(text, { look: 'gold', hold: HOLD_MS });
  masthead.classList.remove('masthead--lit');
}

el<HTMLButtonElement>('fire').addEventListener('click', () => void fire('klieg'));
el<HTMLButtonElement>('fireLong').addEventListener('click', () => void fire('anchored type'));
align.addEventListener('change', () => void fire(heading.textContent ?? 'klieg'));
el<HTMLButtonElement>('destroy').addEventListener('click', () => {
  klieg?.destroy();
  klieg = null;
  masthead.classList.remove('masthead--lit');
  notes.textContent = `destroyed; anchor position is now "${masthead.style.position || '(unset)'}"`;
});

heading.textContent = 'klieg';
void fire('klieg');
