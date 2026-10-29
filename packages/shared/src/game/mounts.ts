/** Mounts: ridden for speed on land. Whether a hero is mounted is server state. */
export type MountId = 'strider' | 'hog' | 'runner' | 'elk' | 'steed';

export interface MountDef {
  readonly name: string;
  /** Multiplier on walking speed while riding on land. */
  readonly speed: number;
  /** How to get it, for the stable panel. */
  readonly how: string;
}

export const MOUNTS: Readonly<Record<MountId, MountDef>> = {
  strider: { name: 'Meadow Strider', speed: 1.6, how: 'Buy from Smith Oda at level 5 for 250 gold' },
  hog: { name: 'Bramble Hog', speed: 1.6, how: 'Finish The Lantern Thief' },
  runner: { name: 'Dune Runner', speed: 1.7, how: 'Trade 20 Ember Marks with Smith Oda' },
  elk: { name: 'Frost Elk', speed: 1.8, how: 'Defeat the Warden of the Frost Heart' },
  steed: { name: 'Gloom Steed', speed: 1.8, how: 'Win five Lantern Nights' },
};

export const MOUNT_IDS = Object.keys(MOUNTS) as readonly MountId[];

export const isMountId = (v: unknown): v is MountId => typeof v === 'string' && v in MOUNTS;

/** Seconds it takes to call a mount. Taking damage or using a skill cancels the call. */
export const MOUNT_CALL_SECONDS = 1.5;

/** No calling a mount within this many seconds of hitting or being hit. */
export const MOUNT_COMBAT_LOCK_SECONDS = 5;

/** Speed multiplier for a hero riding `mount` (or on foot). */
export const mountSpeed = (mount: MountId | null): number => (mount ? MOUNTS[mount].speed : 1);
