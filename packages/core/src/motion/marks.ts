export type MarkEvent = { mark: 'active' } | { mark: 'exit' } | { mark: 'stage'; index: number };

export type MarkListener = (event: MarkEvent) => void;

/**
 * A throwing listener reaches the host as an unhandled rejection rather than killing the frame
 * loop — the same trade `RafClock` makes for a throwing subscriber.
 */
export function isolate(listener: MarkListener): MarkListener {
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
export class MarkReporter {
  private sentActive = false;
  private sentExit = false;

  constructor(private readonly emit: MarkListener) {}

  /** `exitAt` is `Infinity` while a hold is still open. */
  observe(elapsed: number, enterEnd: number, exitAt: number): void {
    if (!this.sentActive && elapsed >= enterEnd) {
      this.sentActive = true;
      this.emit({ mark: 'active' });
    }
    if (!this.sentExit && elapsed >= exitAt) {
      this.sentExit = true;
      this.emit({ mark: 'exit' });
    }
  }

  stage(index: number): void {
    this.emit({ mark: 'stage', index });
  }
}
