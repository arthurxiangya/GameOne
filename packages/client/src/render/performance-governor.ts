export interface QualityStep {
  readonly name: string;
  readonly apply: () => void;
}

/**
 * Watches the real frame rate and, when it stays below `minFps`, lowers rendering quality one
 * step at a time (never back up, so it can't oscillate). A slow device then trades sharpness
 * and shadows for smooth movement.
 */
export class PerformanceGovernor {
  private frames = 0;
  private elapsed = 0;
  private applied = 0;
  private warmup: number;
  fps = 0;

  constructor(
    private readonly steps: readonly QualityStep[],
    private readonly minFps = 30,
    private readonly windowSeconds = 3,
    warmupSeconds = 3,
  ) {
    this.warmup = warmupSeconds;
  }

  get level(): number {
    return this.applied;
  }

  /** Feed the real time since the last frame. Returns the step taken, if any. */
  sample(seconds: number): QualityStep | null {
    if (this.warmup > 0) {
      this.warmup -= seconds;
      return null;
    }
    this.frames++;
    this.elapsed += seconds;
    if (this.elapsed < this.windowSeconds) return null;
    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (this.fps >= this.minFps || this.applied >= this.steps.length) return null;
    const step = this.steps[this.applied++]!;
    step.apply();
    return step;
  }
}

/** Frames per second over roughly the last second, for display. */
export class FpsMeter {
  private frames = 0;
  private elapsed = 0;
  fps = 0;

  sample(seconds: number): boolean {
    this.frames++;
    this.elapsed += seconds;
    if (this.elapsed < 1) return false;
    this.fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    return true;
  }
}
