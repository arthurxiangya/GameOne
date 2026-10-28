#!/usr/bin/env tsx
/**
 * Network probe and load generator for a Lanternwood Realms server.
 *
 *   tsx packages/server/scripts/net-probe.ts <ws-url> [--bots 2] [--seconds 30] [--annotate]
 *
 * Every bot joins as a guest and walks a repeating pattern (2 s walking, 1 s standing) while
 * sending 20 input frames per second, exactly like the browser client. The first two bots also
 * run the client's prediction and compare it with the server. Reported:
 *
 *   rtt              ping round trip
 *   snapshotGap      time between snapshots arriving
 *   inputAck         time from sending an input frame to a snapshot acknowledging it
 *                    (network + server input queue + waiting for the next snapshot)
 *   remoteDelay      time from bot 1 starting to walk until bot 2 sees it move
 *                    (what one player sees of another, before client-side interpolation)
 *   correction       how far the server's position was from the bot's own prediction
 *   download         bytes received per bot per second
 *   server loop      tick timing from /healthz, before and after the run
 */
import { performance } from 'node:perf_hooks';
import { WebSocket, type RawData } from 'ws';
import {
  PROTOCOL_VERSION,
  SIM_DT,
  createBody,
  decodeServerMessage,
  generateWorld,
  stepPlayer,
  type InputFrame,
  type PhysicsBody,
  type ServerMessage,
  type SnapshotMessage,
  type VoxelWorld,
} from '@lanternwood/shared';

interface Options {
  readonly url: string;
  readonly bots: number;
  readonly seconds: number;
  readonly annotate: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const url = argv.find((a) => /^wss?:\/\//.test(a));
  if (!url) throw new Error('usage: net-probe.ts <ws-url> [--bots N] [--seconds S] [--annotate]');
  const num = (flag: string, fallback: number): number => {
    const i = argv.indexOf(flag);
    const v = i >= 0 ? Number(argv[i + 1]) : fallback;
    if (!Number.isFinite(v) || v <= 0) throw new Error(`${flag} needs a positive number`);
    return v;
  };
  return { url, bots: Math.floor(num('--bots', 2)), seconds: num('--seconds', 30), annotate: argv.includes('--annotate') };
}

const now = (): number => performance.now();
const randomToken = (): string => Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

class Stats {
  private readonly values: number[] = [];
  add(v: number): void {
    if (Number.isFinite(v)) this.values.push(v);
  }
  get count(): number {
    return this.values.length;
  }
  pct(p: number): number {
    if (this.values.length === 0) return NaN;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  }
  max(): number {
    return this.values.length ? Math.max(...this.values) : NaN;
  }
  mean(): number {
    return this.values.length ? this.values.reduce((a, b) => a + b, 0) / this.values.length : NaN;
  }
  summary(digits = 0): Record<string, number> {
    const r = (v: number): number => Number(v.toFixed(digits));
    return { n: this.count, p50: r(this.pct(50)), p95: r(this.pct(95)), max: r(this.max()) };
  }
}

const results = {
  rtt: new Stats(),
  snapshotGap: new Stats(),
  inputAck: new Stats(),
  inputAckFirstHalf: new Stats(),
  inputAckSecondHalf: new Stats(),
  remoteDelay: new Stats(),
  correction: new Stats(),
  snapshotBytes: new Stats(),
  joinMs: new Stats(),
  errors: [] as string[],
};

let sharedWorld: VoxelWorld | null = null;
let runStart = 0;
let runEnd = 0;

/** Bot 1's walk start times, read by bot 2 to measure how late it sees the movement. */
const walkStarts: number[] = [];

class Bot {
  readonly name: string;
  private socket: WebSocket | null = null;
  private body: PhysicsBody | null = null;
  private pending: InputFrame[] = [];
  private readonly predicted = new Map<number, { x: number; y: number; z: number }>();
  private readonly sentAt = new Map<number, number>();
  private seq = 0;
  private acked = 0;
  private stepClock = 0;
  private lastSnapshotAt = 0;
  private walking = false;
  private bytes = 0;
  private joinedAt = 0;
  private openedAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  // Observer state (bot 2 watching bot 1)
  private watchedStart: { at: number; x: number; z: number } | null = null;
  private watchedIndex = 0;

  constructor(
    readonly index: number,
    private readonly options: Options,
  ) {
    this.name = `Probe ${index + 1}`;
  }

