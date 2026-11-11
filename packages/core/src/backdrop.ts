import type { BackdropSpec } from './api.js';
import type { WordCaches } from './render/caches.js';
import type { Look } from './render/looks.js';
import { cameraZOf, type Stage as SceneStage } from './render/stage.js';
import { Word } from './render/word.js';
import { withEffects } from './resolve.js';
import type { LoadedFont } from './text/font.js';
import { DEFAULT_GLYPH_OPTIONS } from './text/glyphs.js';
import type { Budget } from './text/layout.js';
import { sizeOf, type TextRun } from './text/runs.js';

/**
 * The most rows a backdrop lays out. A guard on the allocation, not a frame budget: what a frame
 * costs is the size of the part pool, and the look decides that far more than the row count does.
 * Measured with `spikes/backdrop-frame-cost.mjs` on a 15-letter sign — `gold` runs 16 rows in
 * 0.4ms a frame, where `tubing` costs about 2.2ms a row and passes 16.7ms at 7 of them. Past this
 * a caller is asking for wallpaper, and should say so with `text` rather than with `rows`.
 */
export const MAX_BACKDROP_ROWS = 12;

/** The sign on `rows` lines. A run list repeats as a list, so each run's styling repeats with it. */
function onRows(text: string | TextRun[], rows: number): string | TextRun[] {
  const asked = Math.max(1, Math.floor(rows));
  const n = Math.min(asked, MAX_BACKDROP_ROWS);
  if (n !== asked) {
    console.warn(
      `klieg: a backdrop lays out at most ${MAX_BACKDROP_ROWS} rows — asked for ${asked}`,
    );
  }
  if (n === 1) return text;
  if (typeof text === 'string') return Array.from({ length: n }, () => text).join('\n');
  return Array.from({ length: n }, (_, i) => (i === 0 ? text : [{ text: '\n' }, ...text])).flat();
}

/**
 * The second word, built against the hero's own fit. Its scale is a multiple of the hero's rather
 * than of its own budget fit, or seven rows would shrink to fit the frame instead of overfilling
 * it; `behind` is its own extrusion plus a hero's thickness of clearance, which the depth buffer
 * then resolves.
 */
export function rowsBehind(
  stage: SceneStage,
  caches: WordCaches,
  spec: BackdropSpec,
  rowText: string | TextRun[],
  hero: Word,
  loaded: LoadedFont,
  budget: Budget,
  heroLook: Look,
): Word {
  const text = onRows(rowText, spec.rows ?? 1);
  const look = withEffects(spec.look ?? heroLook, spec.effects);
  const word = new Word(
    text,
    loaded,
    look,
    budget,
    false,
    undefined,
    undefined,
    stage.environment?.texture ?? null,
    caches,
    sizeOf(text),
    undefined,
    { ...sizedOff(hero, spec), dim: spec.dim ?? 1, cameraZ: cameraZOf(stage) },
  );
  if (spec.transform) word.transform = spec.transform;
  return word;
}

/** Fits the backdrop to a new box, by refitting it off the hero, which has to be refit first. */
export function refitBehind(backdrop: Word, hero: Word, spec: BackdropSpec, budget: Budget): void {
  backdrop.refit(budget, sizedOff(hero, spec));
}

function sizedOff(hero: Word, spec: BackdropSpec): { fitScale: number; behind: number } {
  const depth = DEFAULT_GLYPH_OPTIONS.depth;
  const heroScale = hero.baseScale;
  const scale = heroScale * (spec.scale ?? 1);
  return { fitScale: scale, behind: depth * scale + depth * heroScale };
}
