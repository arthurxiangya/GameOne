import type { Logger, SystemTime } from '../../application/ports';

export interface LoopStats {
  readonly ticks: number;
  readonly avgStepMs: number;
  readonly maxStepMs: number;
  /** Times the loop fell so far behind that it dropped time instead of catching up. */
  readonly lagResets: number;
  readonly errors: number;
}

/** At most this many catch-up steps per wake-up; beyond that, time is dropped. */
const MAX_CATCH_UP = 5;

/**
 * Runs `step` at a fixed rate with an accumulator, so the simulation advances in equal
 * increments however the OS timer jitters. A step that throws is logged and skipped;
 * one bad tick never takes the server down.
 */
export class FixedStepLoop {
  private readonly dt: number;
  private timer: NodeJS.Timeout | null = null;
  private last = 0;
  private accumulator = 0;
  private ticks = 0;
  private totalMs = 0;
  private maxMs = 0;
  private lagResets = 0;
  private errors = 0;

  constructor(
    hz: number,
    private readonly step: (dt: number) => void,
    private readonly time: SystemTime,
    private readonly logger: Logger,
  ) {
    this.dt = 1 / hz;
  }

  start(): void {
    if (this.timer) return;
    this.last = this.time.monotonic();
    this.schedule(0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  stats(): LoopStats {
    return {
      ticks: this.ticks,
      avgStepMs: this.ticks ? Math.round((this.totalMs / this.ticks) * 100) / 100 : 0,
      maxStepMs: Math.round(this.maxMs * 100) / 100,
      lagResets: this.lagResets,
      errors: this.errors,
    };
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => this.wake(), delayMs);
  }

  private wake(): void {
    const now = this.time.monotonic();
    this.accumulator += now - this.last;
    this.last = now;
    let steps = 0;
    while (this.accumulator >= this.dt && steps < MAX_CATCH_UP) {
      this.runStep();
      this.accumulator -= this.dt;
      steps++;
    }
    if (this.accumulator >= this.dt) {
      this.lagResets++;
      this.logger.warn('simulation fell behind; dropping time', { droppedSeconds: Math.round(this.accumulator * 1000) / 1000 });
      this.accumulator = 0;
    }
    if (this.timer) this.schedule(Math.max(0, (this.dt - this.accumulator) * 1000));
  }

  private runStep(): void {
    const start = this.time.monotonic();
    try {
      this.step(this.dt);
    } catch (err) {
      this.errors++;
      this.logger.error('simulation step failed', { error: err instanceof Error ? err.stack ?? err.message : String(err) });
    }
    const ms = (this.time.monotonic() - start) * 1000;
    this.ticks++;
    this.totalMs += ms;
    this.maxMs = Math.max(this.maxMs, ms);
  }
}
