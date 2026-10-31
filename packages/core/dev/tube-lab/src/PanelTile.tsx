import { HOME, LIMITS } from '@shared/orbit.js';
import { Orbit, type OrbitProps, TileGrip, useSurfaceTile } from '@weasel-js/labkit';
import { Select } from '@weasel-js/ui';
import { memo, useCallback } from 'react';
import { type PanelRecord, type Pose, RAMP_SOURCES, type RampSource } from './panels.js';

/** How a panel is being looked at: labkit's orbit camera. */
export type View = OrbitProps['view'];

export const HEAD_ON: View = { ...HOME, near: 0.1, far: 100 };

/** The turned pose's yaw, with enough pitch to show a planar loop ring as an ellipse. */
const TURNED: View = { ...HEAD_ON, yaw: (-30 * Math.PI) / 180, pitch: (13 * Math.PI) / 180 };

export function initialView(pose: Pose): View {
  return pose === 'turned' ? TURNED : HEAD_ON;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A stored view map, keeping only the views an orbit can be handed. */
export function validViews(value: unknown): Record<string, View> | null {
  if (typeof value !== 'object' || value === null) return null;
  const views: Record<string, View> = {};
  for (const [id, view] of Object.entries(value)) {
    const v = view as Partial<View> | null;
    if (v && isFiniteNumber(v.yaw) && isFiniteNumber(v.pitch) && isFiniteNumber(v.distance)) {
      views[id] = { ...HEAD_ON, ...v } as View;
    }
  }
  return views;
}

interface PanelTileProps {
  record: PanelRecord;
  view: View | undefined;
  summary: string | undefined;
  onSource: (id: string, source: RampSource) => void;
  onView: (id: string, view: View) => void;
}

const SOURCE_OPTIONS = RAMP_SOURCES.map((s) => ({ value: s, label: s }));

export const PanelTile = memo(function PanelTile({
  record,
  view,
  summary,
  onSource,
  onView,
}: PanelTileProps) {
  const { id, letter, mode, pose, source } = record;
  // The body under the bar, so the canvas is scissored to the box the orbit measures its gestures on.
  const tile = useSurfaceTile(id);
  const home = useCallback(() => initialView(pose), [pose]);
  const setView = useCallback((next: View) => onView(id, next), [onView, id]);
  return (
    <div className="panel">
      <TileGrip className="panel__bar">
        <span className="panel__letter">{letter}</span>
        <span className="panel__mode">{mode}</span>
        {mode === 'ramp' ? (
          <Select<RampSource>
            aria-label={`${letter} ramp source`}
            variant="bare"
            width="fit"
            selectedKey={source}
            onSelectionChange={(next) => onSource(id, next)}
            options={SOURCE_OPTIONS}
          />
        ) : null}
      </TileGrip>
      <div className="panel__body" ref={tile}>
        <Orbit view={view ?? home()} onViewChange={setView} home={home} limits={LIMITS}>
          <button
            type="button"
            className="panel__reset"
            aria-label={`reset the ${letter} ${pose} ${mode} view`}
            onClick={() => setView(home())}
          >
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 8a6 6 0 1 1-1.8-4.3" />
              <path d="M12.2 3.7 8.9 3.1M12.2 3.7 11.5 6.6" />
            </svg>
          </button>
          {summary ? <p className="panel__readout">{summary}</p> : null}
        </Orbit>
      </div>
    </div>
  );
});
