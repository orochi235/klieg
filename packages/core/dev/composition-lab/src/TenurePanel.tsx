import type { PartInfo } from '@core/effects/types.js';
import { DetailList, DetailRow } from '@weasel-js/ui/components/DetailList';
import { useMemo } from 'react';
import { type PassSamples, PER_PATCH_PASS } from './sample.js';
import { tenureAndJump } from './tenure.js';

export interface TenureProps {
  samples: PassSamples;
  parts: readonly PartInfo[];
  /** The pass the samples span, in milliseconds. */
  pass: number;
  /** The slot `roving` settled on, when exactly one enabled layer rovs. */
  epochMs: number | null;
  /** Samples the grid spends on one pass of the finest patch. */
  perPatchPass: number;
}

/** Past this the deferral is the reading rather than rounding in it. */
const DEFERRED = 1.05;

export function Tenure({ samples, parts, pass, epochMs, perPatchPass }: TenureProps) {
  const r = useMemo(() => tenureAndJump(samples, parts, pass), [samples, parts, pass]);

  const held = r.handovers > 0 ? r.meanTenureMs : 0;
  const deferred = epochMs !== null && held > epochMs * DEFERRED;
  const coarse = perPatchPass < PER_PATCH_PASS;
  const idle = r.handovers === 0 && r.meanTenureMs > 0;

  return (
    <div className="cl-section">
      <DetailList values="figures">
        <DetailRow label="tenure" grade={deferred || coarse ? 'warn' : undefined}>
          {`${(r.meanTenureMs / 1000).toFixed(2)}s`}
        </DetailRow>
        <DetailRow label="epoch">
          {epochMs === null ? null : `${(epochMs / 1000).toFixed(2)}s`}
        </DetailRow>
        <DetailRow label="handovers" grade={idle ? 'warn' : undefined}>
          {r.handovers}
        </DetailRow>
        <DetailRow label="jump">{r.meanJumpParts.toFixed(1)}</DetailRow>
        <DetailRow label="jump em">{r.meanJumpEm.toFixed(2)}</DetailRow>
      </DetailList>
      {deferred && epochMs !== null ? (
        <p className="cl-note">
          {(held / epochMs).toFixed(1)}× the epoch: roving hands over only where the inner reads as
          rest, so a part that is still moving at its boundary keeps the fault into the next epoch.
          An inner that never rests never lets go.
        </p>
      ) : null}
      {idle ? (
        <p className="cl-note">
          no handovers: every holder keeps the effect for the whole pass, which is what a layer
          without a roving wrapper does
        </p>
      ) : null}
      {coarse ? (
        <p className="cl-note">
          {perPatchPass.toFixed(0)} samples per inner pass, under the {PER_PATCH_PASS} the rate asks
          for — the sample cap bound. Below about 20, a drop falls between two samples and the
          handovers either side of it merge, which reads as a longer tenure than the truth.
        </p>
      ) : null}
    </div>
  );
}
