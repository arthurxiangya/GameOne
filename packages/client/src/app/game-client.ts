import {
  MONSTERS,
  MOUNTS,
  MOUNT_CALL_SECONDS,
  NPC_INTERACT_RANGE,
  PROTOCOL_VERSION,
  SIM_DT,
  SKILLS,
  SKILL_IDS,
  TITLES,
  generateWorld,
  mountSpeed,
  zoneForBiome,
  type ChainId,
  type EntityState,
  type GameEvent,
  type GeneratedWorld,
  type InputFrame,
  type MoveIntent,
  type NpcDef,
  type PlayerProgress,
  type SelfState,
  type ServerMessage,
  type SkillId,
  type SnapshotMessage,
  type Vec3,
  type WelcomeMessage,
} from '@lanternwood/shared';
import { KeyboardInput } from '../input/keyboard';
import { Joystick } from '../input/joystick';
import { PointerCamera } from '../input/pointer-camera';
import type { Transport, TransportFactory } from '../net/transport';
import { CameraRig } from '../render/camera-rig';
import { CompanionViews } from '../render/companion-views';
import { Effects } from '../render/effects';
import { EntityViews } from '../render/entity-views';
import { FpsMeter, PerformanceGovernor } from '../render/performance-governor';
import { SceneContext } from '../render/scene-context';
import { SkySystem } from '../render/sky';
import { TerrainRenderer } from '../render/terrain';
import { ClockSync } from '../state/clock-sync';
import { EntityStore, type RemoteEntity } from '../state/entity-store';
import { LocalPlayer } from '../state/local-player';
import { ChatPanel } from '../ui/chat';
import { DialogView } from '../ui/dialog';
import { byId } from '../ui/dom';
import { Hud } from '../ui/hud';
import { JournalView } from '../ui/journal';
import { StableView } from '../ui/stable';
import { Minimap, type MapMarker } from '../ui/minimap';
import { Notices } from '../ui/notices';
import { Overlay } from '../ui/overlay';
import { bindSkillBar } from '../ui/skill-bar';
import { TitleScreen } from '../ui/title-screen';
import { npcMark, npcTopics, type TopicAction } from './conversations';
import { loadIdentity, rememberName, type Identity } from './identity';
import { defaultTracked, objectiveSpot, stillTrackable, trackerInfo } from './objectives';

export interface GameClientOptions {
  readonly createTransport: TransportFactory;
  /** Single-player preview: the server runs inside this page. */
  readonly offline: boolean;
  readonly lowPower: boolean;
  readonly reduceMotion: boolean;
}

type Phase = 'title' | 'connecting' | 'playing';

const DEFAULT_SEED = 2026;
const MAX_STEPS_PER_FRAME = 5;
const DRAW_DISTANCE_TITLE: [number, number] = [160, 320];
const PING_INTERVAL = 3;

const zeroCooldowns = (): Record<SkillId, number> =>
  Object.fromEntries(SKILL_IDS.map((id) => [id, 0])) as Record<SkillId, number>;

/**
 * Application controller. Owns the title → connecting → playing state machine, runs the
 * frame loop (fixed-step prediction, interpolation, rendering) and translates between
 * server messages, player input and the views.
 */
export class GameClient {
  private readonly ctx: SceneContext;
  private readonly sky: SkySystem;
  private readonly terrain: TerrainRenderer;
  private readonly views: EntityViews;
  private readonly companions: CompanionViews;
  private readonly effects: Effects;
  private readonly cameraRig: CameraRig;
  private readonly pointer: PointerCamera;
  private readonly overlay: Overlay;
  private readonly hud = new Hud();
  private readonly minimap: Minimap;
  private readonly notices = new Notices();
  private readonly chat = new ChatPanel();
  private readonly dialog = new DialogView();
  private readonly journal: JournalView;
  private readonly stable: StableView;
  private readonly title: TitleScreen;
  private readonly keyboard = new KeyboardInput();
  private readonly joystick: Joystick;
  private readonly connection: Transport;
  private readonly entities = new EntityStore();
  private readonly clock = new ClockSync();
  private readonly identity: Identity;
  private drawDistancePlay: [number, number];
  private readonly fpsMeter = new FpsMeter();
  private readonly governor: PerformanceGovernor;
  private renderDelay = 0.1;
  /** Longest frame since joining, in seconds: shows hitches such as shader compilation. */
  private longestFrame = 0;

