export type PhaseEvent =
  | { phase: 'active' }
  | { phase: 'exit' }
  | { phase: 'stage'; index: number };

export type PhaseListener = (event: PhaseEvent) => void;

/**
 * A throwing listener reaches the host as an unhandled rejection rather than killing the frame
 * loop — the same trade `RafClock` makes for a throwing subscriber.
 */
export function isolate(listener: PhaseListener): PhaseListener {
  return (event) => {
    try {
      listener(event);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  };
}

/**
 * Detects the two timed boundaries against each frame's elapsed time. They cannot be scheduled
 * when the effect is fired: `Timeline.release()` rebuilds the timeline and moves `activeEnd`, so a
 * click hold has no exit instant at all until the press lands.
 */
export class PhaseReporter {
  private sentActive = false;
  private sentExit = false;

  constructor(private readonly emit: PhaseListener) {}

  /** `exitAt` is `Infinity` while a hold is still open. */
  observe(elapsed: number, enterEnd: number, exitAt: number): void {
    if (!this.sentActive && elapsed >= enterEnd) {
      this.sentActive = true;
      this.emit({ phase: 'active' });
    }
    if (!this.sentExit && elapsed >= exitAt) {
      this.sentExit = true;
      this.emit({ phase: 'exit' });
    }
  }

  stage(index: number): void {
    this.emit({ phase: 'stage', index });
  }
}
