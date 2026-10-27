const DEAD_ZONE = 0.12;

/** On-screen thumbstick. `x` is right, `y` is forward, both in [-1, 1]. */
export class Joystick {
  x = 0;
  y = 0;
  private pointerId: number | null = null;

  constructor(
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
  ) {
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pointerId = e.pointerId;
      try {
        base.setPointerCapture(e.pointerId);
      } catch {
        // Older browsers may refuse capture; tracking still works while the finger stays on the stick.
      }
      this.move(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.pointerId) this.move(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointerId) return;
      this.release();
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
    base.addEventListener('lostpointercapture', end);
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  release(): void {
    this.pointerId = null;
    this.x = this.y = 0;
    this.knob.style.transform = '';
  }

  private move(e: PointerEvent): void {
    const r = this.base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2 - 12;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const nx = dx / max;
    const ny = -dy / max;
    const mag = Math.hypot(nx, ny);
    this.x = mag < DEAD_ZONE ? 0 : nx;
    this.y = mag < DEAD_ZONE ? 0 : ny;
  }
}
