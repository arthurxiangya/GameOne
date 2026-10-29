import {
  LORD_SUMMONS,
  RIFT,
  RIFT_WAVES,
  isInRiftCircle,
  monsterMaxHp,
  riftHpScale,
  riftLordDamage,
  riftLordHp,
  riftMarks,
  riftScore,
  type ModeState,
  type MonsterType,
  type RiftPhase,
  type Vec3,
} from '@lanternwood/shared';
import type { Monster } from '../../domain/entities/monster';
import type { Player } from '../../domain/entities/player';
import { fail, ok, type Result } from '../../domain/result';
import type { GameMode, ModeHost } from './game-mode';

interface Gathering {
  readonly opener: Player;
  readonly endsAt: number;
}

interface Run {
  readonly id: number;
  readonly arena: number;
  /** Heroes still on the island. */
  readonly members: Set<Player>;
  /** Everyone who came through the door, for rewards and the board. */
  readonly party: readonly Player[];
  phase: RiftPhase;
  wave: number;
  endsAt: number;
  readonly deadline: number;
  readonly level: number;
  readonly monsters: Set<Monster>;
  lord: Monster | null;
  summons: number[];
  knockouts: number;
  cleared: number;
  score: number;
}

/**
 * Rift Trials. Seer Ilka opens a rift; everyone standing in her stone circle when it opens goes
 * through together to a free floating island, fights five waves ending in the Rift Lord, and is
 * scored against the clock. Rift monsters belong to their party: nobody else can hit them, and
 * they attack nobody else.
 */
export class RiftTrials implements GameMode {
  private gathering: Gathering | null = null;
  private readonly runs = new Map<number, Run>();
  private readonly byPlayer = new Map<number, Run>();
  private readonly arenaBusy: (Run | null)[];
  private nextRunId = 1;

  constructor(
    private readonly host: ModeHost,
    private readonly arenas: readonly Vec3[],
  ) {
    this.arenaBusy = arenas.map(() => null);
  }

  open(player: Player): Result {
    if (player.level < RIFT.minLevel) return fail(`The rift would tear you apart. Come back at level ${RIFT.minLevel}.`);
    if (this.host.busy(player)) return fail('Finish what you are doing first.');
    if (this.gathering) return fail('A rift is already opening. Step into the stone circle to join.');
    if (!this.arenaBusy.includes(null)) {
      const soonest = Math.min(...this.arenaBusy.map((r) => (r ? r.deadline - this.host.now() : 0)));
      return fail(`All four rifts are in use. The next one closes within ${Math.ceil(soonest / 60)} minute${soonest > 60 ? 's' : ''}.`);
    }
    this.gathering = { opener: player, endsAt: this.host.now() + RIFT.gatherSeconds };
    this.host.modeChanged(player);
    for (const p of this.host.players()) {
      if (Math.hypot(p.body.x - RIFT.circle.x, p.body.z - RIFT.circle.z) > 30) continue;
      this.host.events.player(p.id, {
        e: 'toast',
        text: p === player ? `The rift opens in ${RIFT.gatherSeconds} seconds. Stand in the stone circle.` : `${player.name} is opening a rift: step into the stone circle to join.`,
      });
    }
    return ok();
  }

  step(): void {
    const now = this.host.now();
    if (this.gathering && now >= this.gathering.endsAt) this.closeGathering();
    for (const run of [...this.runs.values()]) this.stepRun(run, now);
  }

  status(player: Player): ModeState | null {
    if (this.gathering?.opener === player) {
      return { kind: 'rift', phase: 'gathering', wave: 0, waves: RIFT_WAVES.length, endsAt: this.gathering.endsAt, deadline: 0, remaining: 0, party: [player.name], score: 0 };
    }
    const run = this.byPlayer.get(player.id);
    if (!run) return null;
    let remaining = 0;
    for (const m of run.monsters) if (m.alive) remaining++;
    return {
      kind: 'rift', phase: run.phase, wave: run.wave, waves: RIFT_WAVES.length, endsAt: run.endsAt, deadline: run.deadline,
      remaining, party: run.party.map((p) => p.name), score: run.score,
    };
  }

  quit(player: Player): boolean {
    if (this.gathering?.opener === player) {
      this.gathering = null;
      this.host.modeChanged(player);
      return true;
    }
    const run = this.byPlayer.get(player.id);
    if (!run) return false;
    this.leave(run, player, false);
    this.host.sendHome(player);
    this.host.events.player(player.id, { e: 'toast', text: 'You left the rift.' });
    return true;
  }

