import { CHAT_MAX_LENGTH, sanitizeChat, type LogClass } from '@lanternwood/shared';
import { byId, el } from './dom';

const MAX_LINES = 6;

/** The scrolling message log plus the chat input. All text is inserted as text, never HTML. */
export class ChatPanel {
  private readonly log = byId('log');
  private readonly form = byId<HTMLFormElement>('chatForm');
  private readonly input = byId<HTMLInputElement>('chatInput');
  private sendHandler: ((text: string) => void) | null = null;

  constructor() {
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = sanitizeChat(this.input.value);
      if (text) this.sendHandler?.(text);
      this.input.value = '';
      this.close();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  onSend(handler: (text: string) => void): void {
    this.sendHandler = handler;
  }

  get isOpen(): boolean {
    return !this.form.hidden;
  }

  open(): void {
    this.form.hidden = false;
    this.log.classList.add('open');
    this.input.focus();
  }

  close(): void {
    this.form.hidden = true;
    this.log.classList.remove('open');
    this.input.blur();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  system(text: string, cls: LogClass | 'chat' = 'sys'): void {
    this.append(el('p', cls, text));
  }

  chat(from: string, text: string): void {
    const line = el('p', 'chat');
    line.append(el('b', undefined, `${from}: `), document.createTextNode(text));
    this.append(line);
  }

  clear(): void {
    this.log.replaceChildren();
  }

  private append(line: HTMLElement): void {
    this.log.append(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
  }
}
