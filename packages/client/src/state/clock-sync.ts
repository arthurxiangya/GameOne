/**
 * Estimates the server's simulation clock from snapshot timestamps, so remote entities
 * can be rendered at a consistent point in server time regardless of network jitter.
 */
export class ClockSync {
  private offset: number | null = null;

  /** `serverTime` from a snapshot, `localTime` when it arrived (both seconds). */
  observe(serverTime: number, localTime: number): void {
    const sample = localTime - serverTime;
    if (this.offset === null || Math.abs(sample - this.offset) > 0.5) {
      this.offset = sample;
      return;
    }
    // Late packets only ever make the sample larger, so lean toward the smallest delay seen.
    this.offset += (sample - this.offset) * (sample < this.offset ? 0.3 : 0.02);
  }

  serverNow(localTime: number): number {
    return this.offset === null ? 0 : localTime - this.offset;
  }

  reset(): void {
    this.offset = null;
  }
}
