import { DUEL, eloAfter, type DuelResult, type DuelState, type SkillDef } from '@lanternwood/shared';
import type { Player } from '../../domain/entities/player';
import { fail, ok, type Result } from '../../domain/result';
import type { GameMode, ModeHost } from './game-mode';

interface Invite {
  readonly from: Player;
  readonly to: Player;
  readonly endsAt: number;
}

interface Duel {
  readonly a: Player;
  readonly b: Player;
  readonly x: number;
  readonly z: number;
  phase: 'countdown' | 'fight';
  /** End of the countdown, then end of the fight. */
  endsAt: number;
}

/**
 * The Duel Ring. One hero challenges another nearby; on accept a ring appears between them,
 * both are healed and fight at the lower of their two levels, hitting only each other. Nobody
 * dies: a hero who would drop to 0 yields at 1 health. Stepping out of the ring or leaving
 * forfeits; after the time limit the higher health share wins. Ratings move like chess Elo.
 */
export class Duels implements GameMode {
  private readonly invites = new Map<number, Invite>();
  private readonly duels = new Map<number, Duel>();

  constructor(
    private readonly host: ModeHost,
    /** Whether a siege (or anything else) forbids duels right now. */
    private readonly blocked: () => string | null,
  ) {}

  challenge(from: Player, to: Player | undefined): Result {
    if (!to || to === from) return fail('Choose another hero to duel.');
    const reason = this.blocked();
    if (reason) return fail(reason);
    if (from.dead || to.dead) return fail('Both heroes must be standing.');
    if (Math.hypot(to.body.x - from.body.x, to.body.z - from.body.z) > DUEL.challengeRange) return fail(`Walk closer to ${to.name} to challenge them.`);
    if (this.host.busy(from)) return fail('Finish what you are doing first.');
    if (this.host.busy(to)) return fail(`${to.name} is busy.`);
    const invite: Invite = { from, to, endsAt: this.host.now() + DUEL.inviteSeconds };
    this.invites.set(from.id, invite);
    this.host.modeChanged(from);
    this.host.modeChanged(to);
    return ok();
  }

  answer(player: Player, accept: boolean): Result {
    const invite = this.inviteTo(player);
    if (!invite) return fail('Nobody has challenged you.');
    this.invites.delete(invite.from.id);
    this.host.modeChanged(invite.from);
    this.host.modeChanged(player);
    if (!accept) {
      this.host.events.player(invite.from.id, { e: 'toast', text: `${player.name} declined the duel.` });
      return ok();
    }
    const reason = this.blocked();
    if (reason) return fail(reason);
    if (invite.from.dead || player.dead) return fail('Both heroes must be standing.');
    this.begin(invite.from, player);
    return ok();
  }

  step(): void {
    const now = this.host.now();
    for (const invite of [...this.invites.values()]) {
      if (now < invite.endsAt && !invite.from.dead && !invite.to.dead) continue;
      this.invites.delete(invite.from.id);
      this.host.modeChanged(invite.from);
      this.host.modeChanged(invite.to);
      this.host.events.player(invite.from.id, { e: 'toast', text: `${invite.to.name} did not answer.` });
    }
    for (const duel of new Set(this.duels.values())) {
      if (duel.phase === 'countdown') {
        if (now >= duel.endsAt) {
          duel.phase = 'fight';
          duel.endsAt = now + DUEL.fightSeconds;
          this.changed(duel);
        }
        continue;
      }
      for (const [p, other] of [[duel.a, duel.b], [duel.b, duel.a]] as const) {
        if (Math.hypot(p.body.x - duel.x, p.body.z - duel.z) > DUEL.ringRadius + 0.5) {
          this.end(duel, other, `${p.name} stepped out of the ring.`);
          break;
        }
      }
      if (!this.duels.has(duel.a.id)) continue;
      if (now >= duel.endsAt) {
        const share = (p: Player): number => p.hp / p.maxHp;
        const diff = share(duel.a) - share(duel.b);
        this.end(duel, Math.abs(diff) < 0.01 ? null : diff > 0 ? duel.a : duel.b, 'Time!');
      }
    }
  }

  status(player: Player): DuelState | null {
    const duel = this.duels.get(player.id);
    if (duel) {
      const other = duel.a === player ? duel.b : duel.a;
      return { kind: 'duel', phase: duel.phase, opponent: other.name, opponentId: other.id, endsAt: duel.endsAt, x: duel.x, z: duel.z, radius: DUEL.ringRadius };
    }
    const sent = this.invites.get(player.id);
    if (sent) return this.inviteState(sent, 'challenging', sent.to);
    const received = this.inviteTo(player);
    if (received) return this.inviteState(received, 'invited', received.from);
    return null;
  }

  quit(player: Player): boolean {
    const sent = this.invites.get(player.id);
    if (sent) {
      this.invites.delete(player.id);
      this.host.modeChanged(player);
      this.host.modeChanged(sent.to);
      return true;
    }
    if (this.inviteTo(player)) {
      this.answer(player, false);
      return true;
    }
    const duel = this.duels.get(player.id);
    if (!duel) return false;
    this.end(duel, duel.a === player ? duel.b : duel.a, `${player.name} yields.`);
    return true;
  }

