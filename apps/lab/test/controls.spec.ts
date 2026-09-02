import { expect, test } from '@playwright/test';

/**
 * The lab is the instrument every look is judged with, so a control that cannot express what a
 * look asks for is a measurement fault, not a cosmetic one: `count` sat at `max="512"` while
 * `sequin` asked for 520, and every baseline taken through it was of a field nobody ships.
 *
 * A range clamps in silence, which is why this reads the warning `setRange` emits rather than the
 * slider values — one place to add a control and have it covered.
 */
const LOOKS = [
  'gold',
  'chrome',
  'oil',
  'gem',
  'velvet',
  'neon',
  'flake',
  'glitter',
  'leather',
  'tubing',
  'piping',
  'sequin',
] as const;

test('every shipped look fits the controls that show it', async ({ page }) => {
  const clamped: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('clamped')) clamped.push(m.text());
  });

  await page.goto('/');
  for (const look of LOOKS) {
    await page.selectOption('#look', look);
    // The sliders are seeded on the change; a frame is enough for the handler to have run.
    await page.waitForTimeout(50);
  }

  expect(clamped).toEqual([]);
});
