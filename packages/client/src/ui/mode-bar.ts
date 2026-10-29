import { formatRaceTime, type ModeState } from '@lanternwood/shared';
import { byId, setText } from './dom';

/** The bar at the top of the screen while a hero is in a mode: the run timer and the next checkpoint. */
export class ModeBar {
  private readonly root = byId('modebar');
  private readonly title = byId('mbTitle');
  private readonly main = byId('mbMain');
  private readonly sub = byId('mbSub');
  private readonly arrow = byId('mbArrow');
  private lastCount = -1;

  constructor(quit: () => void) {
    byId('mbQuit').addEventListener('click', quit);
  }

  /**
   * `serverNow` is the current server simulation time; `bearing` is the screen angle to the next
   * point (0 = straight ahead), or null. Returns a countdown number when it changes, for a banner.
   */
  update(state: ModeState | null, serverNow: number, bearing: number | null): number | null {
    this.root.hidden = state === null;
    document.body.classList.toggle('in-mode', state !== null);
    if (!state) {
      this.lastCount = -1;
      return null;
    }
    setText(this.title, 'Ember Run');
    let count: number | null = null;
    if (state.phase === 'countdown') {
      const left = Math.max(0, Math.ceil(state.startsAt - serverNow));
      setText(this.main, left > 0 ? String(left) : 'Go!');
      setText(this.sub, 'Get ready');
      if (left !== this.lastCount) count = left;
      this.lastCount = left;
    } else {
      setText(this.main, formatRaceTime(serverNow - state.startsAt));
      const finish = state.next > state.total;
      setText(this.sub, finish ? 'Back to the start line!' : `Checkpoint ${state.next} of ${state.total}`);
      if (this.lastCount !== 0) count = 0;
      this.lastCount = 0;
    }
    this.arrow.hidden = bearing === null;
    if (bearing !== null) this.arrow.style.transform = `rotate(${bearing.toFixed(3)}rad)`;
    return count;
  }
}