  /** The opponent while the fight is on. */
  opponent(player: Player): Player | null {
    const duel = this.duels.get(player.id);
    if (!duel || duel.phase !== 'fight') return null;
    return duel.a === player ? duel.b : duel.a;
  }

  down(winner: Player, loser: Player): void {
    const duel = this.duels.get(loser.id);
    if (duel && (duel.a === winner || duel.b === winner)) this.end(duel, winner, `${loser.name} yields.`);
  }

  onPlayerRemoved(player: Player): void {
    this.invites.delete(player.id);
    const received = this.inviteTo(player);
    if (received) this.invites.delete(received.from.id);
    const duel = this.duels.get(player.id);
    if (duel) this.end(duel, duel.a === player ? duel.b : duel.a, `${player.name} left.`);
  }

  onPlayerFell(player: Player): void {
    const duel = this.duels.get(player.id);
    if (duel) this.end(duel, duel.a === player ? duel.b : duel.a, `${player.name} fell out of the ring.`);
  }

  skillBlocked(player: Player, skill: SkillDef): string | null {
    const duel = this.duels.get(player.id);
    if (!duel) return null;
    if (duel.phase === 'countdown') return 'Wait for the countdown.';
    return skill.id === 'tonic' ? 'No tonics in a duel.' : null;
  }

  mountBlocked(player: Player): string | null {
    return this.status(player) ? 'Not while you are dueling.' : null;
  }

  ignoredByMonsters(player: Player): boolean {
    return this.duels.has(player.id);
  }

  frozen(player: Player): boolean {
    return this.duels.get(player.id)?.phase === 'countdown';
  }

  // ------------------------------------------------------------------ internals

  private inviteTo(player: Player): Invite | undefined {
    for (const invite of this.invites.values()) if (invite.to === player) return invite;
    return undefined;
  }

  private inviteState(invite: Invite, phase: 'invited' | 'challenging', other: Player): DuelState {
    return { kind: 'duel', phase, opponent: other.name, opponentId: other.id, endsAt: invite.endsAt, x: 0, z: 0, radius: DUEL.ringRadius };
  }

  private begin(a: Player, b: Player): void {
    const level = Math.min(a.level, b.level);
    const duel: Duel = {
      a, b, x: (a.body.x + b.body.x) / 2, z: (a.body.z + b.body.z) / 2, phase: 'countdown', endsAt: this.host.now() + DUEL.countdownSeconds,
    };
    for (const p of [a, b]) {
      p.dismount();
      p.duelLevel = level;
      // A fair start: no buffs, wards or cooldowns carried in.
      p.statuses.clear();
      p.shield = 0;
      p.cooldowns.clear();
      p.restoreVitals();
      this.duels.set(p.id, duel);
    }
    this.changed(duel);
    this.host.events.area(duel.x, duel.z, { e: 'log', text: `${a.name} and ${b.name} begin a duel${a.level !== b.level ? ` at level ${level}` : ''}!`, c: 'sys' });
  }

  private end(duel: Duel, winner: Player | null, why: string): void {
    if (!this.duels.has(duel.a.id)) return;
    this.duels.delete(duel.a.id);
    this.duels.delete(duel.b.id);
    const fought = duel.phase === 'fight';
    for (const p of [duel.a, duel.b]) {
      p.duelLevel = null;
      p.restoreVitals();
      this.host.modeChanged(p);
    }
    if (!fought && winner === null) return;
    const result = (p: Player): DuelResult => (winner === null ? 'draw' : winner === p ? 'win' : 'loss');
    const ra = duel.a.progress.records;
    const rb = duel.b.progress.records;
    const rating = eloAfter(ra.rating, rb.rating, result(duel.a));
    ra.rating = rating.a;
    rb.rating = rating.b;
    for (const p of [duel.a, duel.b]) {
      const r = p.progress.records;
      const outcome = result(p);
      if (outcome === 'win') r.duelWins += 1;
      else if (outcome === 'loss') r.duelLosses += 1;
      else r.duelDraws += 1;
      p.touchProgress();
      this.host.events.player(p.id, {
        e: 'banner',
        title: outcome === 'win' ? 'Victory' : outcome === 'loss' ? 'Defeat' : 'A draw',
        text: `${why} Rating ${r.rating}`,
      });
      this.host.achievements.record(p, { kind: 'duel', result: outcome });
      this.host.boards.submit('duel', { key: p.accountId, name: p.name, value: r.rating, at: this.host.calendar.iso() });
    }
    const line = winner ? `${winner.name} wins the duel against ${winner === duel.a ? duel.b.name : duel.a.name}. ${why}` : `The duel between ${duel.a.name} and ${duel.b.name} is a draw.`;
    this.host.events.area(duel.x, duel.z, { e: 'log', text: line, c: 'sys' });
  }

  private changed(duel: Duel): void {
    this.host.modeChanged(duel.a);
    this.host.modeChanged(duel.b);
  }
}
