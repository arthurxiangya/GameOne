import type { Vec3 } from '../math/vec';

/** Ember Run: a time trial around the island through checkpoints, on foot. */
export interface RaceCourse {
  /** Start and finish line, in Emberhold. */
  readonly start: Vec3;
  readonly checkpoints: readonly Vec3[];
}

export type Medal = 'gold' | 'silver' | 'bronze';

/** A runner passes a checkpoint within this many blocks horizontally... */
export const CHECKPOINT_RADIUS = 3;
/** ...and this many vertically. */
export const CHECKPOINT_HEIGHT = 5;
/** Seconds of countdown before the clock starts. Runners cannot move during it. */
export const RACE_COUNTDOWN = 3;
/** A run longer than this is abandoned. */
export const RACE_TIME_LIMIT = 600;

/** Every point a run passes through, in order: start, checkpoints, and the start again as the finish. */
export const coursePoints = (course: RaceCourse): readonly Vec3[] => [course.start, ...course.checkpoints, course.start];

export const courseLength = (course: RaceCourse): number => {
  const points = coursePoints(course);
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  return total;
};

/** Medal times in seconds, from the straight-line course length at walking speed. */
export function medalTimes(course: RaceCourse, walkSpeed: number): Readonly<Record<Medal, number>> {
  const straight = courseLength(course) / walkSpeed;
  return { gold: Math.round(straight * 1.3), silver: Math.round(straight * 1.6), bronze: Math.round(straight * 2.1) };
}

export function medalFor(seconds: number, times: Readonly<Record<Medal, number>>): Medal | null {
  if (seconds <= times.gold) return 'gold';
  if (seconds <= times.silver) return 'silver';
  if (seconds <= times.bronze) return 'bronze';
  return null;
}

/** Ember Marks for the first medal of the day. */
export const MEDAL_MARKS: Readonly<Record<Medal, number>> = { gold: 2, silver: 1, bronze: 1 };

export const isAtPoint = (p: Vec3, x: number, y: number, z: number): boolean =>
  Math.hypot(p.x - x, p.z - z) <= CHECKPOINT_RADIUS && Math.abs(p.y - y) <= CHECKPOINT_HEIGHT;
