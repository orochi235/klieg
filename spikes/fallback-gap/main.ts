import { createKlieg, type Klieg } from 'klieg';

// The driver calls these; nothing here decides anything, so the numbers stay the library's.
declare global {
  interface Window {
    setCase(c: {
      text: string;
      boxWidth: number;
      boxHeight: number;
      fontSize: number;
      framing: { width: number; height: number };
    }): Promise<void>;
    fireCase(): Promise<void>;
    teardown(): void;
  }
}

const masthead = document.getElementById('masthead') as HTMLElement;
const heading = document.getElementById('heading') as HTMLHeadingElement;

let klieg: Klieg | null = null;
let pending: { text: string } | null = null;

window.setCase = async (c) => {
  klieg?.destroy();
  klieg = null;
  masthead.classList.remove('masthead--lit');
  masthead.style.width = `${c.boxWidth}px`;
  masthead.style.height = `${c.boxHeight}px`;
  heading.style.fontSize = `${c.fontSize}px`;
  heading.textContent = c.text;
  pending = { text: c.text };
  // Layout has to settle before the anchor is measured, or the fit reads the previous box.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  klieg = createKlieg({
    fonts: { display: '/font.ttf' },
    placement: { kind: 'element', el: masthead },
    framing: c.framing,
  });
};

window.fireCase = async () => {
  if (!klieg || !pending) throw new Error('fixture: setCase first');
  masthead.classList.add('masthead--lit');
  // `bloom: false` so the ink read back is the letters. A glow spreads alpha across the whole box
  // and any threshold over it measures the light, not the type.
  // `hold: 'forever'` so the driver reads a settled pose rather than racing the exit.
  void klieg.fire(pending.text, { look: 'tubing', bloom: false, lighting: 'static', hold: 'forever' });
  await new Promise((r) => setTimeout(r, 1200));
};

window.teardown = () => {
  klieg?.destroy();
  klieg = null;
  masthead.classList.remove('masthead--lit');
};