  get verifies(): boolean {
    return this.index < 2;
  }

  get downloadBytes(): number {
    return this.bytes;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      const socket = new WebSocket(this.options.url);
      this.socket = socket;
      this.openedAt = now();
      socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token: randomToken(), name: this.name })));
      socket.on('message', (data: RawData) => {
        const text = data.toString();
        if (now() >= runStart && now() <= runEnd) this.bytes += text.length;
        const msg = decodeServerMessage(text);
        if (msg) this.onMessage(msg, resolve);
      });
      socket.on('error', (err: Error) => {
        results.errors.push(`${this.name}: ${err.message}`);
        resolve();
      });
      socket.on('close', (code: number) => {
        if (now() < runEnd) results.errors.push(`${this.name}: closed early (${code})`);
        this.stop();
        resolve();
      });
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.timer = this.pingTimer = null;
    this.socket?.close();
  }

  private onMessage(msg: ServerMessage, joined: () => void): void {
    const t = now();
    switch (msg.t) {
      case 'welcome':
        if (this.verifies && !sharedWorld) sharedWorld = generateWorld(msg.seed).world;
        break;
      case 'snapshot':
        this.onSnapshot(msg, t, joined);
        break;
      case 'pong':
        if (t >= runStart) results.rtt.add(t - msg.at);
        break;
      case 'reject':
      case 'error':
        results.errors.push(`${this.name}: ${msg.reason}`);
        break;
    }
  }

  private onSnapshot(msg: SnapshotMessage, t: number, joined: () => void): void {
    if (!this.body) {
      this.body = createBody(msg.you.x, msg.you.y, msg.you.z);
      Object.assign(this.body, { vx: msg.you.vx, vy: msg.you.vy, vz: msg.you.vz, grounded: msg.you.g });
      this.joinedAt = t;
      results.joinMs.add(t - this.openedAt);
      this.stepClock = t;
      this.timer = setInterval(() => this.tick(), 16);
      this.pingTimer = setInterval(() => this.socket?.send(JSON.stringify({ t: 'ping', at: now() })), 500);
      joined();
      return;
    }
    const inRun = t >= runStart && t <= runEnd;
    if (inRun) {
      if (this.lastSnapshotAt) results.snapshotGap.add(t - this.lastSnapshotAt);
      results.snapshotBytes.add(JSON.stringify(msg).length);
    }
    this.lastSnapshotAt = t;

    // Input acknowledgement latency.
    for (let s = this.acked + 1; s <= msg.ack; s++) {
      const sent = this.sentAt.get(s);
      if (sent === undefined) continue;
      this.sentAt.delete(s);
      if (sent < runStart || !inRun) continue;
      const lag = t - sent;
      results.inputAck.add(lag);
      (sent < (runStart + runEnd) / 2 ? results.inputAckFirstHalf : results.inputAckSecondHalf).add(lag);
    }
    this.acked = Math.max(this.acked, msg.ack);

    // Prediction check, exactly as the client reconciles.
    if (this.verifies && sharedWorld) {
      const guess = this.predicted.get(msg.ack);
      if (guess && inRun) results.correction.add(Math.hypot(guess.x - msg.you.x, guess.y - msg.you.y, guess.z - msg.you.z));
      for (const k of this.predicted.keys()) if (k <= msg.ack) this.predicted.delete(k);
      this.pending = this.pending.filter((f) => f.seq > msg.ack);
      const body = this.body;
      Object.assign(body, { x: msg.you.x, y: msg.you.y, z: msg.you.z, vx: msg.you.vx, vy: msg.you.vy, vz: msg.you.vz, grounded: msg.you.g });
      for (const f of this.pending) {
        stepPlayer(sharedWorld, body, f, SIM_DT);
        this.predicted.set(f.seq, { x: body.x, y: body.y, z: body.z });
      }
    }

    // Bot 2 watches bot 1 and times how late it sees each walk start.
    if (this.index === 1) {
      const target = msg.ents.find((e) => e.k === 'p' && e.nm === 'Probe 1');
      if (!target) return;
      if (!this.watchedStart && this.watchedIndex < walkStarts.length) {
        this.watchedStart = { at: walkStarts[this.watchedIndex]!, x: target.x, z: target.z };
      }
      if (this.watchedStart && t > this.watchedStart.at) {
        if (Math.hypot(target.x - this.watchedStart.x, target.z - this.watchedStart.z) > 0.05) {
          if (this.watchedStart.at >= runStart) results.remoteDelay.add(t - this.watchedStart.at);
          this.watchedIndex++;
          this.watchedStart = null;
        }
      }
    }
  }

  /** Emits input frames on the real clock at 20 per second, batched like the browser does per frame. */
  private tick(): void {
    const t = now();
    const frames: InputFrame[] = [];
    while (t - this.stepClock >= SIM_DT * 1000 && frames.length < 5) {
      this.stepClock += SIM_DT * 1000;
      const phase = ((this.stepClock - this.joinedAt) / 1000 + this.index * 0.37) % 3;
      const walking = phase < 2;
      if (walking && !this.walking && this.index === 0) walkStarts.push(t);
      this.walking = walking;
      const frame: InputFrame = {
        seq: ++this.seq,
        fwd: walking ? 1 : 0,
        strafe: 0,
        yaw: ((this.stepClock - this.joinedAt) / 1000) * 0.6 + this.index,
        jump: false,
        swim: false,
      };
      frames.push(frame);
      this.sentAt.set(frame.seq, t);
      if (this.verifies && sharedWorld && this.body) {
        stepPlayer(sharedWorld, this.body, frame, SIM_DT);
        this.pending.push(frame);
        this.predicted.set(frame.seq, { x: this.body.x, y: this.body.y, z: this.body.z });
      }
    }
    if (t - this.stepClock > 1000) this.stepClock = t; // the host stalled; don't flood
    if (frames.length > 0 && this.socket?.readyState === this.socket?.OPEN) this.socket?.send(JSON.stringify({ t: 'input', frames }));
  }
}

