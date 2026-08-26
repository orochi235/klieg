import type { Sign, SignOptions } from './sign/index.js';
import type { Align } from './text/layout.js';

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

/** A framing fraction the page did not write, or wrote as something that is not a number. */
function fraction(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

const ALIGNS: readonly Align[] = ['start', 'center', 'end'];

/** An unknown name is omitted: `edgeFor` reads anything but `center` as an edge, so passing one
 * through would align to `end` rather than leaving klieg's default standing. */
function alignment(raw: string | null): Align | undefined {
  return ALIGNS.find((known) => known === raw);
}

function optional<K extends string, T>(key: K, value: T | undefined): { [P in K]?: T } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: T };
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
  #queued = false;

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

  /** A page reconfiguring several attributes writes them one at a time, and every `update()`
   * rebuilds a WebGL context and refetches the font. One microtask collapses the burst. */
  attributeChangedCallback(): void {
    if (this.#queued) return;
    this.#queued = true;
    const token = this.#token;
    void Promise.resolve().then(() => {
      this.#queued = false;
      if (token !== this.#token || !this.isConnected) return;
      this.#sign?.update(this.#options());
    });
  }

  /** Runs before klieg appends anything, so every child here is the page's own. */
  #markFallback(): void {
    for (const child of [...this.children]) child.setAttribute(FALLBACK, '');
  }

  #options(): SignOptions {
    const framing = {
      ...optional('width', fraction(this.getAttribute('framing-width'))),
      ...optional('height', fraction(this.getAttribute('framing-height'))),
      ...optional('align', alignment(this.getAttribute('align'))),
    };
    const bloom = this.getAttribute('bloom');

    return {
      font: this.getAttribute('font') ?? '',
      ...optional('text', this.getAttribute('text') ?? undefined),
      // A name is a `Look`; the property carries a spec an attribute cannot hold.
      ...optional(
        'look',
        this.look ?? (this.getAttribute('look') as SignOptions['look']) ?? undefined,
      ),
      ...optional('tint', this.getAttribute('tint') ?? undefined),
      ...(Object.keys(framing).length ? { framing } : {}),
      ...optional(
        'lighting',
        (this.getAttribute('lighting') as SignOptions['lighting']) ?? undefined,
      ),
      ...optional('effects', this.effects),
      ...optional('bloom', bloom === null ? undefined : bloom !== 'false'),
      ...optional('fire', this.options),
    };
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, KliegSign);

export { KliegSign };
