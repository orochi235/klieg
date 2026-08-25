import type { LetterBox } from './projection.js';

/** How the word appears in the DOM. Exactly one of these is ever present at a time. */
export type SelectableMode = 'hidden' | 'layer' | 'none';

// Clipped rather than `visibility:hidden` or `display:none`, both of which take the text out of
// find-in-page, selection and the accessibility tree — which is the whole point of this node.
const HIDDEN_CSS =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;' +
  'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:pre;border:0';

// `line-height:1` is load-bearing: `measureBaselineRatio` measures the baseline gap at that value,
// and any other one puts every letter off vertically.
const SPAN_CSS =
  'position:absolute;color:transparent;white-space:pre;line-height:1;' +
  'transform-origin:0 0;pointer-events:auto;user-select:text';

/** What a built layer was built against. Any change to it makes the layer stale. */
export interface LayerKey {
  version: number;
  width: number;
  height: number;
  scale: number;
  midY: number;
}

const sameKey = (a: LayerKey | null, b: LayerKey): boolean =>
  a !== null &&
  a.version === b.version &&
  a.width === b.width &&
  a.height === b.height &&
  a.scale === b.scale &&
  a.midY === b.midY;

/**
 * The word's DOM representation, inside the container `Stage` owns. `'hidden'` is one clipped node;
 * `'layer'` is one transparent span per letter, positioned over the glyph it names.
 */
export class TextLayer {
  private built: LayerKey | null = null;

  constructor(private readonly container: HTMLElement) {
    // The letter spans are all absolutely positioned, so nothing in flow holds the '\n' between
    // lines open: at the inherited `normal` it collapses and a two-line word copies as one.
    container.style.whiteSpace = 'pre';
  }

  /** The tier-1 node: the whole fired string, once, never rebuilt. */
  setHidden(text: string): void {
    this.clear();
    const node = document.createElement('span');
    node.style.cssText = HIDDEN_CSS;
    node.textContent = text;
    this.container.appendChild(node);
  }

  /** True when the layer is missing or built against a layout, fit or canvas box that has moved. */
  isStale(key: LayerKey): boolean {
    return !sameKey(this.built, key);
  }

  setLayer(boxes: readonly LetterBox[], fontSize: number, family: string, key: LayerKey): void {
    this.clear();
    let line: number | null = null;
    for (const box of boxes) {
      // Reading order in the DOM is what a selection copies, so a line break has to be a node.
      if (line !== null && box.line !== line)
        this.container.appendChild(document.createTextNode('\n'));
      line = box.line;

      const span = document.createElement('span');
      span.style.cssText = SPAN_CSS;
      span.style.left = `${box.left}px`;
      span.style.top = `${box.top}px`;
      span.style.fontSize = `${fontSize}px`;
      span.style.fontFamily = family;
      // Whitespace is carried so a copy keeps it, but it is not ink and must not take a click.
      if (box.char.trim() === '') span.style.pointerEvents = 'none';
      span.textContent = box.char;
      this.container.appendChild(span);
    }
    this.built = key;
  }

  /** Hides the layer without dropping it: through a tween the letters are simply not where it is. */
  setVisible(on: boolean): void {
    this.container.style.visibility = on ? '' : 'hidden';
  }

  clear(): void {
    this.container.replaceChildren();
    this.container.style.visibility = '';
    this.built = null;
  }
}