async function health(url: string): Promise<Record<string, unknown> | null> {
  const http = url.replace(/^ws/, 'http').replace(/\/ws\/?$/, '/healthz');
  try {
    const res = await fetch(http);
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const before = await health(options.url);
  const bots = Array.from({ length: options.bots }, (_, i) => new Bot(i, options));
  // Join in small waves so a big run doesn't hit the server's connect path all at once.
  for (let i = 0; i < bots.length; i += 25) await Promise.all(bots.slice(i, i + 25).map((b) => b.start()));
  runStart = now() + 2000; // let everyone settle first
  runEnd = runStart + options.seconds * 1000;
  await new Promise((r) => setTimeout(r, runEnd - now() + 300));
  const after = await health(options.url);
  for (const b of bots) b.stop();

  const seconds = options.seconds;
  const download = bots.map((b) => b.downloadBytes / seconds);
  const report = {
    url: options.url,
    bots: options.bots,
    seconds,
    rttMs: results.rtt.summary(),
    snapshotGapMs: results.snapshotGap.summary(),
    inputAckMs: results.inputAck.summary(),
    inputAckTrendMs: { firstHalfP50: Math.round(results.inputAckFirstHalf.pct(50)), secondHalfP50: Math.round(results.inputAckSecondHalf.pct(50)) },
    remoteDelayMs: results.remoteDelay.summary(),
    correctionBlocks: results.correction.summary(3),
    snapshotBytes: results.snapshotBytes.summary(),
    downloadKBpsPerBot: Number((download.reduce((a, b) => a + b, 0) / download.length / 1024).toFixed(1)),
    joinMs: results.joinMs.summary(),
    serverBefore: before?.loop ?? null,
    serverAfter: after?.loop ?? null,
    errors: [...new Set(results.errors)].slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.annotate) {
    const line = (title: string, value: unknown): void => console.log(`::notice title=${title}::${JSON.stringify(value)}`);
    line('latency', { rttMs: report.rttMs, inputAckMs: report.inputAckMs, inputAckTrendMs: report.inputAckTrendMs });
    line('remote', { remoteDelayMs: report.remoteDelayMs, snapshotGapMs: report.snapshotGapMs });
    line('prediction', { correctionBlocks: report.correctionBlocks, joinMs: report.joinMs });
    line('bandwidth', { snapshotBytes: report.snapshotBytes, downloadKBpsPerBot: report.downloadKBpsPerBot, bots: report.bots });
    line('server', { before: report.serverBefore, after: report.serverAfter });
    if (report.errors.length) line('errors', report.errors);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
