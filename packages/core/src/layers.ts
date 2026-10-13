import type { SceneLayer } from './api.js';
import type { Clock } from './clock.js';
import type { Stage as SceneStage } from './render/stage.js';

/** The scene layers attached to one instance, stepped once a frame and drawn between fires. */
export class SceneLayers {
  private readonly layers = new Set<SceneLayer>();
  private stop: (() => void) | null = null;
  private steppedAt: number | null = null;
  private wereLive = false;
  private drawnAt: number | null = null;

  constructor(
    private readonly stage: SceneStage,
    private readonly clock: Clock,
    /** Whether no fire is drawing the scene, leaving the layers to draw themselves. */
    private readonly idle: () => boolean,
    private readonly destroyed: () => boolean,
  ) {}

  live(): boolean {
    for (const layer of this.layers) if (layer.live) return true;
    return false;
  }

  /** Once a frame, from whichever of the layer loop and a fire's tick reaches it first, and always
   * before that frame is drawn. */
  step(now: number): void {
    if (this.layers.size === 0 || this.steppedAt === now) return;
    const dt = this.steppedAt === null ? 0 : Math.max(0, now - this.steppedAt) / 1000;
    this.steppedAt = now;
    for (const layer of [...this.layers]) {
      try {
        layer.update(dt);
      } catch (err) {
        this.detach(layer);
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  }

  /** Records that a fire drew the scene, layers included, at `now`. */
  drew(now: number): void {
    this.drawnAt = now;
  }

  attach(layer: SceneLayer): () => void {
    if (!this.layers.has(layer)) {
      // First: three.quarks disposes a particle system that has no Scene above it when it updates.
      this.stage.scene.add(layer.object);
      this.layers.add(layer);
      if (!this.stop) {
        this.steppedAt = null;
        this.stop = this.clock.subscribe(this.tick);
      }
    }
    return () => this.detach(layer);
  }

  detach(layer: SceneLayer): void {
    if (!this.layers.delete(layer)) return;
    this.stage.scene.remove(layer.object);
    if (this.layers.size === 0) {
      this.stop?.();
      this.stop = null;
      this.wereLive = false;
    }
    // Whatever it drew last stays on the canvas until something draws over it.
    if (!this.destroyed() && this.idle() && this.stage.renderer) {
      this.draw(this.clock.now());
      if (!this.live()) this.stage.scheduleIdleTeardown();
    }
  }

  detachAll(): void {
    for (const layer of [...this.layers]) this.detach(layer);
  }

  private draw(now: number): void {
    this.stage.draw();
    this.drawnAt = now;
  }

  /** A running fire draws the layers with everything else; between fires this is all that does. */
  private readonly tick = (now: number): void => {
    this.step(now);
    const live = this.live();
    if ((live || this.wereLive) && this.idle()) {
      if (this.drawnAt !== now) this.draw(now);
      if (!live) this.stage.scheduleIdleTeardown();
    }
    this.wereLive = live;
  };
}
