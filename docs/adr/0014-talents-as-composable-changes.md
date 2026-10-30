# ADR 0014: Talents are composable changes, and every one is measured before it ships

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The skill system design adds talents: four rows per class, opening at levels 5, 8, 15 and 18, with three choices in each. That is 60 talents. Each one has to:

- stack with a spec on the same skill (a Trapper with Light Quiver changes Volley twice);
- stay small enough not to creep;
- be a real choice, neither a must-pick nor a trap.

A spec replaces fields of a skill. Two replacements on the same skill would overwrite each other, so talents need a different shape.

## Decision

**A talent is a passive, a change to one skill, or both** (`shared/src/game/talents.ts`)

A change composes onto a skill instead of replacing it:

- `damage` and `healing` multiply every damage, burn, heal, shield and hymn on the skill. Neither may go above 1.15.
- `cooldown`, `cost`, `gain`, `radius` and `leech` add to the skill's value.
- `splash` sets the share of damage that falls on everything near the target.
- `effects` are appended after the skill's own.
- `target: 'around'` turns a self skill into an area around you, for group talents.

`kitFor(class, spec, talents)` applies the class skill, then the spec's patch, then each talent in row order. `loadout()` returns the spec, talents, kit and summed passive for a level. The server's `Player`, the skill bar and the C panel all call it.

**Three new passive hooks.** Each is a single line in the engine:

- `haste`: cooldowns recover, and resources refill, faster;
- `guard`: less damage taken below 35% health;
- `onKill`: heals a share of max health on each kill.

Monsters also honour `damageDealt` statuses, which is how Choking Smoke weakens them. Splash damage now has its own share (`splash`), so a cleave hits secondary targets for a fraction of the damage while the main target takes it all.

**Picks**

- `progress.talents[class]` holds one id or null per row. A `talent` message changes a row, out of combat and outside a mode. It is free.
- In a duel, specs and talents use the matched level, so the higher hero loses the rows the lower one hasn't opened.
- Saves keep only ids that exist, in their own row and class.

**Stuns pause rather than cancel.** A stunned monster freezes, and a swing it was winding up waits until the stun ends. Before, a stun of any length erased a swing, which made the shortest stun as strong as the longest.

**Every talent is measured** (`server/test/balance.test.ts`)

At level 20, each talent is applied alone to its class's base kit and measured six ways against the same kit without it:

| Measure | What it is |
| --- | --- |
| Single | Output on one target |
| Pack | Output on three targets |
| Lasts | Survival against three boars that never die |
| Fight | Health left after beating three real boars |
| Ally damage | A partner Emberblade's damage |
| Ally lasts | A partner Emberblade's survival |

The test fails unless all of these hold:

- No talent adds more than 15% to a damage measure, or 25% to a survival measure.
- Every talent moves some measure by at least 2%.
- In each row, every choice is worth at least 40% of the best one. Worth is the choice's biggest gain as a share of that measure's cap.
- No choice beats another in the same row at every measure.

## Consequences

**Tuning came from measurements, not guesses.** The test found several talents that would have been traps:

- slows and radius bumps, which can't matter while standing still;
- resource gains for classes that never run short;
- a heal-on-Volley for a Ranger who dies before the second Volley.

It also found two that were too strong: a cleave that doubled pack damage, and stuns that cancelled swings. Each was redesigned until it passed.

**The simulation has limits.** It stands still and fights in short bursts, so kiting and long boss fights aren't measured. A talent that only shines there has to show some value the test can see, or it doesn't ship.

**The test takes about 75 seconds of CI time.**
