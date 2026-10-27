export const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp((v - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wraps an angle to the range [-PI, PI). */
export function wrapAngle(a: number): number {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/** Interpolates between two angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export const distance2d = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);
