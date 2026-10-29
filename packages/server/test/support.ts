import { applyEntityUpdates, generateWorld, newProgress, type EntityState, type GeneratedWorld, type MonsterType, type RandomSource, type ServerMessage } from '@lanternwood/shared';
import { GameWorld } from '../src/application/game-world';
import type { ClientLink, SystemTime } from '../src/application/ports';
import type { Calendar } from '../src/domain/ports';
import type { Monster } from '../src/domain/entities/monster';
import type { Player } from '../src/domain/entities/player';

let realm: GeneratedWorld | null = null;
/** World generation takes a moment, so tests share one immutable realm. */
export const sharedRealm = (): GeneratedWorld => (realm ??= generateWorld(2026));

export const constantRandom = (value = 0.5): RandomSource => ({ next: () => value });

/** A calendar tests can turn the page on. */
export class FakeCalendar implements Calendar {
  constructor(public day = 20_000) {}
  today(): number {
    return this.day;
  }
  iso(): string {
    return new Date(this.day * 86_400_000).toISOString();
  }
}

export const makeWorld = (rng: RandomSource = constantRandom(), calendar: Calendar = new FakeCalendar()): GameWorld =>
  new GameWorld({ generated: sharedRealm(), rng, dayLengthSeconds: 480, calendar });

/** Stands a hero next to a character, ready to talk. */
export function standAt(player: Player, at: { readonly x: number; readonly z: number }, offset = 1.2): void {
  Object.assign(player.body, { x: at.x, z: at.z + offset, vx: 0, vy: 0, vz: 0 });
}

export const runTicks = (world: GameWorld, ticks: number, dt = 0.05): void => {
  for (let i = 0; i < ticks; i++) world.step(dt);
};

export const token = (n: number): string => n.toString(16).padStart(32, 'a');

export function spawnHero(world: GameWorld, name = 'Tester', level = 1): Player {
  const progress = { ...newProgress(name), level };
  return world.spawnPlayer(token(name.length + level * 97), 0, progress);
}

export function monsterOf(world: GameWorld, type: MonsterType, skip = 0): Monster {
  const found = [...world.monsters()].filter((m) => m.type === type)[skip];
  if (!found) throw new Error(`no ${type} #${skip}`);
  return found;
}

export function standNextTo(player: Player, m: Monster, gap = 1.2): void {
  Object.assign(player.body, { x: m.x + m.bodyRadius + gap, y: m.y, z: m.z, vx: 0, vy: 0, vz: 0 });
}

export class ManualTime implements SystemTime {
  t = 0;
  monotonic(): number {
    return this.t;
  }
  iso(): string {
    return '2026-10-26T00:00:00.000Z';
  }
}

export class FakeLink implements ClientLink {
  readonly sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;

  constructor(readonly id: string, readonly remoteAddress = '127.0.0.1') {}

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  bufferedBytes(): number {
    return 0;
  }

  of<T extends ServerMessage['t']>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.sent.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === type);
  }

  /** Everything in view after applying every snapshot's deltas, as the client would see it. */
  view(): Map<number, EntityState> {
    const known = new Map<number, EntityState>();
    for (const s of this.of('snapshot')) applyEntityUpdates(known, s.ents, s.gone);
    return known;
  }
}
