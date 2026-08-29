/**
 * One high-resolution PNG off the lab's own renderer.
 *
 * `Stage` sizes itself from the window, so a shot larger than the viewport resizes the drawing
 * buffer only (`setSize(w, h, false)` leaves the CSS box alone), renders, reads, and puts the
 * stage back. `BloomPath` allocates its targets from the drawing buffer, so it follows.
 */

/** Aspects a desktop actually wants; the first is the default. */
export const SIZES = [
  { label: '3840×2160', width: 3840, height: 2160 },
  { label: '5120×2880', width: 5120, height: 2880 },
  { label: '3440×1440', width: 3440, height: 1440 },
  { label: '2560×1600', width: 2560, height: 1600 },
];

export const BACKGROUNDS = ['page dark', 'transparent'];

/**
 * The renderer clears to alpha 0 — the dark behind the tubing is the page's CSS, not the canvas.
 * So `transparent` is the raw canvas and `page dark` is that canvas composited onto the page
 * colour; both come off one render.
 */
function toBlob(canvas, background, pageColor) {
  if (background === 'transparent') return new Promise((r) => canvas.toBlob(r, 'image/png'));
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d');
  ctx.fillStyle = pageColor;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return new Promise((r) => flat.toBlob(r, 'image/png'));
}

export function createWallpaper({ stage, bloom, refit, pageColor = '#0b0d12' }) {
  return async function save(width, height, background) {
    const renderer = stage.renderer ?? stage.mount();
    const canvas = renderer.domElement;
    const ratio = renderer.getPixelRatio();

    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    stage.camera.aspect = width / height;
    stage.applyLens(width / height);
    refit();

    let blob;
    try {
      bloom.render(stage.scene, stage.camera);
      blob = await toBlob(canvas, background, pageColor);
    } finally {
      renderer.setPixelRatio(ratio);
      stage.resize();
      refit();
    }
    if (!blob) throw new Error('the canvas produced no PNG');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `klieg-${width}x${height}.png`;
    a.click();
    // Revoked on the next turn of the loop: revoking synchronously races the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return blob.size;
  };
}
