import type { LabContextValue, TrialRecord } from '@weasel-js/labkit';
import {
  isPanelMode,
  isPose,
  isRampSource,
  type PanelMeta,
  type PanelRecord,
  reconcileLetters,
  seedPanels,
} from './panels.js';

/** What a trial's own config holds: everything of a panel but its pose, which is its instrument. */
export interface PanelConfig {
  letter: string;
  mode: PanelMeta['mode'];
  source: PanelMeta['source'];
}

export function panelOf(trial: TrialRecord): PanelRecord | null {
  const config = trial.config as Partial<PanelConfig> | undefined;
  if (!config || typeof config.letter !== 'string' || !isPose(trial.instrumentName)) return null;
  return {
    id: trial.id,
    letter: config.letter,
    mode: isPanelMode(config.mode) ? config.mode : 'beauty',
    pose: trial.instrumentName,
    source: isRampSource(config.source) ? config.source : 'depth',
  };
}

/** Opens a trial per panel, seeded so that its Reset returns to that panel rather than the defaults. */
export function openPanels(lab: LabContextValue, panels: readonly PanelMeta[]): void {
  for (const { letter, mode, pose, source } of panels) {
    lab.addTrial(pose, { config: { letter, mode, source } });
  }
}

/** Opens and closes trials so the panels cover exactly `letters`, leaving a letter already shown alone. */
export function reconcileTrials(lab: LabContextValue, letters: string): void {
  const panels = lab.trials.flatMap((t) => panelOf(t) ?? []);
  const { add, remove } = reconcileLetters(panels, letters);
  openPanels(lab, add);
  for (const id of remove) lab.closeTrial(id);
}

/** Replaces every trial with `panels`, or with the seeded set for `letters`. */
export function reseedTrials(
  lab: LabContextValue,
  letters: string,
  panels: readonly PanelMeta[] = seedPanels(letters),
): void {
  const old = lab.trials.map((t) => t.id);
  openPanels(lab, panels);
  for (const id of old) lab.closeTrial(id);
}