  onPlayerRemoved(player: Player): void {
    if (this.gathering?.opener === player) this.gathering = null;
    const run = this.byPlayer.get(player.id);
    if (run) this.leave(run, player, true);
  }

  onPlayerFell(player: Player): void {
    const run = this.byPlayer.get(player.id);
    if (run) this.leave(run, player, true);
  }

  mountBlocked(player: Player): string | null {
    return this.byPlayer.has(player.id) ? 'No mounts in the rift.' : null;
  }

  onMonsterHit(monster: Monster, _attacker: Player | null, _amount: number, killed: boolean): void {
    const run = monster.party !== null ? this.runs.get(monster.party) : undefined;
    if (!run || run.phase !== 'wave') return;
    this.markChanged(run);
    if (monster !== run.lord) return;
    if (killed) {
      this.finish(run, true);
      return;
    }
    // The Lord calls wisps to its side as it weakens.
    const fraction = monster.hp / monster.maxHp;
    while (run.summons.length > 0 && fraction <= run.summons[0]!) {
      run.summons.shift();
      for (let i = 0; i < 2; i++) this.spawn(run, 'wisp', i * 3 + 1, monsterMaxHp('wisp', run.level));
    }
  }

  // ------------------------------------------------------------------ internals

  private closeGathering(): void {
    const opener = this.gathering!.opener;
    this.gathering = null;
    this.host.modeChanged(opener);
    const arena = this.arenaBusy.indexOf(null);
    const candidates = [...this.host.players()]
      .filter((p) => !p.dead && p.level >= RIFT.minLevel && !this.host.busy(p) && isInRiftCircle(p.body.x, p.body.z))
      .sort((a, b) => (a === opener ? -1 : b === opener ? 1 : 0))
      .slice(0, RIFT.maxParty);
    if (candidates.length === 0 || arena < 0) {
      this.host.events.player(opener.id, { e: 'toast', text: arena < 0 ? 'Every rift is in use. Try again soon.' : 'Nobody stood in the circle. The rift closes.' });
      return;
    }
    const now = this.host.now();
    const run: Run = {
      id: this.nextRunId++, arena, members: new Set(candidates), party: candidates, phase: 'starting', wave: 0,
      endsAt: now + RIFT.startSeconds, deadline: now + RIFT.startSeconds + RIFT.timeLimit,
      level: Math.max(...candidates.map((p) => p.level)), monsters: new Set(), lord: null, summons: [...LORD_SUMMONS],
      knockouts: 0, cleared: 0, score: 0,
    };
    this.runs.set(run.id, run);
    this.arenaBusy[arena] = run;
    const centre = this.arenas[arena]!;
    candidates.forEach((p, i) => {
      p.dismount();
      p.party = run.id;
      this.byPlayer.set(p.id, run);
      const a = (i / candidates.length) * Math.PI * 2;
      this.host.teleport(p, { x: centre.x + Math.cos(a) * 1.5, y: centre.y, z: centre.z + Math.sin(a) * 1.5 });
      this.host.modeChanged(p);
      this.host.events.player(p.id, { e: 'banner', title: 'Rift Trial', text: `${candidates.length === 1 ? 'Alone' : `${candidates.length} heroes`} · five waves · the Rift Lord` });
    });
  }

  private stepRun(run: Run, now: number): void {
    for (const p of [...run.members]) {
      if (p.dead) {
        this.leave(run, p, true);
        this.host.events.player(p.id, { e: 'toast', text: 'Knocked out of the rift. The healers of Emberhold will patch you up.' });
      }
    }
    if (run.phase === 'done' || run.phase === 'failed') {
      if (now >= run.endsAt) this.close(run);
      return;
    }
    if (run.members.size === 0) {
      this.finish(run, false);
      return;
    }
    if (now >= run.deadline) {
      for (const p of run.members) this.host.events.player(p.id, { e: 'toast', text: 'The rift collapses: out of time.' });
      this.finish(run, false);
      return;
    }
    if (run.phase === 'starting' || run.phase === 'break') {
      if (now >= run.endsAt) this.startWave(run, run.wave + 1);
      return;
    }
    let alive = 0;
    for (const m of run.monsters) if (m.alive) alive++;
    if (alive > 0) return;
    run.cleared = run.wave;
    if (run.wave >= RIFT_WAVES.length) this.finish(run, true);
    else {
      run.phase = 'break';
      run.endsAt = now + RIFT.breakSeconds;
      this.markChanged(run);
    }
  }

