import { CLASSES, CLASS_IDS, RESOURCES, sanitizeName, type ClassId } from '@lanternwood/shared';
import { ROLE_NAMES } from './class-panel';
import { byId, el, setText } from './dom';

/** The start card: hero name, class, enter button and connection status. */
export class TitleScreen {
  private readonly form = byId<HTMLFormElement>('startForm');
  private readonly name = byId<HTMLInputElement>('nameInput');
  private readonly enter = byId<HTMLButtonElement>('enterBtn');
  private readonly status = byId('startStatus');
  private readonly logo = byId('logo');
  private readonly picker = byId('classPick');
  private readonly about = byId('classAbout');
  private handler: ((name: string, cls: ClassId) => void) | null = null;
  private ready = false;
  private busy = false;
  private cls: ClassId;

  constructor(initialName: string, initialClass: ClassId) {
    this.name.value = initialName;
    this.cls = initialClass;
    for (const id of CLASS_IDS) {
      const def = CLASSES[id];
      const b = el('button', 'cls-opt');
      b.type = 'button';
      b.dataset.cls = id;
      b.style.setProperty('--cls', def.color);
      b.append(el('b', undefined, def.name), el('span', undefined, ROLE_NAMES[def.role]));
      b.addEventListener('click', () => this.pick(id));
      this.picker.append(b);
    }
    this.pick(initialClass);
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.ready || this.busy) return;
      const name = sanitizeName(this.name.value);
      if (!name) {
        this.showError('Pick a name with 2–14 letters or numbers.');
        return;
      }
      this.name.value = name;
      this.handler?.(name, this.cls);
    });
    const animate = (): void => this.logo.classList.add('go');
    if (document.fonts?.ready) void document.fonts.ready.then(animate, animate);
    window.setTimeout(animate, 1200);
  }

  onEnter(handler: (name: string, cls: ClassId) => void): void {
    this.handler = handler;
  }

  private pick(cls: ClassId): void {
    this.cls = cls;
    for (const b of this.picker.querySelectorAll<HTMLButtonElement>('.cls-opt')) b.setAttribute('aria-pressed', String(b.dataset.cls === cls));
    const def = CLASSES[cls];
    setText(this.about, `${def.fantasy} ${ROLE_NAMES[def.role]} · ${def.primary} · ${RESOURCES[def.resource.kind].name}. You can change class in Emberhold any time.`);
  }

  setLoading(fraction: number): void {
    this.ready = false;
    this.enter.disabled = true;
    this.enter.textContent = `Raising the realm… ${Math.round(fraction * 100)}%`;
  }

  setReady(): void {
    this.ready = true;
    this.setBusy(false);
  }

  setBusy(busy: boolean, message = ''): void {
    this.busy = busy;
    this.enter.disabled = busy || !this.ready;
    this.enter.textContent = busy ? 'Connecting…' : 'Enter the realm';
    this.status.classList.remove('error');
    this.status.textContent = message;
  }

  showError(message: string): void {
    this.setBusy(false);
    this.status.classList.add('error');
    this.status.textContent = message;
  }
}
