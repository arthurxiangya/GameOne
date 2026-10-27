/** Classic token bucket: allows short bursts up to `capacity`, then `refillPerSecond` on average. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  tryTake(now: number, cost = 1): boolean {
    const elapsed = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
