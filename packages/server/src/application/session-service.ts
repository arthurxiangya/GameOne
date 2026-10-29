import {
  MAX_CLIENT_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  cloneProgress,
  decodeJson,
  encodeMessage,
  lookForAccount,
  parseClientMessage,
  type ClientMessage,
  type GameEvent,
  type ServerMessage,
} from '@lanternwood/shared';
import type { Player } from '../domain/entities/player';
import type { RoutedEvent } from '../domain/events';
import { newPlayerRecord, progressFromRecord, recordFromPlayer } from '../domain/player-record';
import type { PlayerRecord, PlayerRepository } from '../domain/ports';
import type { GameWorld } from './game-world';
import type { ClientLink, Logger, SystemTime, TokenHasher } from './ports';
import { TokenBucket } from './rate-limiter';
import { SnapshotBuilder } from './snapshot-builder';

export interface SessionOptions {
  readonly maxPlayers: number;
  readonly interestRadius: number;
  readonly snapshotEveryTicks: number;
  readonly tickRate: number;
  readonly dayLengthSeconds: number;
}

export interface SessionDependencies {
  readonly world: GameWorld;
  readonly repository: PlayerRepository;
  readonly logger: Logger;
  readonly time: SystemTime;
  readonly hashToken: TokenHasher;
  readonly options: SessionOptions;
}

/** WebSocket close codes used by the game (4000–4999 is the application range). */
export const CloseCode = {
  ServerShutdown: 4001,
  ProtocolViolation: 4400,
  Rejected: 4403,
  SignedInElsewhere: 4409,
  ServerFull: 4503,
} as const;

type SessionState = 'connected' | 'joining' | 'playing' | 'closed';

interface Session {
  readonly link: ClientLink;
  state: SessionState;
  player: Player | null;
  record: PlayerRecord | null;
  readonly messageBudget: TokenBucket;
  readonly chatBudget: TokenBucket;
  violations: number;
  events: GameEvent[];
}

const MAX_PENDING_EVENTS = 400;
const BACKPRESSURE_BYTES = 512 * 1024;
const MAX_VIOLATIONS = 30;

/**
 * Bridges transport and simulation: authenticates guests, validates and rate-limits every
 * message, turns them into world commands, routes events to the right players, sends
 * snapshots, and persists heroes on leave and on autosave.
 */
