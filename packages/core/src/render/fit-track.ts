import type { Budget } from '../text/layout.js';
import { type Fit, fitOf, type GlyphBounds, type Placement } from '../text/placement.js';

/** A laid-out block, with the bounds of the glyphs it places, that a fit is measured on. */
export interface FitSource {
  placed: Placement;
  bounds: GlyphBounds;
}

/**
 * A word's viewport fit: the layout it was built with, the two a regroup moves it between, and
 * how far along that move it stands. Every fit is measured against the budget rather than stored,
 * so `refit` moves them all to a new box and a move in progress carries on from the same point.
 */
export class FitTrack {
  private from: FitSource;
  private to: FitSource;
  private u = 1;
  private fromFit: Fit;
  private toFit: Fit;
  private now: Fit;

  constructor(
    private readonly origin: FitSource,
    private budget: Budget,
    /** The scale to hold in place of the budget's, for a word sized off another one. */
    private force: number | undefined,
  ) {
    this.from = origin;
    this.to = origin;
    this.now = this.measure(origin);
    this.fromFit = this.now;
    this.toFit = this.now;
  }

  /** The fit the word stands at. */
  get fit(): Fit {
    return this.now;
  }

  /** The fit the move in progress lands on, or the current one where nothing is moving. */
  get target(): Fit {
    return this.toFit;
  }

  get lineEdge(): Budget['lineEdge'] {
    return this.budget.lineEdge;
  }

  /** The scale the layout the word was built with fits at, in the box as it stands now. */
  get baseScale(): number {
    return this.force ?? this.measure(this.origin).scale;
  }

  /** A regroup: the fit sets off from where it stands toward the new block's. */
  retarget(source: FitSource): void {
    this.from = this.to;
    this.fromFit = this.now;
    this.to = source;
    this.toFit = this.measure(source);
    this.u = 0;
  }

  /** `u` in 0..1 along the move from the last regroup's fit to the new one. */
  progress(u: number): Fit {
    this.u = Math.max(0, Math.min(1, u));
    this.now = this.at(this.u);
    return this.now;
  }

  /** The same layouts measured against a new box, at the same point of any move. */
  refit(budget: Budget, force = this.force): Fit {
    this.budget = budget;
    this.force = force;
    this.fromFit = this.measure(this.from);
    this.toFit = this.measure(this.to);
    this.now = this.at(this.u);
    return this.now;
  }

  private measure(source: FitSource): Fit {
    return fitOf(source.placed, source.bounds, this.budget, this.force);
  }

  private at(w: number): Fit {
    const a = this.fromFit;
    const b = this.toFit;
    // Lerping to w = 1 lands a ULP short of the target, leaving the settled fit uncomparable.
    if (w === 1) return { ...b };
    return {
      scale: a.scale + (b.scale - a.scale) * w,
      midY: a.midY + (b.midY - a.midY) * w,
      midX: a.midX + (b.midX - a.midX) * w,
      offsetX: a.offsetX + (b.offsetX - a.offsetX) * w,
    };
  }
}
