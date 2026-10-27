import { sanitizeName } from '@lanternwood/shared';
import { byId } from './dom';

/** The start card: hero name, enter button and connection status. */
export class TitleScreen {
  private readonly form = byId<HTMLFormElement>('startForm');
  private readonly name = byId<HTMLInputElement>('nameInput');
  private readonly enter = byId<HTMLButtonElement>('enterBtn');
  private readonly status = byId('startStatus');
  private readonly logo = byId('logo');
  private handler: ((name: string) => void) | null = null;
  private ready = false;
  private busy = false;

  constructor(initialName: string) {
    this.name.value = initialName;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.ready || this.busy) return;
      const name = sanitizeName(this.name.value);
      if (!name) {
        this.showError('Pick a name with 2–14 letters or numbers.');
        return;
      }
      this.name.value = name;
      this.handler?.(name);
    });
    const animate = (): void => this.logo.classList.add('go');
    if (document.fonts?.ready) void document.fonts.ready.then(animate, animate);
    window.setTimeout(animate, 1200);
  }

  onEnter(handler: (name: string) => void): void {
    this.handler = handler;
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