export class SessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly byAccount = new Map<string, Session>();
  private readonly byPlayer = new Map<number, Session>();
  private readonly snapshots: SnapshotBuilder;

  constructor(private readonly deps: SessionDependencies) {
    this.snapshots = new SnapshotBuilder(deps.world, deps.options.interestRadius);
  }

  get playerCount(): number {
    return this.byPlayer.size;
  }

  get connectionCount(): number {
    return this.sessions.size;
  }

  // ------------------------------------------------------------------ transport callbacks

  connect(link: ClientLink): void {
    const now = this.deps.time.monotonic();
    this.sessions.set(link.id, {
      link,
      state: 'connected',
      player: null,
      record: null,
      messageBudget: new TokenBucket(80, 50, now),
      chatBudget: new TokenBucket(5, 0.5, now),
      violations: 0,
      events: [],
    });
    this.deps.logger.debug('connection opened', { link: link.id, remote: link.remoteAddress });
  }

  async receive(link: ClientLink, text: string): Promise<void> {
    const session = this.sessions.get(link.id);
    if (!session || session.state === 'closed') return;
    const now = this.deps.time.monotonic();
    if (!session.messageBudget.tryTake(now)) {
      this.violation(session, 'You are sending too fast.');
      return;
    }
    const parsed = parseClientMessage(decodeJson(text, MAX_CLIENT_MESSAGE_BYTES));
    if (!parsed.ok) {
      this.violation(session, parsed.error);
      return;
    }
    try {
      await this.dispatch(session, parsed.msg, now);
    } catch (err) {
      this.deps.logger.error('message handler failed', { link: link.id, type: parsed.msg.t, error: describe(err) });
    }
  }

  async disconnect(link: ClientLink): Promise<void> {
    const session = this.sessions.get(link.id);
    if (!session) return;
    this.sessions.delete(link.id);
    const wasPlaying = session.state === 'playing';
    session.state = 'closed';
    if (wasPlaying) await this.leave(session, true);
    this.deps.logger.debug('connection closed', { link: link.id });
  }

  // ------------------------------------------------------------------ tick hook

  /** Called after every simulation step. */
  afterTick(): void {
    this.routeEvents(this.deps.world.drainEvents());
    const sendSnapshots = this.deps.world.tick % this.deps.options.snapshotEveryTicks === 0;
    for (const session of this.byPlayer.values()) {
      const player = session.player;
      if (!player) continue;
      if (player.progressDirty) {
        player.progressDirty = false;
        this.send(session, { t: 'progress', p: cloneProgress(player.progress) });
      }
      if (!sendSnapshots) continue;
      // A client that cannot keep up skips snapshots; its events wait for the next one.
      if (session.link.bufferedBytes() > BACKPRESSURE_BYTES) continue;
      const events = session.events;
      session.events = [];
      this.send(session, this.snapshots.build(player, events));
    }
  }

  async saveAll(): Promise<void> {
    const saves: Promise<void>[] = [];
    for (const session of this.byPlayer.values()) {
      if (session.player && session.record) saves.push(this.persist(session, session.player));
    }
    await Promise.all(saves);
  }

  async shutdown(): Promise<void> {
    const leaving: Promise<void>[] = [];
    for (const session of [...this.sessions.values()]) {
      this.sessions.delete(session.link.id);
      const wasPlaying = session.state === 'playing';
      session.state = 'closed';
      session.link.close(CloseCode.ServerShutdown, 'The server is restarting. Your progress is saved.');
      if (wasPlaying) leaving.push(this.leave(session, false));
    }
    await Promise.all(leaving);
  }

  // ------------------------------------------------------------------ message handling

  private async dispatch(session: Session, msg: ClientMessage, now: number): Promise<void> {
    if (msg.t === 'hello') {
      await this.join(session, msg);
      return;
    }
    if (msg.t === 'ping') {
      this.send(session, { t: 'pong', at: msg.at, server: this.deps.world.time });
      return;
    }
    const player = session.player;
    if (session.state !== 'playing' || !player) {
      this.violation(session, 'Join the game first.');
      return;
    }
    const world = this.deps.world;
    switch (msg.t) {
      case 'input':
        world.queueInput(player.id, msg.frames);
        return;
      case 'skill':
        world.execute(player.id, { kind: 'skill', skill: msg.skill, target: msg.target });
        return;
      case 'npc':
        world.execute(player.id, { kind: 'npc', npc: msg.npc, action: msg.action, arg: msg.arg });
        return;
      case 'title':
        world.execute(player.id, { kind: 'title', title: msg.title });
        return;
      case 'respawn':
        world.execute(player.id, { kind: 'respawn' });
        return;
      case 'chat':
        this.chat(session, player, msg.text, now);
        return;
    }
  }

  private async join(session: Session, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    if (session.state !== 'connected') {
      this.violation(session, 'Already joined.');
      return;
    }
    if (msg.v !== PROTOCOL_VERSION) {
      this.reject(session, `This page is out of date. Refresh to update (server protocol v${PROTOCOL_VERSION}).`, CloseCode.Rejected);
      return;
    }
    if (this.byPlayer.size >= this.deps.options.maxPlayers) {
      this.reject(session, 'The realm is full right now. Try again in a few minutes.', CloseCode.ServerFull);
      return;
    }
    session.state = 'joining';
    const accountId = this.deps.hashToken(msg.token);
    const existing = this.byAccount.get(accountId);
    if (existing) await this.evict(existing, 'You signed in from another window.');

    let stored: PlayerRecord | null;
    try {
      stored = await this.deps.repository.load(accountId);
    } catch (err) {
      this.deps.logger.error('failed to load player', { account: accountId.slice(0, 8), error: describe(err) });
      this.reject(session, 'Your hero could not be loaded. Please try again.', CloseCode.Rejected);
      return;
    }
    // The socket may have closed, or another window may have joined, while we were loading.
    if (session.state !== 'joining') return;
    if (this.byAccount.has(accountId)) {
      this.reject(session, 'That hero is already in the realm.', CloseCode.SignedInElsewhere);
      return;
    }

    const now = this.deps.time.iso();
    const record: PlayerRecord = stored ? { ...stored, name: msg.name, updatedAt: now } : newPlayerRecord(accountId, msg.name, now);
    const player = this.deps.world.spawnPlayer(accountId, lookForAccount(accountId), progressFromRecord(record));
    session.player = player;
    session.record = record;
    session.state = 'playing';
    this.byAccount.set(accountId, session);
    this.byPlayer.set(player.id, session);

    const { options, world } = this.deps;
    this.send(session, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      you: player.id,
      seed: world.seed,
      tickRate: options.tickRate,
      look: player.look,
      progress: cloneProgress(player.progress),
      day: world.timeOfDay,
      dayLength: options.dayLengthSeconds,
    });
    player.progressDirty = false;
    this.broadcastSystem(`${player.name} entered the realm.`, session);
    this.deps.logger.info('player joined', { player: player.id, account: accountId.slice(0, 8), name: player.name, online: this.byPlayer.size });
  }

  private chat(session: Session, player: Player, text: string, now: number): void {
    if (!session.chatBudget.tryTake(now)) {
      this.send(session, { t: 'error', reason: 'Slow down a little before chatting again.' });
      return;
    }
    const msg: ServerMessage = { t: 'chat', from: player.name, text };
    for (const other of this.byPlayer.values()) this.send(other, msg);
    this.deps.logger.debug('chat', { player: player.id, length: text.length });
  }

  // ------------------------------------------------------------------ helpers

  private routeEvents(events: readonly RoutedEvent[]): void {
    const world = this.deps.world;
    const radius = this.deps.options.interestRadius;
    for (const routed of events) {
      if (routed.scope === 'player') {
        const session = this.byPlayer.get(routed.playerId);
        if (session) this.queueEvent(session, routed.event);
        continue;
      }
      for (const p of world.playersNear(routed.x, routed.z, radius)) {
        const session = this.byPlayer.get(p.id);
        if (session) this.queueEvent(session, routed.event);
      }
    }
  }

  private queueEvent(session: Session, event: GameEvent): void {
    if (session.events.length < MAX_PENDING_EVENTS) session.events.push(event);
  }

  private async leave(session: Session, announce: boolean): Promise<void> {
    const player = session.player;
    if (!player) return;
    session.player = null;
    this.byPlayer.delete(player.id);
    this.snapshots.forget(player.id);
    if (this.byAccount.get(player.accountId) === session) this.byAccount.delete(player.accountId);
    this.deps.world.removePlayer(player.id);
    if (announce) this.broadcastSystem(`${player.name} left the realm.`);
    await this.persist(session, player);
    this.deps.logger.info('player left', { player: player.id, name: player.name, online: this.byPlayer.size });
  }

  private async evict(session: Session, reason: string): Promise<void> {
    this.sessions.delete(session.link.id);
    const wasPlaying = session.state === 'playing';
    session.state = 'closed';
    session.link.close(CloseCode.SignedInElsewhere, reason);
    if (wasPlaying) await this.leave(session, false);
  }

  private async persist(session: Session, player: Player): Promise<void> {
    if (!session.record) return;
    const record = recordFromPlayer(session.record, player, this.deps.time.iso());
    session.record = record;
    try {
      await this.deps.repository.save(record);
    } catch (err) {
      this.deps.logger.error('failed to save player', { player: player.id, error: describe(err) });
    }
  }

  private reject(session: Session, reason: string, code: number): void {
    this.send(session, { t: 'reject', reason });
    this.sessions.delete(session.link.id);
    session.state = 'closed';
    session.link.close(code, reason);
  }

  private violation(session: Session, reason: string): void {
    session.violations += 1;
    if (session.violations <= 5 || session.violations % 10 === 0) this.send(session, { t: 'error', reason });
    if (session.violations > MAX_VIOLATIONS) {
      this.deps.logger.warn('closing misbehaving connection', { link: session.link.id, remote: session.link.remoteAddress, reason });
      void this.disconnect(session.link);
      session.link.close(CloseCode.ProtocolViolation, 'Too many invalid messages.');
    }
  }

  private broadcastSystem(text: string, except?: Session): void {
    for (const session of this.byPlayer.values()) {
      if (session !== except) this.send(session, { t: 'system', text });
    }
  }

  private send(session: Session, msg: ServerMessage): void {
    if (session.state === 'closed') return;
    try {
      session.link.send(encodeMessage(msg));
    } catch (err) {
      this.deps.logger.warn('send failed', { link: session.link.id, error: describe(err) });
    }
  }
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));
