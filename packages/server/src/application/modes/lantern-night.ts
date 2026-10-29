import {
  LANTERN_POSITION,
  SIEGE,
  WAVES,
  knightDamage,
  knightHp,
  knightSlamDamage,
  lanternMaxHp,
  monsterMaxHp,
  siegeLevel,
  waveSize,
  xpToNext,
  type MonsterType,
  type SiegePhase,
  type SiegeState,
  type Vec3,
} from '@lanternwood/shared';
import type { Monster } from '../../domain/entities/monster';
import type { Player } from '../../domain/entities/player';
import type { GameMode, ModeHost } from './game-mode';

interface Defender {
  damage: number;
  /** Waves this hero was at the fountain for. */
  readonly waves: Set<number>;
}

interface Siege {
  phase: SiegePhase;
  wave: number;
  endsAt: number;
  lantern: number;
  lanternMax: number;
  level: number;
  gates: number[];
  readonly monsters: Set<Monster>;
  knight: Monster | null;
  readonly defenders: Map<number, Defender>;
}

/** Seconds a result stays on screen before it clears; a lost Lantern also stays dark until dawn. */
const RESULT_SECONDS = 12;
/** Lantern health and monster counts reach clients at most this often. */
const UPDATE_INTERVAL = 0.25;
const DAWN = 0.25;

/**
 * Lantern Night. Every third dusk the Night Bell rings; after a warning, five waves of the Gloom
 * march from the road gates on the Great Lantern. Everyone online can defend it; winning pays
 * every defender, losing costs nothing but the reward.
 */
