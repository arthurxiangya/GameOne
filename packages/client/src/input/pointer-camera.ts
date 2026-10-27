export interface PointerCameraHandlers {
  /** One-finger or mouse drag, in pixels. */
  drag(dx: number, dy: number): void;
  /** Pinch or wheel; > 1 means zoom out. */
  zoom(factor: number): void;
  /** Short press that did not move: pick whatever is under (x, y). */
  tap(clientX: number, clientY: number): void;
}

const TAP_MAX_MOVE = 10;
const TAP_MAX_MS = 400;

/** Turns pointer gestures on the 3D canvas into camera control and tap-to-target. */
export class PointerCamera {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchStart = 0;
  private tap: { x: number; y: number; at: number; moved: number } | null = null;

  constructor(canvas: HTMLElement, private readonly handlers: PointerCameraHandlers) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety; gestures still work without it.
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.tap = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY, at: performance.now(), moved: 0 } : null;
      if (this.pointers.size === 2) this.pinchStart = this.pinchDistance();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.tap) this.tap.moved += Math.abs(dx) + Math.abs(dy);
      if (this.pointers.size === 1) this.handlers.drag(dx, dy);
      else if (this.pointers.size === 2 && this.pinchStart > 0) {
        const d = Math.max(1, this.pinchDistance());
        this.handlers.zoom(this.pinchStart / d);
        this.pinchStart = d;
      }
    });
    const end = (e: PointerEvent): void => {
      if (e.type === 'pointerup' && this.tap && this.tap.moved < TAP_MAX_MOVE && performance.now() - this.tap.at < TAP_MAX_MS) {
        this.handlers.tap(e.clientX, e.clientY);
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchStart = 0;
      this.tap = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.handlers.zoom(Math.exp(e.deltaY * 0.0012));
      },
      { passive: false },
    );
  }

  get dragging(): boolean {
    return this.pointers.size > 0;
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
