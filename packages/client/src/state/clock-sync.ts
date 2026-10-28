const JITTER_WINDOW = 60;
const MIN_DELAY = 0.05;
const MAX_DELAY = 0.3;
const SAFETY_MARGIN = 0.01;
/** How fast the render delay may move toward its target, in seconds per second. */
const DELAY_SLEW = 0.25;

/**
 * Estimates the server's simulation clock from snapshot timestamps, and how far in the past
 * remote entities must be drawn so a newer snapshot has (almost) always arrived already.
 *
 * The render delay is the snapshot spacing plus the 95th-percentile lateness of recent
 * snapshots: about 60 ms on a steady connection at 20 snapshots a second, more on a jittery one.
 */
export class ClockSync {
  private offset: number | null = null;
  private lastServerTime: number | null = null;
  private spacing = 0.1;
  private readonly lateness: number[] = [];
  private delay = 0.1;

  /** `serverTime` from a snapshot, `localTime` when it arrived (both seconds). */
  observe(serverTime: number, localTime: number): void {
    const sample = localTime - serverTime;
    if (this.offset === null || Math.abs(sample - this.offset) > 0.5) {
      this.offset = sample;
      this.lateness.length = 0;
    } else {
      // Late packets only ever make the sample larger, so lean toward the smallest delay seen.
      this.offset += (sample - this.offset) * (sample < this.offset ? 0.3 : 0.02);
    }
    this.lateness.push(Math.max(0, sample - this.offset));
    if (this.lateness.length > JITTER_WINDOW) this.lateness.shift();
    if (this.lastServerTime !== null) {
      const gap = serverTime - this.lastServerTime;
      if (gap > 0 && gap < 1) this.spacing += (gap - this.spacing) * 0.1;
    }
    this.lastServerTime = serverTime;
  }

  serverNow(localTime: number): number {
    return this.offset === null ? 0 : localTime - this.offset;
  }

  /** Where the delay is heading given recent snapshot spacing and lateness. */
  get targetDelay(): number {
    const sorted = [...this.lateness].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]! : 0.05;
    return Math.min(MAX_DELAY, Math.max(MIN_DELAY, this.spacing + p95 + SAFETY_MARGIN));
  }

  /** Current render delay, eased toward the target so remote entities never jump in time. */
  renderDelay(dt: number): number {
    const target = this.targetDelay;
    const step = DELAY_SLEW * dt;
    this.delay += Math.max(-step, Math.min(step, target - this.delay));
    return this.delay;
  }

  reset(): void {
    this.offset = null;
    this.lastServerTime = null;
    this.lateness.length = 0;
    this.spacing = 0.1;
    this.delay = 0.1;
  }
}