export class LanternNight implements GameMode {
  private siege: Siege | null = null;
  private dusks = 0;
  private lastTimeOfDay: number;
  private dirty = false;
  private phaseChanged = false;
  private lastSent = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly host: ModeHost,
    private readonly gates: readonly Vec3[],
  ) {
    this.lastTimeOfDay = host.timeOfDay();
  }

  get active(): boolean {
    return this.siege !== null && (this.siege.phase === 'warning' || this.siege.phase === 'wave' || this.siege.phase === 'break');
  }

  /** Rings the Night Bell now (tests, and a future admin command). Returns false if one is on. */
  ringBell(): boolean {
    if (this.active) return false;
    const online = [...this.host.players()];
    if (online.length === 0) return false;
    const defenders = Math.max(1, online.length);
    const max = lanternMaxHp(defenders);
    this.siege = {
      phase: 'warning', wave: 0, endsAt: this.host.now() + SIEGE.warningSeconds, lantern: max, lanternMax: max,
      level: SIEGE.minLevel, gates: [], monsters: new Set(), knight: null, defenders: new Map(),
    };
    this.changed(true);
    for (const p of online) {
      this.host.events.player(p.id, { e: 'banner', title: 'Lantern Night', text: 'The Night Bell rings · defend the Great Lantern' });
      this.host.events.player(p.id, { e: 'log', text: `The Night Bell rings! The Gloom marches on Emberhold in ${SIEGE.warningSeconds} seconds. Defend the Great Lantern on the fountain.`, c: 'sys' });
    }
    return true;
  }

  step(): void {
    this.watchForDusk();
    const siege = this.siege;
    if (!siege) return;
    const now = this.host.now();
    switch (siege.phase) {
      case 'warning':
        if (now >= siege.endsAt) this.startWave(1);
        break;
      case 'break':
        if (now >= siege.endsAt) this.startWave(siege.wave + 1);
        break;
      case 'wave':
        this.stepWave(siege, now);
        break;
      case 'won':
        if (now >= siege.endsAt) this.clear();
        break;
      case 'lost': {
        // The Lantern stays dark until dawn (or briefly, if a siege was lost in daylight).
        const t = this.host.timeOfDay();
        if (now >= siege.endsAt && t >= DAWN && t < SIEGE.dusk) this.clear();
        break;
      }
    }
  }

  status(): null {
    return null;
  }

  /** The state every client sees, or null when there is no siege. */
  state(): SiegeState | null {
    const s = this.siege;
    if (!s) return null;
    let remaining = 0;
    for (const m of s.monsters) if (m.alive) remaining++;
    return {
      phase: s.phase, wave: s.wave, waves: WAVES.length, lantern: Math.max(0, Math.round(s.lantern)), lanternMax: s.lanternMax,
      remaining, endsAt: s.phase === 'wave' && s.wave === WAVES.length ? 0 : s.endsAt, gates: [...s.gates],
    };
  }

  /** The state to send if it changed (throttled), `undefined` if there is nothing new. */
  takeUpdate(): SiegeState | null | undefined {
    if (!this.dirty) return undefined;
    const now = this.host.now();
    if (!this.phaseChanged && now - this.lastSent < UPDATE_INTERVAL) return undefined;
    this.dirty = false;
    this.phaseChanged = false;
    this.lastSent = now;
    return this.state();
  }

  onMonsterHit(monster: Monster, attacker: Player | null, amount: number, killed: boolean): void {
    const siege = this.siege;
    if (!siege || !siege.monsters.has(monster)) return;
    if (attacker) this.defender(siege, attacker).damage += amount;
    this.changed(false);
    if (killed && monster === siege.knight) this.win(siege);
  }

  onGoalStruck(monster: Monster, amount: number): void {
    const siege = this.siege;
    if (!siege || !siege.monsters.has(monster) || siege.phase !== 'wave') return;
    siege.lantern -= amount;
    this.changed(false);
    if (siege.lantern <= 0) this.lose(siege);
  }

  onPlayerRemoved(player: Player): void {
    this.siege?.defenders.delete(player.id);
  }

  // ------------------------------------------------------------------ internals

  /** Counts dusks; every third one rings the bell. */
  private watchForDusk(): void {
    const t = this.host.timeOfDay();
    const before = this.lastTimeOfDay;
    this.lastTimeOfDay = t;
    const crossed = before < SIEGE.dusk ? t >= SIEGE.dusk || t < before : false;
    if (!crossed) return;
    this.dusks += 1;
    if (this.dusks % SIEGE.everyNights === 0) this.ringBell();
  }

  private stepWave(siege: Siege, now: number): void {
    for (const p of this.host.players()) {
      if (!p.dead && Math.hypot(p.body.x - LANTERN_POSITION.x, p.body.z - LANTERN_POSITION.z) <= SIEGE.defenderRadius) {
        this.defender(siege, p).waves.add(siege.wave);
      }
    }
    let alive = 0;
    for (const m of siege.monsters) if (m.alive) alive++;
    const last = siege.wave === WAVES.length;
    if (alive === 0) {
      if (last) this.win(siege);
      else this.setPhase(siege, 'break', now + SIEGE.breakSeconds);
    } else if (!last && now >= siege.endsAt) {
      this.startWave(siege.wave + 1);
    }
  }

  private startWave(n: number): void {
    const siege = this.siege;
    if (!siege) return;
    const online = [...this.host.players()];
    const near = online.filter((p) => Math.hypot(p.body.x - LANTERN_POSITION.x, p.body.z - LANTERN_POSITION.z) <= SIEGE.defenderRadius);
    const crowd = near.length > 0 ? near : online;
    const defenders = Math.max(1, crowd.length);
    siege.level = siegeLevel(crowd.length ? crowd.reduce((sum, p) => sum + p.level, 0) / crowd.length : SIEGE.minLevel);
    const wave = WAVES[n - 1]!;
    siege.wave = n;
    siege.gates = this.pickGates(wave.gates);
    const { wisps, shades } = waveSize(wave, defenders);
    const level = siege.level;
    for (let i = 0; i < wisps; i++) {
      this.spawn(siege, 'wisp', level, i, { maxHp: Math.round(monsterMaxHp('wisp', level) * 0.5), goalOnly: true });
    }
    for (let i = 0; i < shades; i++) this.spawn(siege, 'shade', level, wisps + i, {});
    if (wave.knight) {
      siege.knight = this.spawn(siege, 'gloomknight', level, 0, {
        maxHp: knightHp(level, defenders), damage: knightDamage(level), slamDamage: knightSlamDamage(level),
      });
    }
    this.setPhase(siege, 'wave', this.host.now() + SIEGE.waveSeconds);
    for (const p of online) {
      this.host.events.player(p.id, { e: 'toast', text: wave.knight ? 'The Gloom Knight comes! Defeat it to save the Lantern.' : `Wave ${n} of ${WAVES.length}` });
    }
  }

  private spawn(siege: Siege, type: MonsterType, level: number, index: number, stats: { maxHp?: number; damage?: number; slamDamage?: number; goalOnly?: boolean }): Monster {
    const gate = this.gates[siege.gates[index % siege.gates.length]!]!;
    const x = gate.x + (this.host.rng.next() - 0.5) * 5;
    const z = gate.z + (this.host.rng.next() - 0.5) * 5;
    const m = this.host.spawnMonster(type, level, x, z, { ...stats, transient: true, goal: { x: LANTERN_POSITION.x, z: LANTERN_POSITION.z } });
    siege.monsters.add(m);
    return m;
  }

  private pickGates(count: number): number[] {
    const all = this.gates.map((_, i) => i);
    const picked: number[] = [];
    while (picked.length < Math.min(count, all.length)) {
      const i = all.splice(Math.floor(this.host.rng.next() * all.length), 1)[0]!;
      picked.push(i);
    }
    return picked.sort((a, b) => a - b);
  }

  private defender(siege: Siege, p: Player): Defender {
    let d = siege.defenders.get(p.id);
    if (!d) siege.defenders.set(p.id, (d = { damage: 0, waves: new Set() }));
    return d;
  }

  /** Heroes still online who stood at the fountain for a wave or hurt the Gloom. */
  private participants(siege: Siege): Player[] {
    const out: Player[] = [];
    for (const p of this.host.players()) {
      const d = siege.defenders.get(p.id);
      if (d && (d.waves.size > 0 || d.damage > 0)) out.push(p);
    }
    return out;
  }

  private win(siege: Siege): void {
    if (siege.phase === 'won' || siege.phase === 'lost') return;
    this.setPhase(siege, 'won', this.host.now() + RESULT_SECONDS);
    this.despawn(siege);
    const heroes = this.participants(siege);
    const top = [...heroes].sort((a, b) => (siege.defenders.get(b.id)?.damage ?? 0) - (siege.defenders.get(a.id)?.damage ?? 0)).slice(0, 3);
    const untilDusk = (((SIEGE.dusk - this.host.timeOfDay()) % 1) + 1) % 1;
    for (const p of heroes) {
      const { progression } = this.host;
      const gold = 40 + 10 * p.level;
      const marks = SIEGE.winMarks + (top.includes(p) ? SIEGE.topDamageMarks : 0);
      progression.grantGold(p, gold);
      progression.grantMarks(p, marks);
      progression.grantXp(p, Math.round(xpToNext(p.level) * 0.3));
      p.blessedUntil = this.host.now() + untilDusk * this.host.dayLengthSeconds;
      p.progress.records.nightsWon += 1;
      p.touchProgress();
      this.host.events.player(p.id, { e: 'log', text: `The Lantern holds! +${gold} gold · +${marks} Ember Marks · Lantern's Blessing: +10% XP until next dusk`, c: 'good' });
      if (p.progress.records.nightsWon >= SIEGE.steedWins) progression.grantMount(p, 'steed');
      if (this.host.rng.next() < SIEGE.mothChance) this.host.grantPet(p, 'moth');
      this.host.achievements.record(p, { kind: 'siege', won: true });
    }
    for (const p of this.host.players()) this.host.events.player(p.id, { e: 'banner', title: 'The Lantern holds', text: 'Emberhold is safe until the next Night Bell' });
  }

  private lose(siege: Siege): void {
    if (siege.phase === 'won' || siege.phase === 'lost') return;
    siege.lantern = 0;
    this.setPhase(siege, 'lost', this.host.now() + RESULT_SECONDS);
    this.despawn(siege);
    for (const p of this.participants(siege)) this.host.achievements.record(p, { kind: 'siege', won: false });
    for (const p of this.host.players()) {
      this.host.events.player(p.id, { e: 'banner', title: 'The Lantern goes dark', text: 'The Gloom withdraws until the next Night Bell' });
    }
  }

  private despawn(siege: Siege): void {
    for (const m of siege.monsters) this.host.removeMonster(m);
    siege.monsters.clear();
    siege.knight = null;
  }

  private clear(): void {
    this.siege = null;
    this.changed(true);
  }

  private setPhase(siege: Siege, phase: SiegePhase, endsAt: number): void {
    siege.phase = phase;
    siege.endsAt = endsAt;
    this.changed(true);
  }

  private changed(phase: boolean): void {
    this.dirty = true;
    this.phaseChanged ||= phase;
  }
}
