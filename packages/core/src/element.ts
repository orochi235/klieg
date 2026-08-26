import type { Sign, SignOptions } from './sign/index.js';

const TAG = 'klieg-sign';
const STYLE_MARK = 'data-klieg-sign';
const FALLBACK = 'data-klieg-fallback';

/**
 * `display` and `position` are not taste: klieg's `claimAnchor` refuses `display: contents|inline`
 * and needs a containing block. `@layer` puts every rule here below any the consumer writes, so
 * overriding one needs no specificity game.
 */
const CSS = `@layer klieg {
  ${TAG} { display: block; position: relative; }
  ${TAG}[lit] [${FALLBACK}] { color: transparent; }
}`;

function installStyle(doc: Document): void {
  if (doc.head.querySelector(`style[${STYLE_MARK}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARK, '');
  style.textContent = CSS;
  doc.head.appendChild(style);
}

class KliegSign extends HTMLElement {
  static observedAttributes = [
    'font',
    'text',
    'look',
    'tint',
    'framing-width',
    'framing-height',
    'align',
    'lighting',
    'bloom',
  ];

  /** Anything an attribute cannot serialize, and the full `FireOptions` escape hatch. */
  declare look?: SignOptions['look'];
  declare effects?: SignOptions['effects'];
  declare options?: SignOptions['fire'];

  #sign: Sign | null = null;
  /** Bumped on every connect and disconnect, so a late import lands on a stale element and stops. */
  #token = 0;

  connectedCallback(): void {
    installStyle(this.ownerDocument);
    const token = ++this.#token;

    // The parser reaches the open tag before the children, so an element upgraded during parsing
    // sees none of them. Waiting for the document is the only reading of "my fallback content".
    const start = () => {
      if (token !== this.#token || !this.isConnected) return;
      this.#markFallback();
      void import('./sign/index.js').then(({ sign }) => {
        if (token !== this.#token || !this.isConnected) return;
        this.#sign = sign(this, {
          ...this.#options(),
          onLit: (on) => this.toggleAttribute('lit', on),
        });
      });
    };

    if (this.ownerDocument.readyState === 'loading') {
      this.ownerDocument.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  disconnectedCallback(): void {
    this.#token++;
    this.#sign?.destroy();
    this.#sign = null;
    this.removeAttribute('lit');
  }

  attributeChangedCallback(): void {
    this.#sign?.update(this.#options());
  }

  /** Whatever the page put here, before klieg appends a canvas and a text layer of its own. */
  #markFallback(): void {
    for (const child of this.children) {
      if (child.tagName !== 'CANVAS') child.setAttribute(FALLBACK, '');
    }
  }

  #options(): SignOptions {
    return { font: this.getAttribute('font') ?? '' };
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, KliegSign);

export { KliegSign };
