export type SkillId = 'strike' | 'bolt' | 'mend' | 'ring' | 'tonic';

export interface SkillDef {
  readonly name: string;
  readonly cooldown: number;
  readonly mana: number;
  /** Range from the target's body edge; 0 for self skills. */
  readonly range: number;
  readonly unlockLevel: number;
  /** Damage multiplier on attack power (damage skills only). */
  readonly power: number;
}

export const SKILLS: Readonly<Record<SkillId, SkillDef>> = {
  strike: { name: 'Strike', cooldown: 0.75, mana: 0, range: 2.6, unlockLevel: 1, power: 1 },
  bolt: { name: 'Ember Bolt', cooldown: 1.6, mana: 8, range: 17, unlockLevel: 1, power: 1.35 },
  mend: { name: 'Mend', cooldown: 9, mana: 16, range: 0, unlockLevel: 2, power: 0 },
  ring: { name: 'Flame Ring', cooldown: 10, mana: 22, range: 4.8, unlockLevel: 4, power: 1.25 },
  tonic: { name: 'Healing Tonic', cooldown: 6, mana: 0, range: 0, unlockLevel: 1, power: 0 },
};

export const SKILL_IDS = Object.keys(SKILLS) as readonly SkillId[];

export const isSkillId = (v: unknown): v is SkillId => typeof v === 'string' && v in SKILLS;

/** Speed of an Ember Bolt in blocks per second; the hit lands when it arrives. */
export const BOLT_SPEED = 26;

/** Fraction of max HP restored by Mend. */
export const MEND_FRACTION = 0.4;
