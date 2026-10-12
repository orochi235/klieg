import { expect, type Page } from '@playwright/test';

/** Alpha census of one frame of the overlay's drawing buffer. */
export interface Frame {
  lit: number;
  clear: number;
  total: number;
}

export interface Reading {
  frames: number;
  drawn: number;
  best: Frame;
}

/**
 * Reports the busiest of `frames` consecutive frames of the overlay's own drawing buffer.
 *
 * `readPixels` after the effect settles returns zeros — the buffer is not `preserveDrawingBuffer`,
 * so it is cleared once the page composites. Reading from `requestAnimationFrame`, which runs
 * after the library's own rAF-driven draw, is the only way to see what the overlay put on screen.
 */
export function readOverlay(page: Page, frames: number): Promise<Reading> {
  return page.evaluate(
    (count) =>
      new Promise<Reading>((resolve, reject) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return reject(new Error('the overlay never created a canvas'));
        const gl = canvas.getContext('webgl2');
        if (!gl) return reject(new Error('the overlay canvas has no webgl2 context'));

        const { width, height } = canvas;
        const px = new Uint8Array(width * height * 4);
        const total = width * height;
        let sampled = 0;
        let drawn = 0;
        let best: Frame = { lit: 0, clear: total, total };

        const step = () => {
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
          let lit = 0;
          for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) lit++;

          sampled++;
          if (lit > 0) drawn++;
          if (lit > best.lit) best = { lit, clear: total - lit, total };

          if (sampled < count) requestAnimationFrame(step);
          else resolve({ frames: sampled, drawn, best });
        };
        requestAnimationFrame(step);
      }),
    frames,
  );
}

// The first fire in a fresh page pays vite's cold transform, the font fetch and parse, and the
// first shader compile before a canvas exists: measured 2.5-5.8s here, against the 5s an expect
// gets by default. Every canvas wait below carries this, so a busy machine decides nothing.
export const CANVAS_TIMEOUT_MS = 15000;

/**
 * Resolves once the overlay's canvas is on the page and a frame of it holds a lit pixel: the
 * condition a spec means when it waits for an effect to be up.
 */
export async function drawn(page: Page): Promise<void> {
  await expect(page.locator('canvas')).toBeAttached({ timeout: CANVAS_TIMEOUT_MS });
  await expect
    .poll(async () => (await readOverlay(page, 2)).drawn, {
      timeout: CANVAS_TIMEOUT_MS,
      message: 'the overlay never drew a lit pixel',
    })
    .toBeGreaterThan(0);
}
