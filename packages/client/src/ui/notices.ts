import { byId } from './dom';

/** Transient toasts and the big zone/level banner. */
export class Notices {
  private readonly toastEl = byId('toast');
  private readonly bannerEl = byId('banner');
  private readonly bannerName = byId('bannerName');
  private readonly bannerSub = byId('bannerSub');
  private toastTimer = 0;

  toast(message: string, seconds = 2.6): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), seconds * 1000);
  }

  banner(name: string, subtitle: string): void {
    this.bannerName.textContent = name;
    this.bannerSub.textContent = subtitle;
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth; // restart the CSS animation
    this.bannerEl.classList.add('show');
  }
}
