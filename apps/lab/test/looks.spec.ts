import { expect, type Page, test } from '@playwright/test';

/**
 * Appearance is the one thing the unit suite cannot reach: vitest has no GL context, so the
 * flake shader is pinned here or nowhere.
 *
 * Baselines are per-platform and these run locally, not in CI — `npm run check` is what CI
 * gates on. Regenerate after an intentional look change with `npm run test:visual -- -u`.
 */
// The stage renders at min(devicePixelRatio, 2), so a 1x baseline would show flakes at twice
// the size anyone actually sees them.
test.use({ deviceScaleFactor: 2 });

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

/** Every source of frame-to-frame variation off, so a screenshot is a function of the look. */
async function still(page: Page, search = ''): Promise<void> {
  await page.goto(`/${search}`);
  await page.fill('#text', 'JACKPOT!');
  await page.fill('#hold', '8000');
  await page.fill('#blend', '0');
  await page.selectOption('#enter', 'none');
  await page.selectOption('#active', 'none');
  await page.selectOption('#exit', 'none');
  await page.selectOption('#lighting', 'static');
}

/**
 * Hides the page and its controls so a baseline is a function of the look and nothing else.
 * Injected here rather than shipped as a lab class: with the chrome in frame, moving one slider
 * put 11 of 15 baselines over tolerance while the type itself had not moved at all.
 */
async function hideChrome(page: Page): Promise<void> {
  await page.addStyleTag({ content: 'main, .dock { display: none; }' });
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.click('#fire');
  // The first frame draws on the next rAF after the font resolves; a beat covers both.
  await page.waitForTimeout(600);
  await hideChrome(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    // Bloom is a wide, low-amplitude halo: at Playwright's default threshold of 0.2 not one pixel
    // moves far enough to be counted, so a green run proved nothing however tight the ratio was.
    threshold: 0.02,
    maxDiffPixelRatio: 0.001,
    // A bloomed look at DPR 2 renders slowly enough that the default 5s budget can expire before
    // the stability loop gets two consecutive frames.
    timeout: 20000,
  });
}

test.describe('looks', () => {
  for (const look of LOOKS) {
    test(look, async ({ page }) => {
      await still(page);
      await page.selectOption('#look', look);
      await shoot(page, `look-${look}`);
    });
  }
});

/**
 * A tube run varies in depth, which is invisible head-on: front-on, the `piping` baseline is
 * byte-identical to `leather`, so it guards the body and nothing the decoration adds. The word
 * group is yawed rather than the camera — `viewportBudget` reads `camera.position.z` as the
 * distance to the word plane, so moving the camera off axis drifts the fit instead.
 */
test.describe('off axis', () => {
  for (const look of ['tubing', 'piping'] as const) {
    test(look, async ({ page }) => {
      await still(page);
      await page.selectOption('#look', look);
      await page.locator('#yaw').fill('30');
      await shoot(page, `offaxis-${look}`);
    });
  }
});

test.describe('lighting', () => {
  test('static holds the highlight where sweep moves it', async ({ page }) => {
    await still(page);
    await page.selectOption('#look', 'chrome');
    await shoot(page, 'lighting-static');
  });
});

test.describe('flake seeding', () => {
  test('repeated letters do not sparkle in lockstep', async ({ page }) => {
    await still(page);
    await page.selectOption('#look', 'glitter');
    // Four identical letters: an identical flake field across them is the failure this catches.
    await page.fill('#text', 'MMMM');
    await shoot(page, 'flake-seeding');
  });
});

/**
 * A flicker is a function of time, so this is the one shot that cannot be taken off a live clock:
 * `?pin` holds every frame at one elapsed time, and the selection is seeded.
 */
test.describe('effects', () => {
  test('flicker takes one run of the sign down', async ({ page }) => {
    await still(page, '?pin=960');
    await page.selectOption('#look', 'tubing');
    await page.check('#flicker');
    await shoot(page, 'effect-flicker');
  });

  test('hue recolours the whole sign at once', async ({ page }) => {
    await still(page, '?pin=1500');
    await page.selectOption('#look', 'tubing');
    await page.check('#hue');
    await shoot(page, 'effect-hue');
  });

  /**
   * The pin is load-bearing twice over. It sits in the second epoch (now 3193.75ms, so 4725 is
   * 1.48 epochs in), so the shot is of a fault that has already moved once rather than of where it
   * started; and it is a moment the holder is actually dark, which most pins are not — `flicker`
   * rests about 82% of the time, so a carelessly pinned roving shot is byte-identical to plain
   * `tubing` and would pass with the effect deleted.
   *
   * Both properties are measured, not assumed: this shot differs from `look-tubing` by 258 pixels
   * and from `effect-flicker` by 445. Re-measure them after any change to the holder walk or to run
   * geometry — keying the corner draws per corner index moved these from 658 and 1558.
   *
   * 258 is under this file's own `maxDiffPixelRatio` gate of 480, so the shot no longer fails on
   * its own if the effect is deleted; walking the whole second epoch a flicker step at a time found
   * no pin in it that clears the gate. See the handoff's Traps section.
   */
  test('roving takes down a different run than flicker, one epoch on', async ({ page }) => {
    await still(page, '?pin=4725');
    await page.selectOption('#look', 'tubing');
    await page.check('#roving');
    await shoot(page, 'effect-roving');
  });
});