  private startWave(run: Run, n: number): void {
    const wave = RIFT_WAVES[n - 1]!;
    run.wave = n;
    run.phase = 'wave';
    run.endsAt = 0;
    run.monsters.clear();
    const extra = run.party.length - 1;
    let slot = 0;
    for (const group of wave.monsters) {
      const count = Math.round(group.count[0] + group.count[1] * extra);
      for (let i = 0; i < count; i++) this.spawn(run, group.type, slot++, Math.round(monsterMaxHp(group.type, run.level) * riftHpScale(run.party.length)));
    }
    if (wave.lord) {
      const centre = this.arenas[run.arena]!;
      run.lord = this.host.spawnMonster('riftlord', run.level, centre.x, centre.z + 4, {
        maxHp: riftLordHp(run.level, run.party.length), damage: riftLordDamage(run.level), slamDamage: Math.round(20 + 3 * run.level),
        transient: true, party: run.id, huntRange: RIFT.aggroRange,
      });
      run.monsters.add(run.lord);
    }
    for (const p of run.members) {
      this.host.achievements.record(p, { kind: 'rift', wave: n });
      this.host.events.player(p.id, { e: 'toast', text: wave.lord ? 'The Rift Lord!' : `Wave ${n} of ${RIFT_WAVES.length}` });
    }
    this.markChanged(run);
  }

  private spawn(run: Run, type: MonsterType, slot: number, maxHp: number): void {
    const centre = this.arenas[run.arena]!;
    const a = slot * 2.4;
    const r = RIFT.arenaRadius - 1.8;
    const m = this.host.spawnMonster(type, run.level, centre.x + Math.cos(a) * r, centre.z + Math.sin(a) * r, {
      maxHp, transient: true, party: run.id, huntRange: RIFT.aggroRange,
    });
    run.monsters.add(m);
  }

  private leave(run: Run, p: Player, knockedOut: boolean): void {
    if (!run.members.delete(p)) return;
    if (knockedOut && run.phase !== 'done' && run.phase !== 'failed') run.knockouts += 1;
    this.byPlayer.delete(p.id);
    p.party = null;
    this.host.modeChanged(p);
    this.markChanged(run);
  }

  private finish(run: Run, lordDefeated: boolean): void {
    if (run.phase === 'done' || run.phase === 'failed') return;
    const now = this.host.now();
    if (lordDefeated) run.cleared = RIFT_WAVES.length;
    run.score = riftScore(run.cleared, run.deadline - now, lordDefeated, run.knockouts);
    run.phase = lordDefeated ? 'done' : 'failed';
    run.endsAt = now + RIFT.endSeconds;
    for (const m of run.monsters) if (m.alive) this.host.removeMonster(m);
    run.monsters.clear();
    run.lord = null;

    const today = this.host.calendar.today();
    const online = new Set(this.host.players());
    const party = run.party.filter((p) => online.has(p));
    for (const p of party) {
      const records = p.progress.records;
      const marks = riftMarks(run.cleared) + (lordDefeated && run.members.has(p) && records.riftLordDay !== today ? 1 : 0);
      if (lordDefeated && run.members.has(p)) {
        if (records.riftLordDay !== today) records.riftLordDay = today;
        if (!p.progress.pets.some((x) => x.id === 'mote')) this.host.grantPet(p, 'mote');
      }
      if (marks > 0) this.host.progression.grantMarks(p, marks);
      const best = run.score > records.riftBest;
      if (best) records.riftBest = run.score;
      p.touchProgress();
      this.host.events.player(p.id, {
        e: 'banner',
        title: lordDefeated ? 'The Rift Lord falls' : 'The rift closes',
        text: `${run.score.toLocaleString('en-US')} points${best ? ' · personal best' : ''}${marks ? ` · +${marks} Ember Mark${marks > 1 ? 's' : ''}` : ''}`,
      });
    }
    if (party.length > 0 && run.score > 0) {
      const [leader, ...rest] = run.party;
      this.host.boards.submit('rift', {
        key: run.party.map((p) => p.accountId).sort().join('+'),
        name: leader!.name,
        value: run.score,
        at: this.host.calendar.iso(),
        ...(rest.length ? { detail: rest.map((p) => p.name).join(', ') } : {}),
      });
    }
    this.markChanged(run);
  }

  /** Sends whoever is left home and frees the island. */
  private close(run: Run): void {
    for (const p of [...run.members]) {
      this.leave(run, p, false);
      this.host.sendHome(p);
    }
    this.runs.delete(run.id);
    this.arenaBusy[run.arena] = null;
  }

  private markChanged(run: Run): void {
    for (const p of run.members) this.host.modeChanged(p);
  }
}
