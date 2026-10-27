const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable);

/** Tracks held keys and reports presses. Ignores keys typed into text fields. */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly listeners: ((key: string, event: KeyboardEvent) => void)[] = [];
  enabled = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (!e.repeat) for (const l of this.listeners) l(key, e);
      this.held.add(key);
    });
    target.addEventListener('keyup', (e) => this.held.delete(e.key.toLowerCase()));
    target.addEventListener('blur', () => this.held.clear());
  }

  isDown(...keys: string[]): boolean {
    return keys.some((k) => this.held.has(k));
  }

  onPress(listener: (key: string, event: KeyboardEvent) => void): void {
    this.listeners.push(listener);
  }

  release(key: string): void {
    this.held.delete(key);
  }

  clear(): void {
    this.held.clear();
  }
}
