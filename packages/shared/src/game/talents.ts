import type { ClassId, TalentDef } from './classes';
import type { ClassSkillId } from './skills';

/**
 * Talents: four rows per class, opening at levels 5, 8, 15 and 18, three choices in each. Row 1
 * reshapes the basic attack, row 2 survival, row 3 the signature skill, row 4 helps the group.
 * A talent is a passive, a composable change to one skill, or both (see `TalentChange`). No
 * talent multiplies a skill by more than 1.15, and the balance test checks that no choice in a
 * row beats another at every measure. Picks are free to change out of combat.
 */

type Rows = readonly [readonly TalentDef[], readonly TalentDef[], readonly TalentDef[], readonly TalentDef[]];

const vulnerable = (id: string, name: string, amount: number, seconds: number) =>
  ({ kind: 'status', to: 'enemies', status: { id, name, seconds, damageTaken: amount } }) as const;

/** A basic attack that splashes a share of its damage onto everything within 2 blocks of its target. */
const splashing = (id: string, name: string, skillName: string, skill: ClassSkillId, share: number): TalentDef => ({
  id,
  name,
  text: `${skillName} also splashes ${Math.round(share * 100)}% of its damage onto everything within 2 blocks of the target.`,
  change: { skill, radius: 2, splash: share },
});

