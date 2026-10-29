import { formatRaceTime, type ModeState, type SiegeState } from '@lanternwood/shared';

type RaceState = Extract<ModeState, { kind: 'race' }>;
type RiftState = Extract<ModeState, { kind: 'rift' }>;
import { byId, setText } from './dom';

/**
 * The bar at the top of the screen while something is on: an Ember Run (timer, next checkpoint,
 * give up), a Rift Trial (wave, monsters left, time left, score) or Lantern Night (wave, Gloom
 * left, the Lantern's health). The hero's own mode takes precedence over the siege.
 */
export class ModeBar {
  private readonly root = byId('modebar');
  private readonly title = byId('mbTitle');
  private readonly main = byId('mbMain');
  private readonly sub = byId('mbSub');
  private readonly arrow = byId('mbArrow');
  private readonly quit = byId('mbQuit');
  private readonly meter = byId('mbMeter');
  private readonly fill = byId('mbFill');
  private lastCount = -1;

  constructor(quit: () => void) {
    this.quit.addEventListener('click', quit);
  }

  /**
   * `serverNow` is the current server simulation time; `bearing` is the screen angle to where the
   * hero should head (0 = straight ahead), or null. Returns a countdown number when it changes.
   */
  update(mode: ModeState | null, siege: SiegeState | null, serverNow: number, bearing: number | null): number | null {
    const shown = mode !== null || siege !== null;
    this.root.hidden = !shown;
    document.body.classList.toggle('in-mode', shown);
    this.arrow.hidden = bearing === null;
    if (bearing !== null) this.arrow.style.transform = `rotate(${bearing.toFixed(3)}rad)`;
    if (mode?.kind === 'race') return this.showRace(mode, serverNow);
    this.lastCount = -1;
    if (mode?.kind === 'rift') this.showRift(mode, serverNow);
    else if (siege) this.showSiege(siege, serverNow);
    return null;
  }

  private showRift(s: RiftState, serverNow: number): void {
    setText(this.title, 'Rift Trial');
    this.quit.hidden = s.phase === 'done' || s.phase === 'failed';
    setText(this.quit, s.phase === 'gathering' ? 'Cancel' : 'Leave the rift');
    this.meter.hidden = true;
    const left = Math.max(0, Math.ceil(s.endsAt - serverNow));
    const clock = s.deadline > 0 ? formatRaceTime(Math.max(0, s.deadline - serverNow)).replace(/\.\d$/, '') : '';
    switch (s.phase) {
      case 'gathering':
        setText(this.main, `${left}s`);
        setText(this.sub, 'Heroes in the stone circle come with you');
        break;
      case 'starting':
        setText(this.main, 'Get ready');
        setText(this.sub, `${s.party.join(', ')} · ${clock} on the clock`);
        break;
      case 'wave':
        setText(this.main, s.wave === s.waves ? 'The Rift Lord' : `Wave ${s.wave} of ${s.waves}`);
        setText(this.sub, `${s.remaining} left · ${clock} on the clock`);
        break;
      case 'break':
        setText(this.main, `Wave ${s.wave + 1} of ${s.waves}`);
        setText(this.sub, `in ${left}s · ${clock} on the clock`);
        break;
      case 'done':
      case 'failed':
        setText(this.main, `${s.score.toLocaleString('en-US')} points`);
        setText(this.sub, s.phase === 'done' ? 'The Rift Lord falls · back to Emberhold' : 'The rift closes · back to Emberhold');
        break;
    }
  }

  private showRace(state: RaceState, serverNow: number): number | null {
    setText(this.title, 'Ember Run');
    this.quit.hidden = false;
    setText(this.quit, 'Give up');
    this.meter.hidden = true;
    let count: number | null = null;
    if (state.phase === 'countdown') {
      const left = Math.max(0, Math.ceil(state.startsAt - serverNow));
      setText(this.main, left > 0 ? String(left) : 'Go!');
      setText(this.sub, 'Get ready');
      if (left !== this.lastCount) count = left;
      this.lastCount = left;
    } else {
      setText(this.main, formatRaceTime(serverNow - state.startsAt));
      setText(this.sub, state.next > state.total ? 'Back to the start line!' : `Checkpoint ${state.next} of ${state.total}`);
      if (this.lastCount !== 0) count = 0;
      this.lastCount = 0;
    }
    return count;
  }

  private showSiege(s: SiegeState, serverNow: number): void {
    setText(this.title, 'Lantern Night');
    this.quit.hidden = true;
    this.meter.hidden = s.phase === 'won' || s.phase === 'lost';
    this.fill.style.transform = `scaleX(${(Math.max(0, s.lantern) / Math.max(1, s.lanternMax)).toFixed(3)})`;
    const left = Math.max(0, Math.ceil(s.endsAt - serverNow));
    switch (s.phase) {
      case 'warning':
        setText(this.main, `0:${String(left).padStart(2, '0')}`);
        setText(this.sub, 'The Gloom is coming · defend the fountain');
        break;
      case 'wave':
        setText(this.main, s.wave === s.waves ? 'The Gloom Knight' : `Wave ${s.wave} of ${s.waves}`);
        setText(this.sub, `${s.remaining} of the Gloom left${s.endsAt > 0 ? ` · ${left}s` : ''}`);
        break;
      case 'break':
        setText(this.main, `Wave ${s.wave + 1} of ${s.waves}`);
        setText(this.sub, `in ${left}s`);
        break;
      case 'won':
        setText(this.main, 'The Lantern holds');
        setText(this.sub, 'Emberhold is safe');
        break;
      case 'lost':
        setText(this.main, 'The Lantern is dark');
        setText(this.sub, 'until dawn');
        break;
    }
  }
}
