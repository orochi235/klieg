// The lab font, read from apps/lab rather than copied: one binary, and a move over there breaks
// this import loudly instead of leaving two fonts to drift.

import { type LoadedFont, loadFont } from '@core/text/font.js';
import fontUrl from '../../../../../apps/lab/public/font.ttf?url';

let pending: Promise<LoadedFont> | null = null;

export function labFont(): Promise<LoadedFont> {
  pending ??= loadFont(fontUrl);
  return pending;
}