export const TALENTS: Readonly<Record<ClassId, Rows>> = {
  warden: [
    [
      { id: 'heavyBash', name: 'Heavy Bash', text: 'Shield Bash deals 15% more damage.', change: { skill: 'shieldBash', damage: 1.15 } },
      { id: 'bracingBash', name: 'Bracing Bash', text: 'Shield Bash heals you for 8% of its damage.', change: { skill: 'shieldBash', leech: 0.08 } },
      splashing('sweepingBash', 'Sweeping Bash', 'Shield Bash', 'shieldBash', 0.08),
    ],
    [
      { id: 'bulwarkDrill', name: 'Bulwark Drill', text: 'Shield Wall recovers 3 s sooner.', change: { skill: 'shieldWall', cooldown: -3 } },
      { id: 'lastStand', name: 'Last Stand', text: 'Below 35% health, take 20% less damage.', passive: { guard: 0.2 } },
      { id: 'secondWind', name: 'Second Wind', text: 'Each kill heals 8% of your health.', passive: { onKill: 0.08 } },
    ],
    [
      { id: 'heavySlam', name: 'Heavy Slam', text: 'Ground Slam deals 15% more damage.', change: { skill: 'groundSlam', damage: 1.15 } },
      {
        id: 'stunningSlam', name: 'Stunning Slam', text: 'Ground Slam stuns for 1 s (not bosses).',
        change: { skill: 'groundSlam', effects: [{ kind: 'status', to: 'enemies', status: { id: 'slamStun', name: 'Stunned', seconds: 1, stun: true } }] },
      },
      { id: 'practisedSlam', name: 'Practised Slam', text: 'Ground Slam costs 10 less Resolve.', change: { skill: 'groundSlam', cost: -10 } },
    ],
    [
      {
        id: 'rallyingShout', name: 'Rallying Shout', text: 'Taunting Shout shields you and allies within 7 for 0.8 P for 6 s.',
        change: { skill: 'taunt', effects: [{ kind: 'shield', to: 'allies', k: 0.8, seconds: 6 }] },
      },
      {
        id: 'sunderingSlam', name: 'Sundering Slam', text: 'Ground Slam makes enemies take 15% more damage for 4 s.',
        change: { skill: 'groundSlam', effects: [vulnerable('sundered', 'Sundered', 0.15, 4)] },
      },
      {
        id: 'mendingShout', name: 'Mending Shout', text: 'Taunting Shout heals you and allies within 7 for 0.8 P.',
        change: { skill: 'taunt', effects: [{ kind: 'heal', to: 'allies', k: 0.8 }] },
      },
    ],
  ],

  lightkeeper: [
    [
      { id: 'searingLight', name: 'Searing Light', text: 'Sunbolt deals 15% more damage.', change: { skill: 'sunbolt', damage: 1.15 } },
      { id: 'kindledFaith', name: 'Kindled Faith', text: 'Sunbolt restores 0.7 mana.', change: { skill: 'sunbolt', gain: 0.7 } },
      splashing('prism', 'Prism', 'Sunbolt', 'sunbolt', 0.1),
    ],
    [
      { id: 'frugalMend', name: 'Frugal Mend', text: 'Mend costs 2 less mana.', change: { skill: 'mend', cost: -2 } },
      { id: 'serenity', name: 'Serenity', text: 'Cooldowns recover and mana refills 12% faster.', passive: { haste: 0.12 } },
      { id: 'deepMend', name: 'Deep Mend', text: 'Mend heals 15% more and costs 1 less mana.', change: { skill: 'mend', healing: 1.15, cost: -1 } },
    ],
    [
      { id: 'brightWard', name: 'Bright Ward', text: 'Lantern Ward absorbs 15% more.', change: { skill: 'ward', healing: 1.15 } },
      { id: 'lightWard', name: 'Light Ward', text: 'Lantern Ward costs 6 less mana.', change: { skill: 'ward', cost: -6 } },
      {
        id: 'mendingWard', name: 'Mending Ward', text: 'Lantern Ward also heals its target for 1 P.',
        change: { skill: 'ward', effects: [{ kind: 'heal', to: 'allies', k: 1 }] },
      },
    ],
    [
      {
        id: 'radiantShield', name: 'Radiant Shield', text: 'Radiance also shields you and allies in reach for 0.5 P for 6 s.',
        change: { skill: 'radiance', effects: [{ kind: 'shield', to: 'allies', k: 0.5, seconds: 6 }] },
      },
      {
        id: 'beacon', name: 'Beacon', text: 'Mend also gives its target 10% less damage taken for 4 s.',
        change: { skill: 'mend', effects: [{ kind: 'status', to: 'allies', status: { id: 'beacon', name: 'Beacon', seconds: 4, damageTaken: -0.1 } }] },
      },
      {
        id: 'sunburst', name: 'Sunburst', text: 'Radiance makes enemies take 10% more damage for 8 s.',
        change: { skill: 'radiance', effects: [vulnerable('sunburst', 'Sunburst', 0.1, 8)] },
      },
    ],
  ],

  ranger: [
    [
      { id: 'barbedArrows', name: 'Barbed Arrows', text: 'Quick Shot deals 15% more damage.', change: { skill: 'quickShot', damage: 1.15 } },
      { id: 'steadyRhythm', name: 'Steady Rhythm', text: 'Quick Shot restores 2 Focus.', change: { skill: 'quickShot', gain: 2 } },
      splashing('splitArrow', 'Split Arrow', 'Quick Shot', 'quickShot', 0.14),
    ],
    [
      { id: 'fieldDressing', name: 'Field Dressing', text: 'Each kill heals 5% of your health.', passive: { onKill: 0.05 } },
      { id: 'hardy', name: 'Hardy', text: '12% more max health.', passive: { maxHp: 0.12 } },
      { id: 'pinningBarrage', name: 'Pinning Barrage', text: 'Pinning Shot recovers 4 s sooner and costs 10 less Focus.', change: { skill: 'pinningShot', cooldown: -4, cost: -10 } },
    ],
    [
      {
        id: 'coverOfArrows', name: 'Cover of Arrows', text: 'Volley also shields you for 1 P for 5 s.',
        change: { skill: 'volley', effects: [{ kind: 'shield', to: 'self', k: 1, seconds: 5 }] },
      },
      { id: 'cheapVolley', name: 'Light Quiver', text: 'Volley costs 10 less Focus.', change: { skill: 'volley', cost: -10 } },
      {
        id: 'stunningVolley', name: 'Stunning Volley', text: 'Volley stuns everything it hits for 0.5 s (not bosses).',
        change: { skill: 'volley', effects: [{ kind: 'status', to: 'enemies', status: { id: 'volleyStun', name: 'Stunned', seconds: 0.5, stun: true } }] },
      },
    ],
    [
      {
        id: 'huntersMark', name: 'Hunter’s Mark', text: 'Aimed Shot makes its target take 10% more damage for 6 s.',
        change: { skill: 'aimedShot', effects: [vulnerable('marked', 'Marked', 0.1, 6)] },
      },
      {
        id: 'coveringFire', name: 'Covering Fire', text: 'Pinning Shot stuns for 1 s (not bosses).',
        change: { skill: 'pinningShot', effects: [{ kind: 'status', to: 'enemies', status: { id: 'pinStun', name: 'Stunned', seconds: 1, stun: true } }] },
      },
      {
        id: 'markingVolley', name: 'Marking Volley', text: 'Volley makes everything it hits take 12% more damage for 6 s.',
        change: { skill: 'volley', effects: [vulnerable('volleyMark', 'Marked', 0.12, 6)] },
      },
    ],
  ],

  emberblade: [
    [
      { id: 'keenEdge', name: 'Keen Edge', text: 'Slash deals 15% more damage.', change: { skill: 'slash', damage: 1.15 } },
      { id: 'siphoningSlash', name: 'Siphoning Slash', text: 'Slash heals you for 14% of its damage.', change: { skill: 'slash', leech: 0.14 } },
      splashing('cleave', 'Cleave', 'Slash', 'slash', 0.15),
    ],
    [
      { id: 'bloodfire', name: 'Bloodfire', text: 'Each kill heals 5% of your health.', passive: { onKill: 0.05 } },
      {
        id: 'fireguard', name: 'Fireguard', text: 'Kindle also gives you 20% less damage taken for 5 s.',
        change: { skill: 'kindle', effects: [{ kind: 'status', to: 'self', status: { id: 'fireguard', name: 'Fireguard', seconds: 5, damageTaken: -0.2 } }] },
      },
      { id: 'emberSkin', name: 'Ember Skin', text: '12% more armour.', passive: { armor: 0.12 } },
    ],
    [
      { id: 'biggerBlast', name: 'Bigger Blast', text: 'Inferno deals 15% more damage.', change: { skill: 'inferno', damage: 1.15 } },
      {
        id: 'lingeringFlame', name: 'Lingering Flame', text: 'Inferno burns for 0.4 P over 3 s.',
        change: { skill: 'inferno', effects: [{ kind: 'status', to: 'enemies', status: { id: 'lingering', name: 'Burning', seconds: 3, dot: 0.4 } }] },
      },
      { id: 'hotTemper', name: 'Hot Temper', text: 'Inferno costs 15 less Heat.', change: { skill: 'inferno', cost: -15 } },
    ],
    [
      {
        id: 'smoke', name: 'Choking Smoke', text: 'Inferno makes enemies deal 20% less damage for 8 s.',
        change: { skill: 'inferno', effects: [{ kind: 'status', to: 'enemies', status: { id: 'smoke', name: 'Choking', seconds: 8, damageDealt: -0.2 } }] },
      },
      {
        id: 'searingMark', name: 'Searing Mark', text: 'Searing Edge makes its target take 10% more damage for 6 s.',
        change: { skill: 'searingEdge', effects: [vulnerable('seared', 'Seared', 0.1, 6)] },
      },
      {
        id: 'warcry', name: 'Warcry', text: 'Inferno also gives you and allies in its reach 8% more damage for 8 s.',
        change: { skill: 'inferno', effects: [{ kind: 'status', to: 'allies', status: { id: 'warcry', name: 'Warcry', seconds: 8, damageDealt: 0.08 } }] },
      },
    ],
  ],

  chimer: [
    [
      { id: 'resonantToll', name: 'Resonant Toll', text: 'Toll deals 15% more damage.', change: { skill: 'toll', damage: 1.15 } },
      { id: 'echo', name: 'Echo', text: 'Toll heals you for 10% of its damage.', change: { skill: 'toll', leech: 0.1 } },
      splashing('chimingToll', 'Chiming Toll', 'Toll', 'toll', 0.1),
    ],
    [
      { id: 'steadyChord', name: 'Steady Chord', text: 'Below 35% health, take 30% less damage.', passive: { guard: 0.3 } },
      { id: 'tempo', name: 'Tempo', text: 'Cooldowns recover and mana refills 10% faster.', passive: { haste: 0.1 } },
      { id: 'bellWard', name: 'Bell Ward', text: '18% more max health.', passive: { maxHp: 0.18 } },
    ],
    [
      { id: 'swellingHymn', name: 'Swelling Hymn', text: 'Hymn of Mending heals 15% more.', change: { skill: 'hymn', healing: 1.15 } },
      {
        id: 'openingHymn', name: 'Opening Chord', text: 'Hymn of Mending also heals 0.6 P at once.',
        change: { skill: 'hymn', effects: [{ kind: 'heal', to: 'allies', k: 0.6 }] },
      },
      {
        id: 'shelteringHymn', name: 'Sheltering Hymn', text: 'Hymn of Mending also gives 10% less damage taken for 6 s.',
        change: { skill: 'hymn', effects: [{ kind: 'status', to: 'allies', status: { id: 'sheltered', name: 'Sheltered', seconds: 6, damageTaken: -0.1 } }] },
      },
    ],
    [
      { id: 'longPeal', name: 'Long Peal', text: 'Rallying Peal recovers 6 s sooner.', change: { skill: 'peal', cooldown: -6 } },
      {
        id: 'dissonance', name: 'Dissonance', text: 'Discord’s target takes 10% more damage on top.',
        change: { skill: 'discord', effects: [vulnerable('dissonance', 'Dissonance', 0.1, 8)] },
      },
      {
        id: 'anthem', name: 'Anthem', text: 'Rallying Peal also shields you and allies within reach for 0.8 P for 6 s.',
        change: { skill: 'peal', effects: [{ kind: 'shield', to: 'allies', k: 0.8, seconds: 6 }] },
      },
    ],
  ],
};
