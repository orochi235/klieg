import type { Align } from './index.js';
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

/** A framing fraction, or nothing where the page wrote none — an empty attribute among them,
 * since `Number('')` is a perfectly finite `0` that would frame the sign at no width. */
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
  /** Bumped on every connect and disconnect, so a late import or a deferred update that lands on
   * a stale element stops there. */
  #token = 0;
  #queued = false;
  /** The keys of the last settings sent, to tell a dropped one from one never written. */
  #sent: string[] = [];
  #warnedNoFont = false;

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
        const settings = this.#settings();
        if (!settings) return;
        this.#sign = sign(this, {
          ...settings,
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
    this.#sent = [];
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
      const patch = this.#settings();
      if (patch) this.#sign?.update(patch);
    });
  }

  /** Runs before klieg appends anything, so every node here is the page's own. A bare text child
   * is wrapped, since only an element can carry the attribute the stylesheet matches. */
  #markFallback(): void {
    for (const node of [...this.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        (node as Element).setAttribute(FALLBACK, '');
      } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const span = this.ownerDocument.createElement('span');
        span.setAttribute(FALLBACK, '');
        node.replaceWith(span);
        span.appendChild(node);
      }
    }
  }

  /** Everything the sign is told: the element's whole state, plus a tombstone for each setting the
   * last call sent and this one omits, since `Sign.update()` merges rather than replaces. */
  #settings(): SignOptions | null {
    const options = this.#options();
    if (!options) return null;
    const gone = this.#sent.filter((key) => !(key in options));
    this.#sent = Object.keys(options);
    return Object.assign(Object.fromEntries(gone.map((key) => [key, undefined])), options);
  }

  #options(): SignOptions | null {
    const font = this.getAttribute('font');
    // Without it `fetch('')` returns the page itself and opentype throws on the HTML, naming no URL.
    if (font === null) {
      if (!this.#warnedNoFont) {
        this.#warnedNoFont = true;
        console.warn(`klieg: <${TAG}> needs a font attribute, and lights nothing without one`);
      }
      return null;
    }
    const framing = {
      ...optional('width', fraction(this.getAttribute('framing-width'))),
      ...optional('height', fraction(this.getAttribute('framing-height'))),
      ...optional('align', alignment(this.getAttribute('align'))),
    };
    // A name is a `Look`; the property carries a spec an attribute cannot hold.
    const look = this.look ?? (this.getAttribute('look') as SignOptions['look']) ?? undefined;
    // Unvalidated where `align` is not: an unknown lighting throws and warns, where an unknown
    // align would silently right-align.
    const lighting = (this.getAttribute('lighting') as SignOptions['lighting']) ?? undefined;
    const bloom = this.getAttribute('bloom');

    return {
      font,
      ...optional('text', this.getAttribute('text') ?? undefined),
      ...optional('look', look),
      ...optional('tint', this.getAttribute('tint') ?? undefined),
      ...(Object.keys(framing).length ? { framing } : {}),
      ...optional('lighting', lighting),
      ...optional('effects', this.effects),
      ...optional('bloom', bloom === null ? undefined : bloom !== 'false'),
      ...optional('fire', this.options),
    };
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, KliegSign);

export { KliegSign };
