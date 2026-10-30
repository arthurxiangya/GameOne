/**
 * The shape of a skill. Skills are data: the server runs them through one engine, the client
 * draws their buttons and tooltips from the same definitions, and the balance test measures
 * them. The skills themselves live with their classes in `classes.ts`.
 */

export type ClassSkillId =
  | 'shieldBash' | 'taunt' | 'shieldWall' | 'groundSlam'
  | 'sunbolt' | 'mend' | 'radiance' | 'ward'
  | 'quickShot' | 'aimedShot' | 'pinningShot' | 'volley'
  | 'slash' | 'searingEdge' | 'kindle' | 'inferno'
  | 'toll' | 'peal' | 'discord' | 'hymn';

export type SkillId = ClassSkillId | 'tonic';

export type IconId =
  | 'shield' | 'shout' | 'wall' | 'slam'
  | 'sun' | 'cross' | 'burst' | 'ward'
  | 'arrow' | 'aim' | 'pin' | 'volley'
  | 'sword' | 'flame' | 'heart' | 'inferno'
  | 'bell' | 'horn' | 'discord' | 'note'
  | 'tonic';

/**
 * A timed effect on a hero or a monster. Applying a status with the same id again refreshes it.
 * Heroes ignore `slow` and `stun` (their movement is predicted on the client); bosses ignore `stun`.
 */
export interface StatusDef {
  readonly id: string;
  readonly name: string;
  readonly seconds: number;
  /** Extra damage dealt: 0.15 = 15% more. */
  readonly damageDealt?: number;
  /** Damage taken: -0.4 = 40% less, 0.2 = 20% more. */
  readonly damageTaken?: number;
  /** Monster movement slow: 0.4 = 40% slower. */
  readonly slow?: number;
  /** Monsters stop moving and attacking. */
  readonly stun?: boolean;
  /** Total damage over the duration, as a multiple of the caster's Power. */
  readonly dot?: number;
  /** Total healing over the duration, as a multiple of the caster's Power. */
  readonly hot?: number;
}

/**
 * What a skill does. Who it reaches depends on the skill's `target`: `enemies` are the target
 * (plus everything within `radius` of it) or everything within `radius` of the caster; `allies`
 * are the healed hero, or every hero within `radius` of the caster; `others` are those allies
 * except the caster.
 */
export type SkillEffect =
  | { readonly kind: 'damage'; readonly k: number }
  | { readonly kind: 'heal'; readonly to: 'allies' | 'self'; readonly k?: number; readonly maxHp?: number }
  | { readonly kind: 'shield'; readonly to: 'allies' | 'self'; readonly k: number; readonly seconds: number }
  | { readonly kind: 'status'; readonly to: 'enemies' | 'allies' | 'others' | 'self'; readonly status: StatusDef }
  | { readonly kind: 'taunt'; readonly seconds: number };

export interface SkillDef {
  readonly id: SkillId;
  readonly name: string;
  readonly icon: IconId;
  readonly unlockLevel: number;
  readonly cooldown: number;
  /** Resource spent on use. */
  readonly cost: number;
  /** Resource gained on use (builders). */
  readonly gain: number;
  /**
   * `enemy`: a monster (or duel opponent) in range. `ally`: the hero you target, or yourself.
   * `self`: yourself. `around`: everything within `radius` of you.
   */
  readonly target: 'enemy' | 'ally' | 'self' | 'around';
  /** Enemy skills: `melee` lands at once; `projectile` lands after its flight. */
  readonly delivery: 'melee' | 'projectile' | 'instant';
  /** Reach to the target's body edge, for enemy and ally skills. */
  readonly range: number;
  /** Area around the caster (`around`), or splash around the target (`enemy`). 0 for none. */
  readonly radius: number;
  readonly effects: readonly SkillEffect[];
  /** The caster heals for this share of the damage the skill deals. */
  readonly leech: number;
  /** Extra crit chance on this skill. */
  readonly crit: number;
  /** Colour of the projectile or ring. */
  readonly color: number;
  /** Tooltip. Tokens: {d} damage, {h} heal, {s} shield, {o} damage over time, {v} healing over time, {r} radius. */
  readonly text: string;
}

/** Fills the defaults so class configs only state what matters. */
export const skill = (
  s: Pick<SkillDef, 'id' | 'name' | 'icon' | 'cooldown' | 'target' | 'effects' | 'text'> & Partial<SkillDef>,
): SkillDef => ({
  unlockLevel: 1,
  cost: 0,
  gain: 0,
  delivery: 'instant',
  range: 0,
  radius: 0,
  leech: 0,
  crit: 0,
  color: 0xffc066,
  ...s,
});

/** Speed of every projectile in blocks per second; the hit lands when it arrives. */
export const BOLT_SPEED = 26;

/** The Healing Tonic: the fifth button for every class. Its effect is special-cased (it uses up a tonic). */
export const TONIC: SkillDef = skill({
  id: 'tonic', name: 'Healing Tonic', icon: 'tonic', cooldown: 6, target: 'self', effects: [],
  text: 'Drink a tonic to restore health. Smith Oda sells more.',
});

/** Does using this skill count as attacking (blocked during an Ember Run, starts combat)? */
export const isOffensive = (def: SkillDef): boolean =>
  def.effects.some((e) => e.kind === 'damage' || e.kind === 'taunt' || (e.kind === 'status' && e.to === 'enemies'));

/** Fills a skill's tooltip with numbers at the given Power and modifiers. */
export function describeSkill(def: SkillDef, power: number, damageBonus = 0, healingBonus = 0): string {
  const first = <K extends SkillEffect['kind']>(kind: K): Extract<SkillEffect, { kind: K }> | undefined =>
    def.effects.find((e): e is Extract<SkillEffect, { kind: K }> => e.kind === kind);
  const statuses = def.effects.filter((e): e is Extract<SkillEffect, { kind: 'status' }> => e.kind === 'status').map((e) => e.status);
  const num = (v: number): string => String(Math.max(1, Math.round(v)));
  const tokens: Record<string, string> = {
    d: num(power * (first('damage')?.k ?? 0) * (1 + damageBonus)),
    h: num(power * (first('heal')?.k ?? 0) * (1 + healingBonus)),
    s: num(power * (first('shield')?.k ?? 0)),
    o: num(power * (statuses.find((s) => s.dot)?.dot ?? 0) * (1 + damageBonus)),
    v: num(power * (statuses.find((s) => s.hot)?.hot ?? 0) * (1 + healingBonus)),
    r: String(def.radius),
  };
  return def.text.replace(/\{([dhsovr])\}/g, (_, t: string) => tokens[t] ?? '');
}
