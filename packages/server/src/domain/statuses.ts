import type { StatusDef } from '@lanternwood/shared';

/** A status on a hero or monster. Times are simulation seconds. */
export interface ActiveStatus {
  readonly def: StatusDef;
  until: number;
  /** The hero who applied it (kill credit for burns, healing credit for hymns). */
  readonly sourceId: number;
  /** Damage or healing per second for burns and hymns, fixed when applied. */
  readonly perSecond: number;
  /** Time not yet paid out as a tick. */
  carry: number;
  /** Ticks still to pay; a burn or hymn pays one per second, `seconds` times in all. */
  ticksLeft: number;
}

/** The statuses on one hero or monster. Re-applying a status refreshes it. */
export class StatusList {
  private list: ActiveStatus[] = [];

  get size(): number {
    return this.list.length;
  }

  apply(def: StatusDef, now: number, sourceId: number, perSecond = 0): void {
    const existing = this.list.find((s) => s.def.id === def.id);
    if (existing) this.list.splice(this.list.indexOf(existing), 1);
    this.list.push({ def, until: now + def.seconds, sourceId, perSecond, carry: 0, ticksLeft: perSecond > 0 ? Math.round(def.seconds) : 0 });
  }

  has(id: string, now: number): boolean {
    return this.list.some((s) => s.def.id === id && s.until > now);
  }

  /** The sum of one numeric field over active statuses. */
  sum(field: 'damageDealt' | 'damageTaken', now: number): number {
    let total = 0;
    for (const s of this.list) if (s.until > now) total += s.def[field] ?? 0;
    return total;
  }

  /** The strongest slow, 0..1. */
  slow(now: number): number {
    let worst = 0;
    for (const s of this.list) if (s.until > now) worst = Math.max(worst, s.def.slow ?? 0);
    return worst;
  }

  stunned(now: number): boolean {
    return this.list.some((s) => s.until > now && s.def.stun === true);
  }

  /** Burns and hymns with ticks still to pay. */
  ticking(): readonly ActiveStatus[] {
    return this.list.filter((s) => s.ticksLeft > 0);
  }

  /** Drops statuses that have run out (and paid all their ticks). */
  expire(now: number): void {
    const done = (s: ActiveStatus): boolean => s.until <= now && s.ticksLeft <= 0;
    if (this.list.some(done)) this.list = this.list.filter((s) => !done(s));
  }

  clear(): void {
    this.list = [];
  }

  active(now: number): readonly ActiveStatus[] {
    return this.list.filter((s) => s.until > now);
  }
}
