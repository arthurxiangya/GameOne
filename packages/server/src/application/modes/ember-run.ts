import {
  MEDAL_MARKS,
  PHYSICS,
  RACE_COUNTDOWN,
  RACE_TIME_LIMIT,
  coursePoints,
  formatRaceTime,
  isAtPoint,
  isOffensive,
  medalFor,
  medalTimes,
  type Medal,
  type ModeState,
  type RaceCourse,
  type SkillDef,
  type Vec3,
} from '@lanternwood/shared';
import type { Player } from '../../domain/entities/player';
import { fail, ok, type Result } from '../../domain/result';
import type { GameMode, ModeHost } from './game-mode';

interface Run {
  readonly player: Player;
  phase: 'countdown' | 'running';
  /** When the clock starts. */
  readonly startsAt: number;
  /** Index into the course points of the next point to reach. */
  next: number;
}

const MEDAL_NAMES: Readonly<Record<Medal, string>> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };

/**
 * Ember Run: a time trial around the island. Every check is made on the server's own
 * simulation of the runner, so the clock can't be cheated: a run can't go faster than the
 * movement the server allows, and checkpoints are judged from the server's position.
 */
export class EmberRun implements GameMode {
  private readonly runs = new Map<number, Run>();
  private readonly points: readonly Vec3[];
  readonly medals: Readonly<Record<Medal, number>>;

  constructor(
    private readonly host: ModeHost,
    private readonly course: RaceCourse,
  ) {
    this.points = coursePoints(course);
    this.medals = medalTimes(course, PHYSICS.walkSpeed);
  }

  isRunning(player: Player): boolean {
    return this.runs.has(player.id);
  }

  start(player: Player): Result {
    if (player.dead) return fail('You are defeated.');
    if (this.runs.has(player.id)) return fail('You are already running.');
    this.host.teleport(player, this.course.start);
    const first = this.points[1]!;
    player.yaw = Math.atan2(first.x - this.course.start.x, first.z - this.course.start.z);
    this.runs.set(player.id, { player, phase: 'countdown', startsAt: this.host.now() + RACE_COUNTDOWN, next: 1 });
    this.host.modeChanged(player);
    this.host.events.player(player.id, { e: 'log', text: 'Ember Run: pass every checkpoint in order, then cross the start line again.', c: 'sys' });
    return ok();
  }

  quit(player: Player): boolean {
    const run = this.runs.get(player.id);
    if (!run) return false;
    this.end(run, 'You gave up the run.');
    return true;
  }

  step(): void {
    const now = this.host.now();
    for (const run of [...this.runs.values()]) {
      const p = run.player;
      if (p.dead) {
        this.end(run, 'You were defeated. The run is over.');
        continue;
      }
      if (run.phase === 'countdown') {
        if (now < run.startsAt) continue;
        run.phase = 'running';
        this.host.modeChanged(p);
        continue;
      }
      if (now - run.startsAt > RACE_TIME_LIMIT) {
        this.end(run, 'Out of time. The run is over.');
        continue;
      }
      if (!isAtPoint(this.points[run.next]!, p.body.x, p.body.y, p.body.z)) continue;
      if (run.next === this.points.length - 1) {
        this.finish(run, now - run.startsAt);
        continue;
      }
      run.next += 1;
      this.host.modeChanged(p);
      const passed = run.next - 1;
      const total = this.course.checkpoints.length;
      this.host.events.player(p.id, { e: 'toast', text: passed === total ? 'Last checkpoint! Back to the start line.' : `Checkpoint ${passed} of ${total}` });
    }
  }

  status(player: Player): ModeState | null {
    const run = this.runs.get(player.id);
    if (!run) return null;
    return { kind: 'race', phase: run.phase, startsAt: run.startsAt, next: run.next, total: this.course.checkpoints.length };
  }

  onPlayerRemoved(player: Player): void {
    this.runs.delete(player.id);
  }

  onPlayerFell(player: Player): void {
    const run = this.runs.get(player.id);
    if (run) this.end(run, 'You fell off the realm. The run is over.');
  }

  skillBlocked(player: Player, skill: SkillDef): string | null {
    return this.runs.has(player.id) && isOffensive(skill) ? 'No fighting during the Ember Run.' : null;
  }

  mountBlocked(player: Player): string | null {
    return this.runs.has(player.id) ? 'The Ember Run is on foot.' : null;
  }

  ignoredByMonsters(player: Player): boolean {
    return this.runs.has(player.id);
  }

  frozen(player: Player): boolean {
    return this.runs.get(player.id)?.phase === 'countdown';
  }

  private finish(run: Run, seconds: number): void {
    const player = run.player;
    this.runs.delete(player.id);
    this.host.modeChanged(player);
    const time = Math.round(seconds * 100) / 100;
    const records = player.progress.records;
    const best = records.raceBest === null || time < records.raceBest;
    if (best) records.raceBest = time;
    const medal = medalFor(time, this.medals);
    const today = this.host.calendar.today();
    if (medal && records.raceDay !== today) {
      records.raceDay = today;
      const marks = MEDAL_MARKS[medal];
      this.host.progression.grantMarks(player, marks);
      this.host.events.player(player.id, { e: 'log', text: `First medal today · +${marks} Ember Mark${marks > 1 ? 's' : ''}`, c: 'loot' });
    }
    player.touchProgress();
    const place = this.host.boards.submit('race', { key: player.accountId, name: player.name, value: time, at: this.host.calendar.iso() });
    const parts = [medal ? `${MEDAL_NAMES[medal]} medal` : 'No medal this time', best ? 'personal best' : '', place ? `#${place} on the board` : ''];
    this.host.events.player(player.id, { e: 'banner', title: formatRaceTime(time), text: parts.filter(Boolean).join(' · ') });
    this.host.events.player(player.id, { e: 'log', text: `Ember Run finished in ${formatRaceTime(time)}. ${parts.filter(Boolean).join(', ')}.`, c: 'good' });
    this.host.achievements.record(player, { kind: 'race', medal });
  }

  private end(run: Run, reason: string): void {
    this.runs.delete(run.player.id);
    this.host.modeChanged(run.player);
    this.host.events.player(run.player.id, { e: 'toast', text: reason });
  }
}
