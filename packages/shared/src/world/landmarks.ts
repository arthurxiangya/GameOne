/** Named places that stories and bounties send heroes to. Positions come from the world generator. */
export type LandmarkId = 'sunken-pier' | 'hollow-shrine' | 'rift-lookout';

export interface Landmark {
  readonly id: LandmarkId;
  readonly name: string;
  /** Where a hero stands to count as visiting (the centre of the standable spot). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const LANDMARK_NAMES: Readonly<Record<LandmarkId, string>> = {
  'sunken-pier': 'the Sunken Pier',
  'hollow-shrine': 'the Hollow Shrine',
  'rift-lookout': 'the Rift Lookout',
};

export const LANDMARK_IDS = Object.keys(LANDMARK_NAMES) as readonly LandmarkId[];

export const isLandmarkId = (v: unknown): v is LandmarkId => typeof v === 'string' && v in LANDMARK_NAMES;

/** A hero within this many blocks (horizontally) of a landmark is visiting it. */
export const VISIT_RADIUS = 4.5;
/** ...and within this many blocks vertically. */
export const VISIT_HEIGHT = 6;

/** Whether a position counts as being at a landmark. */
export const isVisiting = (l: Landmark, x: number, y: number, z: number): boolean =>
  Math.hypot(l.x - x, l.z - z) <= VISIT_RADIUS && Math.abs(l.y - y) <= VISIT_HEIGHT;