  private generated: GeneratedWorld | null = null;
  private local: LocalPlayer | null = null;
  private phase: Phase = 'title';
  private titleReady = false;
  private playerName = '';
  private selfId = 0;
  private progress: PlayerProgress | null = null;
  private self: SelfState | null = null;
  private haveSnapshot = false;
  private cooldowns = zeroCooldowns();
  private timeOfDay = 0.33;
  private dayLength = 480;
  private targetId: number | null = null;
  private accumulator = 0;
  private jumpQueued = false;
  private jumpTouch = false;
  private strikeTouch = false;
  private lastStrike = 0;
  private hurt = 0;
  private zone = -1;
  private zoneTimer = 0;
  private pingTimer = 0;
  private questMark: { x: number; z: number } | null = null;
  private questTimer = 0;
  /** The story shown in the tracker and on the map; chosen in the journal or followed automatically. */
  private tracked: ChainId | null = null;
  /** Seconds left on the mount call bar, counted down locally between snapshots. */
  private callLeft = 0;
  private nearNpc: NpcDef | null = null;
  private frameCount = 0;
  private lastFrame = performance.now();
  private now = performance.now() / 1000;
  private rejectReason = '';
  private leaving = false;
  private readonly renderPos: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(private readonly options: GameClientOptions) {
    this.identity = loadIdentity();
    this.drawDistancePlay = options.lowPower ? [48, 125] : [70, 165];
    this.ctx = new SceneContext(byId('scene'), options.lowPower);
    this.ctx.setDrawDistance(...DRAW_DISTANCE_TITLE);
    this.sky = new SkySystem(this.ctx.scene, this.ctx.fog, options.lowPower);
    this.governor = new PerformanceGovernor([
      { name: 'sharpness', apply: () => this.ctx.setPixelRatio(1) },
      { name: 'shadows', apply: () => this.sky.disableShadows() },
      {
        name: 'draw distance',
        apply: () => {
          this.drawDistancePlay = [this.drawDistancePlay[0] * 0.75, this.drawDistancePlay[1] * 0.75];
          if (this.phase === 'playing') this.ctx.setDrawDistance(...this.drawDistancePlay);
        },
      },
    ]);
    this.terrain = new TerrainRenderer(this.ctx.scene, options.reduceMotion);
    this.views = new EntityViews(this.ctx.scene);
    this.companions = new CompanionViews(this.ctx.scene);
    this.effects = new Effects(this.ctx.scene);
    this.cameraRig = new CameraRig(this.ctx.camera);
    this.overlay = new Overlay(byId('overlay'), (x, y, z) => this.ctx.toScreen(x, y, z));
    this.minimap = new Minimap(byId<HTMLCanvasElement>('minimap'));
    this.title = new TitleScreen(this.identity.name);
    this.journal = new JournalView({
      track: (id) => this.track(id),
      title: (id) => this.connection.send({ t: 'title', title: id }),
    });
    this.stable = new StableView({
      chooseMount: (id) => this.connection.send({ t: 'choose', kind: 'mount', id }),
      choosePet: (id) => this.connection.send({ t: 'choose', kind: 'pet', id }),
      renamePet: (pet, name) => this.connection.send({ t: 'petName', pet, name }),
    });
    this.joystick = new Joystick(byId('stick'), byId('knob'));
    document.body.classList.toggle('offline', options.offline);
    this.connection = options.createTransport({
      open: () => this.onOpen(),
      message: (msg) => this.onMessage(msg),
      close: (code, reason) => this.onClose(code, reason),
    });
    this.pointer = new PointerCamera(this.ctx.canvas, {
      drag: (dx, dy) => {
        if (this.phase === 'playing') this.cameraRig.rotate(dx, dy);
      },
      zoom: (factor) => {
        if (this.phase === 'playing') this.cameraRig.zoom(factor);
      },
      tap: (x, y) => {
        if (this.phase === 'playing') this.pick(x, y);
      },
    });
    this.bindUi();
    this.loadWorld(DEFAULT_SEED);
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ setup

  private bindUi(): void {
    this.title.onEnter((name) => this.enter(name));
    this.chat.onSend((text) => this.connection.send({ t: 'chat', text }));
    bindSkillBar(byId('skills'), {
      skill: (id) => this.useSkill(id),
      strikeHeld: (held) => {
        this.strikeTouch = held;
      },
      jump: (held) => {
        this.jumpTouch = held;
        if (held) this.jumpQueued = true;
      },
    });
    this.keyboard.onPress((key, event) => {
      if ([' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'enter'].includes(key)) event.preventDefault();
      switch (key) {
        case ' ': this.jumpQueued = true; break;
        case '1': this.useSkill('strike'); break;
        case '2': this.useSkill('bolt'); break;
        case '3': this.useSkill('mend'); break;
        case '4': this.useSkill('ring'); break;
        case 'q': this.useSkill('tonic'); break;
        case 'e': if (this.nearNpc) this.openNpc(this.nearNpc); break;
        case 'j': this.toggleJournal(); break;
        case 'p': this.toggleStable(); break;
        case 'r': this.toggleMount(); break;
        case 'tab': this.cycleTarget(); break;
        case 'enter': if (!this.options.offline) { this.keyboard.clear(); this.chat.open(); } break;
        case 'escape': this.escape(); break;
      }
    });
    byId('chatBtn').addEventListener('click', () => this.chat.toggle());
    byId('menuBtn').addEventListener('click', () => {
      const menu = byId('menu');
      menu.hidden = !menu.hidden;
    });
    byId('resumeBtn').addEventListener('click', () => (byId('menu').hidden = true));
    byId('leaveBtn').addEventListener('click', () => this.leave());
    byId('reviveBtn').addEventListener('click', () => this.connection.send({ t: 'respawn' }));
    byId('tClear').addEventListener('click', () => this.setTarget(null));
    byId('talkBtn').addEventListener('click', () => {
      if (this.nearNpc) this.openNpc(this.nearNpc);
    });
    byId('journalBtn').addEventListener('click', () => this.toggleJournal());
    byId('stableBtn').addEventListener('click', () => this.toggleStable());
    byId('rideBtn').addEventListener('click', () => this.toggleMount());
    byId('questBox').addEventListener('click', () => this.toggleJournal());
    window.addEventListener('resize', () => this.minimap.resize());
  }

  /** Generates the realm locally; the server only sends the seed. */
  private loadWorld(seed: number): void {
    if (this.generated?.seed === seed) return;
    this.generated = generateWorld(seed);
    this.terrain.load(this.generated);
    this.views.spawnNpcs(this.generated.world, this.generated.npcs);
    this.minimap.paint(this.generated.world);
    if (this.local) this.local.setWorld(this.generated.world);
    else this.local = new LocalPlayer(this.generated.world);
  }

  // ------------------------------------------------------------------ session lifecycle

  private enter(name: string): void {
    this.playerName = name;
    rememberName(name);
    this.phase = 'connecting';
    this.rejectReason = '';
    this.leaving = false;
    this.title.setBusy(true, 'Connecting to the realm…');
    this.connection.open();
  }

  private onOpen(): void {
    this.connection.send({ t: 'hello', v: PROTOCOL_VERSION, token: this.identity.token, name: this.playerName });
  }

  private onClose(code: number, reason: string): void {
    const wasPlaying = this.phase === 'playing';
    this.toTitle();
    if (this.leaving) return;
    const fallback = wasPlaying
      ? 'The connection to the realm was lost. Your progress is saved; enter again to continue.'
      : 'Could not reach the realm server. Is it running?';
    this.title.showError(this.rejectReason || reason || fallback);
    if (code === 4409) this.chat.clear();
  }

  private leave(): void {
    this.leaving = true;
    byId('menu').hidden = true;
    this.connection.close();
    this.toTitle();
  }

  private toTitle(): void {
    this.phase = 'title';
    this.keyboard.enabled = false;
    this.keyboard.clear();
    document.body.classList.remove('playing');
    for (const e of this.entities.clear()) this.views.remove(e.id);
    this.views.remove(this.selfId);
    this.overlay.clear();
    this.dialog.close();
    this.journal.close();
    this.stable.close();
    this.companions.clear();
    this.chat.close();
    this.setTarget(null);
    for (const id of ['menu', 'death']) byId(id).hidden = true;
    this.ctx.setDrawDistance(...DRAW_DISTANCE_TITLE);
    this.clock.reset();
    this.self = null;
    this.progress = null;
    this.tracked = null;
    this.haveSnapshot = false;
    this.title.setBusy(false);
  }

  // ------------------------------------------------------------------ server messages

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': this.onWelcome(msg); break;
      case 'snapshot': this.onSnapshot(msg); break;
      case 'progress': this.onProgress(msg.p); break;
      case 'chat': this.chat.chat(msg.from, msg.text); break;
      case 'system': this.chat.system(msg.text, 'sys'); break;
      case 'error': this.notices.toast(msg.reason); break;
      case 'reject': this.rejectReason = msg.reason; break;
      case 'pong': this.hud.setPing((performance.now() - msg.at)); break;
    }
  }

  private onWelcome(msg: WelcomeMessage): void {
    this.loadWorld(msg.seed);
    this.selfId = msg.you;
    this.dayLength = msg.dayLength;
    this.timeOfDay = msg.day;
    this.haveSnapshot = false;
    this.longestFrame = 0;
    this.cooldowns = zeroCooldowns();
    this.views.addHero(msg.you, msg.look);
    if (this.generated && this.local) this.local.reset(this.generated.playerSpawn);
    this.phase = 'playing';
    this.zone = -1;
    this.cameraRig.yaw = 0;
    this.keyboard.enabled = true;
    this.ctx.setDrawDistance(...this.drawDistancePlay);
    document.body.classList.add('playing');
    this.chat.clear();
    this.chat.system(`Welcome to Lanternwood Realms, ${msg.progress.name}.`);
    this.onProgress(msg.progress);
    const main = msg.progress.story.main;
    if (main.step === 0 && main.state === 'available') {
      window.setTimeout(() => this.notices.toast('Elder Maren by the fountain has a quest for you. Look for the gold !', 4), 1600);
    }
  }

  private onSnapshot(msg: SnapshotMessage): void {
    const local = this.local;
    if (!local) return;
    // Stamp with when the message is handled, not the start of the current frame: at low frame
    // rates that would make every snapshot look up to a frame late.
    this.clock.observe(msg.st, performance.now() / 1000);
    this.timeOfDay = msg.day;
    this.self = msg.you;
    this.cooldowns = { ...msg.you.cd };
    local.landSpeed = mountSpeed(msg.you.mt);
    this.callLeft = msg.you.call;
    document.body.classList.toggle('riding', msg.you.mt !== null);
    if (!this.haveSnapshot) {
      local.reset(msg.you);
      this.haveSnapshot = true;
    } else {
      local.reconcile(msg.you, msg.ack);
    }
    this.hud.setVitals(msg.you);
    byId('death').hidden = !msg.you.dead;

    const { added, removed } = this.entities.apply(msg.ents, msg.gone, msg.st);
    for (const e of added) this.addEntityView(e);
    for (const e of removed) {
      this.views.remove(e.id);
      this.companions.remove(e.id);
      this.overlay.removePlate(`e${e.id}`);
      if (this.targetId === e.id) this.setTarget(null);
    }
    for (const ev of msg.ev) this.onEvent(ev);
  }

  private onProgress(p: PlayerProgress): void {
    const before = this.progress;
    this.progress = p;
    this.hud.setProgress(p);
    // Follow whichever story just moved, unless the tracked one is still going.
    if (before) {
      for (const id of Object.keys(p.story) as ChainId[]) {
        const a = before.story[id];
        const b = p.story[id];
        if (a.step !== b.step || a.state !== b.state || a.progress !== b.progress) {
          if (stillTrackable(p, id)) this.tracked = id;
        }
      }
    }
    if (this.tracked === null || !stillTrackable(p, this.tracked)) this.tracked = defaultTracked(p);
    this.hud.setTracker(trackerInfo(p, this.tracked));
    this.questTimer = 0;
    const npc = this.dialog.npc;
    if (npc && this.dialog.isOpen) this.dialog.show(npc, npcTopics(npc, p, Date.now()), (a) => this.chooseTopic(npc, a), true);
    this.journal.refresh(p, this.tracked, Date.now());
    this.stable.refresh(p);
  }

  private toggleStable(): void {
    if (this.phase !== 'playing' || !this.progress) return;
    if (this.stable.isOpen) this.stable.close();
    else {
      this.dialog.close();
      this.journal.close();
      this.stable.open(this.progress);
    }
  }

  private toggleMount(): void {
    const self = this.self;
    if (this.phase !== 'playing' || !self || self.dead) return;
    const p = this.progress;
    if (!self.mt && self.call <= 0 && p && !p.mount) {
      this.notices.toast(p.mounts.length ? 'Choose a mount in the stable (P).' : 'No mount yet. Smith Oda sells the Meadow Strider at level 5.', 2.6);
      return;
    }
    this.connection.send({ t: 'mount', on: !self.mt && self.call <= 0 });
  }

  private track(id: ChainId): void {
    this.tracked = id;
    if (this.progress) this.hud.setTracker(trackerInfo(this.progress, id));
    this.questTimer = 0;
  }

  private toggleJournal(): void {
    if (this.phase !== 'playing' || !this.progress) return;
    if (this.journal.isOpen) this.journal.close();
    else {
      this.dialog.close();
      this.stable.close();
      this.journal.open(this.progress, this.tracked, Date.now());
    }
  }

  private onEvent(ev: GameEvent): void {
    switch (ev.e) {
      case 'dmg': {
        const at = this.chestOf(ev.id);
        if (at) this.overlay.floatText(at.x, at.y + 0.6, at.z, String(ev.amt), ev.id === this.selfId ? 'hurt' : ev.crit ? 'crit' : '');
        this.views.flash(ev.id);
        if (ev.id === this.selfId) this.hurt = 0.35;
        break;
      }
      case 'heal': {
        const at = this.chestOf(ev.id);
        if (at && ev.amt > 0) this.overlay.floatText(at.x, at.y + 0.8, at.z, `+${ev.amt}`, 'heal');
        if (at) this.effects.ringPulse({ x: at.x, y: at.y - 0.8, z: at.z }, 0x8fe6a0, 0.4, 1.7, 0.6);
        break;
      }
      case 'lvl': {
        const at = this.feetOf(ev.id);
        if (at) this.effects.levelUp(at);
        if (ev.id === this.selfId) this.notices.banner(`Level ${ev.lv}`, 'Health and mana restored');
        break;
      }
      case 'swing':
        if (ev.id !== this.selfId) this.views.swing(ev.id);
        break;
      case 'cast':
        if (ev.id !== this.selfId) this.views.cast(ev.id);
        break;
      case 'bolt':
        this.effects.bolt(() => this.chestOf(ev.from), () => this.chestOf(ev.to), ev.flight);
        break;
      case 'ring': {
        const at = this.feetOf(ev.id);
        if (at) {
          this.effects.ringPulse({ x: at.x, y: at.y + 0.15, z: at.z }, 0xff8a2a, 0.6, ev.r + 0.4, 0.45);
          this.effects.ringPulse({ x: at.x, y: at.y + 0.6, z: at.z }, 0xffc066, 0.4, ev.r, 0.55, 0.6);
        }
        break;
      }
      case 'slamWarn':
        this.effects.slamWarning(ev, ev.r, ev.delay);
        break;
      case 'slam':
        this.effects.ringPulse({ x: ev.x, y: ev.y + 0.12, z: ev.z }, 0xe8f6ff, 0.5, ev.r + 0.6, 0.5);
        if (Math.hypot(this.renderPos.x - ev.x, this.renderPos.z - ev.z) < 30) this.cameraRig.shake = 0.45;
        break;
      case 'xp':
        this.overlay.floatText(this.renderPos.x, this.renderPos.y + 2.3, this.renderPos.z, `+${ev.amt} XP`, 'xp');
        break;
      case 'target':
        this.setTarget(ev.id);
        break;
      case 'log':
        this.chat.system(ev.text, ev.c);
        break;
      case 'toast':
        this.notices.toast(ev.text);
        break;
      case 'respawned':
        if (ev.fell) this.notices.toast('You fell off the edge of the realm. Back to Emberhold!', 2.8);
        break;
      case 'story':
        this.notices.banner(ev.title, 'Complete');
        this.chat.system(`“${ev.text}”`, 'good');
        break;
      case 'banner':
        this.notices.banner(ev.title, ev.text);
        break;
      case 'die':
        if (this.targetId === ev.id) window.setTimeout(() => this.targetId === ev.id && this.setTarget(null), 500);
        break;
    }
  }

  // ------------------------------------------------------------------ player actions

  private useSkill(id: SkillId): void {
    const self = this.self;
    const progress = this.progress;
    if (this.phase !== 'playing' || !self || !progress || self.dead) return;
    const def = SKILLS[id];
    if (progress.level < def.unlockLevel) return this.notices.toast(`${def.name} unlocks at level ${def.unlockLevel}`, 1.6);
    if (this.cooldowns[id] > 0) return;
    if (def.mana > self.mp) return this.notices.toast('Not enough mana', 1.4);
    if (id === 'tonic' && progress.tonics <= 0) return this.notices.toast('No tonics left. Smith Oda sells them.', 2);
    this.connection.send({ t: 'skill', skill: id, target: this.targetId });
    this.cooldowns[id] = def.cooldown;
    this.lastStrike = this.now;
    if (id === 'strike') this.views.swing(this.selfId);
    else if (id !== 'tonic') this.views.cast(this.selfId);
  }

  private setTarget(id: number | null): void {
    this.targetId = id;
    this.hud.setTarget(id !== null ? this.entities.get(id)?.state ?? null : null);
  }

  private cycleTarget(): void {
    const near = [...this.entities.all()]
      .filter((e) => e.state.k === 'm' && e.state.st !== 'dead')
      .map((e) => ({ e, d: Math.hypot(e.pose.x - this.renderPos.x, e.pose.z - this.renderPos.z) }))
      .filter((x) => x.d < 26)
      .sort((a, b) => a.d - b.d);
    if (near.length === 0) return;
    const index = near.findIndex((x) => x.e.id === this.targetId);
    this.setTarget(near[(index + 1) % near.length]!.e.id);
  }

  private pick(clientX: number, clientY: number): void {
    const rect = this.ctx.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    let best: { kind: 'entity'; id: number } | { kind: 'npc'; npc: NpcDef } | null = null;
    let bestDistance = 48;
    for (const e of this.entities.all()) {
      const at = this.chestOf(e.id);
      const screen = at ? this.ctx.toScreen(at.x, at.y, at.z) : null;
      const d = screen ? Math.hypot(screen[0] - sx, screen[1] - sy) : Infinity;
      if (d < bestDistance) {
        bestDistance = d;
        best = { kind: 'entity', id: e.id };
      }
    }
    this.npcs.forEach((npc, i) => {
      const head = this.views.npcHead(i);
      const screen = head ? this.ctx.toScreen(head.x, head.y - 1, head.z) : null;
      const d = screen ? Math.hypot(screen[0] - sx, screen[1] - sy) : Infinity;
      if (d < bestDistance) {
        bestDistance = d;
        best = { kind: 'npc', npc };
      }
    });
    const picked = best as { kind: 'entity'; id: number } | { kind: 'npc'; npc: NpcDef } | null;
    if (!picked) return;
    if (picked.kind === 'entity') this.setTarget(picked.id);
    else if (Math.hypot(picked.npc.x - this.renderPos.x, picked.npc.z - this.renderPos.z) < NPC_INTERACT_RANGE) this.openNpc(picked.npc);
    else this.notices.toast(`Walk closer to talk to ${picked.npc.name}`, 1.8);
  }

  private get npcs(): readonly NpcDef[] {
    return this.generated?.npcs ?? [];
  }

  private openNpc(npc: NpcDef): void {
    if (!this.progress || this.self?.dead) return;
    this.journal.close();
    this.connection.send({ t: 'npc', npc: npc.id, action: 'greet', arg: null });
    this.dialog.show(npc, npcTopics(npc, this.progress, Date.now()), (a) => this.chooseTopic(npc, a));
  }

  private chooseTopic(npc: NpcDef, action: TopicAction): void {
    if (action.send) this.connection.send({ t: 'npc', npc: npc.id, action: action.send.action, arg: action.send.arg });
  }

  private escape(): void {
    const menu = byId('menu');
    if (!menu.hidden) menu.hidden = true;
    else if (this.dialog.isOpen) this.dialog.close();
    else if (this.journal.isOpen) this.journal.close();
    else if (this.stable.isOpen) this.stable.close();
    else this.setTarget(null);
  }

  // ------------------------------------------------------------------ frame loop

  private readonly frame = (ts: number): void => {
    requestAnimationFrame(this.frame);
    const raw = Math.max(0, (ts - this.lastFrame) / 1000);
    // Game time follows the real clock even at low frame rates (up to a quarter second per
    // frame), so a slow device plays at normal speed instead of in slow motion. Animations
    // use a tighter cap so one long hitch never makes models jump.
    const elapsed = Math.min(MAX_STEPS_PER_FRAME * SIM_DT, raw);
    const dt = Math.min(0.05, raw);
    this.lastFrame = ts;
    this.now = ts / 1000;
    this.frameCount++;

    if (!this.terrain.ready) {
      this.terrain.buildSome(this.options.lowPower ? 9 : 14, this.now);
      if (this.phase === 'title' && !this.titleReady) this.title.setLoading(this.terrain.progress);
    }
    if (this.terrain.ready && !this.titleReady) {
      this.titleReady = true;
      this.title.setReady();
    }

    if (this.phase === 'playing') {
      this.longestFrame = Math.max(this.longestFrame, raw);
      this.updatePlaying(dt, elapsed);
    }
    else {
      this.cameraRig.orbit(dt);
      this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
      this.views.updateNpcs(null, dt, this.now);
    }

    const focus = this.phase === 'playing' ? this.renderPos : { x: 0, y: 10, z: 0 };
    this.sky.update(this.timeOfDay, focus, this.ctx.camera, dt);
    this.terrain.update(this.now, dt, this.ctx.camera, this.ctx.fog.far, this.sky.night);
    this.effects.update(dt);
    this.ctx.render();
  };

  /** `dt` drives animation; `elapsed` is real time for prediction, cooldowns and the clock. */
  private updatePlaying(dt: number, elapsed: number): void {
    const local = this.local;
    const world = this.generated?.world;
    if (!local || !world) return;
    this.timeOfDay = (this.timeOfDay + elapsed / this.dayLength) % 1;
    for (const id of SKILL_IDS) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - elapsed);

    // Fixed-step prediction: every step is sent to the server with a sequence number.
    if (this.haveSnapshot) {
      const intent = this.readIntent();
      this.accumulator += elapsed;
      const frames: InputFrame[] = [];
      while (this.accumulator >= SIM_DT && frames.length < MAX_STEPS_PER_FRAME) {
        frames.push(local.step({ ...intent, jump: this.jumpQueued && !this.self?.dead }));
        this.jumpQueued = false;
        this.accumulator -= SIM_DT;
      }
      if (this.accumulator >= SIM_DT) this.accumulator = 0;
      if (frames.length > 0) this.connection.send({ t: 'input', frames });
      if (this.joystick.active && intent.fwd > 0.35 && !this.pointer.dragging) {
        this.cameraRig.ease(local.yaw + Math.PI, dt * 1.4 * intent.fwd);
      }
    }
    local.renderPosition(this.accumulator / SIM_DT, dt, this.renderPos);

    if ((this.strikeTouch || this.keyboard.isDown('1')) && this.cooldowns.strike <= 0 && this.now - this.lastStrike > 0.2) this.useSkill('strike');

    const dead = this.self?.dead ?? false;
    const lift = this.companions.update(this.selfId, { ...this.renderPos, yaw: local.yaw }, this.self?.mt ?? null, this.progress?.pet ?? null, dead, dt, this.now);
    this.views.update(this.selfId, { ...this.renderPos, y: this.renderPos.y + lift, yaw: local.yaw, dead, attacking: false, seated: lift > 0 }, dt, this.now);
    this.updateCallBar(elapsed);
    const lamp = this.views.heroLampPosition();
    if (lamp) this.sky.heroLight.position.set(lamp.x, lamp.y, lamp.z);
    this.sky.heroLight.intensity = 10 * this.sky.night;

    this.renderDelay = this.clock.renderDelay(elapsed);
    this.entities.interpolate(this.clock.serverNow(this.now) - this.renderDelay);
    if (this.fpsMeter.sample(elapsed)) this.hud.setFps(this.fpsMeter.fps);
    if (this.terrain.ready && this.governor.sample(elapsed) && this.governor.level === 1) {
      this.notices.toast('Lowered graphics quality to keep movement smooth', 2.6);
    }
    for (const e of this.entities.all()) this.updateEntity(e, dt);
    this.views.updateNpcs(this.renderPos, dt, this.now);
    this.updateNpcs();
    if (this.targetId !== null) this.hud.setTarget(this.entities.get(this.targetId)?.state ?? null);

    this.cameraRig.follow(this.renderPos, world, dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.hud.setHurt((this.hurt / 0.35) * 0.9);
    this.hud.setCooldowns(this.cooldowns);
    this.hud.setClock(this.timeOfDay);
    this.updateZone(dt, world);
    this.updatePing(dt);
    this.questTimer -= dt;
    if (this.questTimer <= 0) {
      this.questTimer = 0.3;
      this.questMark = this.computeQuestMark();
    }
    if (this.frameCount % 2 === 0) this.minimap.draw(world, this.renderPos, local.yaw, this.mapMarkers(), this.questMark);
  }

  private readIntent(): MoveIntent {
    const kb = this.keyboard;
    let strafe = this.joystick.x + (kb.isDown('d', 'arrowright') ? 1 : 0) - (kb.isDown('a', 'arrowleft') ? 1 : 0);
    let fwd = this.joystick.y + (kb.isDown('w', 'arrowup') ? 1 : 0) - (kb.isDown('s', 'arrowdown') ? 1 : 0);
    const len = Math.hypot(strafe, fwd);
    if (len > 1) {
      strafe /= len;
      fwd /= len;
    }
    if (this.self?.dead || this.chat.isOpen) fwd = strafe = 0;
    return { fwd, strafe, yaw: this.cameraRig.yaw, jump: false, swim: this.jumpTouch || kb.isDown(' ') };
  }

  private updateEntity(e: RemoteEntity, dt: number): void {
    const s = e.state;
    const dead = s.k === 'm' ? s.st === 'dead' : s.dead;
    const lift = s.k === 'p' ? this.companions.update(e.id, e.pose, s.mt, s.pet, dead, dt, this.now) : 0;
    this.views.update(e.id, { ...e.pose, y: e.pose.y + lift, dead, attacking: s.k === 'm' && s.st === 'attack', seated: lift > 0 }, dt, this.now);
    const distance = Math.hypot(e.pose.x - this.renderPos.x, e.pose.z - this.renderPos.z);
    const targeted = e.id === this.targetId;
    const boss = s.k === 'm' && MONSTERS[s.ty].boss;
    const visible = !dead && (distance < 26 || targeted || (boss && distance < 45));
    const head = this.views.headOf(e.id);
    if (!head) return;
    if (s.k === 'p') this.overlay.setSub(`e${e.id}`, s.ti ? TITLES[s.ti].name : '');
    this.overlay.place(`e${e.id}`, head.x, head.y + 0.25, head.z, {
      visible,
      health: s.hp < s.mhp || targeted ? s.hp / s.mhp : null,
      targeted,
    });
  }

  private addEntityView(e: RemoteEntity): void {
    const s = e.state;
    this.views.add(s);
    if (s.k === 'm') this.overlay.ensurePlate(`e${s.id}`, MONSTERS[s.ty].boss ? 'boss' : 'foe', MONSTERS[s.ty].name, s.lv);
    else this.overlay.ensurePlate(`e${s.id}`, 'ally', s.nm, s.lv);
  }

  private updateNpcs(): void {
    let nearest: NpcDef | null = null;
    let nearestDistance = NPC_INTERACT_RANGE - 0.5;
    this.npcs.forEach((npc, i) => {
      const d = Math.hypot(npc.x - this.renderPos.x, npc.z - this.renderPos.z);
      if (d < nearestDistance && !this.self?.dead) {
        nearestDistance = d;
        nearest = npc;
      }
      const head = this.views.npcHead(i);
      this.overlay.ensurePlate(`npc-${npc.id}`, 'npc', npc.name);
      const mark = this.progress ? npcMark(npc, this.progress) : '';
      if (head) this.overlay.place(`npc-${npc.id}`, head.x, head.y, head.z, { visible: d < 40 || (mark !== '' && d < 70), health: null, mark });
    });
    const found = nearest as NpcDef | null;
    this.nearNpc = found;
    const talk = byId('talkBtn');
    if (found && !this.dialog.isOpen) {
      const label = `Talk to ${found.name}`;
      if (talk.hidden || talk.textContent !== label) {
        talk.textContent = label;
        talk.hidden = false;
      }
    } else if (!talk.hidden) talk.hidden = true;
    const open = this.dialog.npc;
    if (open && Math.hypot(open.x - this.renderPos.x, open.z - this.renderPos.z) > 6) this.dialog.close();
  }

  private updateCallBar(elapsed: number): void {
    const bar = byId('castbar');
    this.callLeft = Math.max(0, this.callLeft - elapsed);
    const calling = this.callLeft > 0 && !this.self?.mt;
    if (bar.hidden !== !calling) bar.hidden = !calling;
    if (!calling) return;
    const mount = this.progress?.mount;
    const label = `Calling ${mount ? MOUNTS[mount].name : 'your mount'}…`;
    const text = byId('castText');
    if (text.textContent !== label) text.textContent = label;
    byId('castFill').style.transform = `scaleX(${(1 - this.callLeft / MOUNT_CALL_SECONDS).toFixed(3)})`;
  }

  private updateZone(dt: number, world: GeneratedWorld['world']): void {
    this.zoneTimer -= dt;
    if (this.zoneTimer > 0) return;
    this.zoneTimer = 0.5;
    const biome = world.biomeAt(this.renderPos.x, this.renderPos.z);
    const info = zoneForBiome(biome);
    if (!info || biome === this.zone) return;
    const first = this.zone === -1;
    this.zone = biome;
    this.notices.banner(info.name, info.levels);
    if (!first) this.chat.system(`Entering ${info.name}`, 'sys');
  }

  private updatePing(dt: number): void {
    this.pingTimer -= dt;
    if (this.pingTimer > 0) return;
    this.pingTimer = PING_INTERVAL;
    this.connection.send({ t: 'ping', at: performance.now() });
  }

  private computeQuestMark(): { x: number; z: number } | null {
    const p = this.progress;
    if (!p || !this.generated) return null;
    const live: { type: string; x: number; z: number }[] = [];
    for (const e of this.entities.all()) {
      if (e.state.k === 'm' && e.state.st !== 'dead') live.push({ type: e.state.ty, x: e.pose.x, z: e.pose.z });
    }
    return objectiveSpot(p, this.tracked, this.generated, live, this.renderPos);
  }

  private mapMarkers(): MapMarker[] {
    const markers: MapMarker[] = [];
    for (const e of this.entities.all()) {
      const s = e.state;
      if (s.k === 'm') {
        if (s.st !== 'dead') markers.push({ x: e.pose.x, z: e.pose.z, kind: MONSTERS[s.ty].boss ? 'boss' : 'foe' });
      } else markers.push({ x: e.pose.x, z: e.pose.z, kind: 'ally' });
    }
    for (const npc of this.npcs) markers.push({ x: npc.x, z: npc.z, kind: 'npc' });
    return markers;
  }

  // ------------------------------------------------------------------ positions

  private chestOf(id: number): Vec3 | null {
    if (id === this.selfId) return { x: this.renderPos.x, y: this.renderPos.y + 1, z: this.renderPos.z };
    return this.views.positionOf(id);
  }

  private feetOf(id: number): Vec3 | null {
    if (id === this.selfId) return { ...this.renderPos };
    return this.views.positionOf(id, 0);
  }

  /** Exposed for debugging in the browser console and for automated browser checks. */
  get debugState(): {
    phase: Phase;
    terrainReady: boolean;
    entities: number;
    pending: number;
    hp: number | null;
    position: { x: number; z: number };
    players: { name: string; x: number; z: number }[];
    target: EntityState | null;
    drawCalls: number;
    triangles: number;
    fps: number;
    quality: number;
    renderDelayMs: number;
    corrections: number;
    snaps: number;
    longestFrameMs: number;
  } {
    const stats = this.ctx.renderStats;
    const players: { name: string; x: number; z: number }[] = [];
    for (const e of this.entities.all()) if (e.state.k === 'p') players.push({ name: e.state.nm, x: e.pose.x, z: e.pose.z });
    return {
      phase: this.phase,
      terrainReady: this.terrain.ready,
      entities: [...this.entities.all()].length,
      pending: this.local?.unacknowledged ?? 0,
      hp: this.self?.hp ?? null,
      position: { x: this.renderPos.x, z: this.renderPos.z },
      players,
      target: this.targetId !== null ? this.entities.get(this.targetId)?.state ?? null : null,
      drawCalls: stats.calls,
      triangles: stats.triangles,
      fps: Math.round(this.fpsMeter.fps),
      quality: this.governor.level,
      renderDelayMs: Math.round(this.renderDelay * 1000),
      corrections: this.local?.corrections ?? 0,
      snaps: this.local?.snaps ?? 0,
      longestFrameMs: Math.round(this.longestFrame * 1000),
    };
  }
}
