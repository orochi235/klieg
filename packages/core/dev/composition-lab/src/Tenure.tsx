import type { PartInfo } from '@core/effects/types.js';
import { useMemo } from 'react';
import type { PassSamples } from './sample.js';
import { tenureAndJump } from './tenure.js';

export interface TenureProps {
  samples: PassSamples;
  parts: readonly PartInfo[];
  /** The pass the samples span, in milliseconds. */
  pass: number;
}

export function Tenure({ samples, parts, pass }: TenureProps) {
  const r = useMemo(() => tenureAndJump(samples, parts, pass), [samples, parts, pass]);

  return (
    <div className="cl-panel">
      <h2>tenure &amp; jump</h2>
      <div className="cl-row">
        <span>tenure</span>
        <output>{(r.meanTenureMs / 1000).toFixed(2)}s</output>
      </div>
      <div className="cl-row">
        <span>handovers</span>
        <output>{r.handovers}</output>
      </div>
      <div className="cl-row">
        <span>jump</span>
        <output>{r.meanJumpParts.toFixed(1)}</output>
      </div>
      <div className="cl-row">
        <span>jump em</span>
        <output>{r.meanJumpEm.toFixed(2)}</output>
      </div>
      {r.handovers === 0 && r.tenures.length > 0 ? (
        <p className="cl-note">
          no handovers: every holder keeps the effect for the whole pass, which is what a layer
          without a roving wrapper does
        </p>
      ) : null}
    </div>
  );
}
