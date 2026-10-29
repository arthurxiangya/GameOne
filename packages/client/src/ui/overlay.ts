import { el } from './dom';

export type PlateKind = 'foe' | 'boss' | 'npc' | 'ally';

interface Plate {
  readonly root: HTMLDivElement;
  readonly mark: HTMLSpanElement;
  readonly fill: HTMLElement;
  sub: HTMLSpanElement | null;
  shown: boolean;
  hpWidth: number;
  hpVisible: boolean;
  markText: string;
  targeted: boolean;
}

export interface PlateUpdate {
  readonly visible: boolean;
  /** Health fraction to show, or null to hide the bar. */
  readonly health: number | null;
  readonly targeted?: boolean;
  readonly mark?: string;
}

type Project = (x: number, y: number, z: number) => [number, number] | null;

/** HTML nameplates and floating combat text drawn over the 3D view. */
export class Overlay {
  private readonly plates = new Map<string, Plate>();

  constructor(private readonly root: HTMLElement, private readonly project: Project) {}

  ensurePlate(key: string, kind: PlateKind, name: string, level?: number): void {
    if (this.plates.has(key)) return;
    const root = el('div', `np ${kind === 'boss' ? 'foe boss' : kind}`);
    const mark = el('span', 'mark');
    const nameEl = el('span', 'nm', name);
    if (level !== undefined) nameEl.append(el('span', 'lv', ` Lv ${level}`));
    const bar = el('span', 'hpb');
    const fill = el('i');
    bar.append(fill);
    root.append(mark, nameEl, bar);
    this.root.append(root);
    this.plates.set(key, { root, mark, fill, sub: null, shown: false, hpWidth: -1, hpVisible: false, markText: '', targeted: false });
  }

  /** A small second line under the name, such as a hero's title; empty to hide it. */
  setSub(key: string, text: string): void {
    const plate = this.plates.get(key);
    if (!plate) return;
    if (!plate.sub) {
      if (!text) return;
      plate.sub = el('span', 'sub');
      plate.root.querySelector('.nm')?.after(plate.sub);
    }
    if (plate.sub.textContent !== text) plate.sub.textContent = text;
    plate.sub.hidden = !text;
  }

  removePlate(key: string): void {
    this.plates.get(key)?.root.remove();
    this.plates.delete(key);
  }

  place(key: string, x: number, y: number, z: number, update: PlateUpdate): void {
    const plate = this.plates.get(key);
    if (!plate) return;
    const screen = update.visible ? this.project(x, y, z) : null;
    const onScreen = screen !== null && screen[0] > -80 && screen[0] < window.innerWidth + 80 && screen[1] > -40 && screen[1] < window.innerHeight + 40;
    if (!onScreen) {
      if (plate.shown) {
        plate.root.style.display = 'none';
        plate.shown = false;
      }
      return;
    }
    if (!plate.shown) {
      plate.root.style.display = 'flex';
      plate.shown = true;
    }
    plate.root.style.transform = `translate3d(${screen[0].toFixed(1)}px, ${screen[1].toFixed(1)}px, 0) translate(-50%, -100%)`;

    const hpVisible = update.health !== null;
    if (hpVisible !== plate.hpVisible) {
      plate.hpVisible = hpVisible;
      plate.root.classList.toggle('hpv', hpVisible);
    }
    if (update.health !== null) {
      const width = Math.round(Math.max(0, Math.min(1, update.health)) * 100);
      if (width !== plate.hpWidth) {
        plate.hpWidth = width;
        plate.fill.style.transform = `scaleX(${width / 100})`;
      }
    }
    const targeted = update.targeted ?? false;
    if (targeted !== plate.targeted) {
      plate.targeted = targeted;
      plate.root.classList.toggle('tgt', targeted);
    }
    const mark = update.mark ?? '';
    if (mark !== plate.markText) {
      plate.markText = mark;
      plate.mark.textContent = mark;
    }
  }

  floatText(x: number, y: number, z: number, text: string, className = ''): void {
    if (this.root.childElementCount > 160) return;
    const screen = this.project(x, y, z);
    if (!screen) return;
    const node = el('span', `dmg ${className}`, text);
    node.style.left = `${(screen[0] + (Math.random() - 0.5) * 26).toFixed(1)}px`;
    node.style.top = `${screen[1].toFixed(1)}px`;
    this.root.append(node);
    const remove = (): void => node.remove();
    node.addEventListener('animationend', remove);
    window.setTimeout(remove, 1400);
  }

  clear(): void {
    for (const key of [...this.plates.keys()]) this.removePlate(key);
  }
}
