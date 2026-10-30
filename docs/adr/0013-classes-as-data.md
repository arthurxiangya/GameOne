# ADR 0013: Classes, skills and specializations are data, run by one skill engine and guarded by a balance test

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Every hero had the same five buttons (Strike, Ember Bolt, Mend, Flame Ring, Tonic). We want five classes covering four roles (tank, healer, damage, support), each with its own resource, four skills and two specializations. The constraints:

- clarity and fun over complexity;
- no power creep and no must-pick build;
- internally consistent numbers, with the formulas written down.

Writing each class as code would put five copies of targeting, costs and cooldowns into combat. It would also make balance something we argue about rather than measure.

## Decision

**Classes are configs** (`shared/src/game/classes.ts`)

A class sets:

- a health multiplier, armour and a threat multiplier;
- one resource: Resolve, Mana, Focus or Heat, each a few numbers (pool, regen in and out of combat, gain per hit taken);
- four skills, which unlock at levels 1, 1, 2 and 4;
- two specializations;
- a rotation, the priority list the balance test plays.

**A skill is a list of effects**

- Effects are `damage`, `heal`, `shield`, `status` or `taunt`.
- A skill has a targeting mode (`enemy`, `ally`, `self` or `around`), a delivery (`melee`, `projectile` or `instant`), a range and a radius. Together these decide who each effect reaches.
- Statuses are timed modifiers: damage dealt, damage taken, slow, stun, burns and hymns.
- A spec (from level 10) is one `Passive` plus a partial patch over its class's skills. `kitFor(class, spec)` resolves both, and the client and server call the same function.

**One engine runs every skill** (`CombatService`)

- Every skill goes through the same steps: check, pay, choose who it reaches, then apply its effects in order.
- `StatusList` holds statuses on heroes and monsters. Burns and hymns tick once a second for exactly their duration.
- Monster AI honours slows, stuns (bosses are immune) and taunts. Threat is damage × the class's threat multiplier.
- Damage follows the formula in the design doc. Modifier groups add within a group, each group is capped at +50%, and the groups multiply. Armour and damage-taken statuses together can't reduce damage by more than 60%.
- Healing never crits.
- Duels use the same pipeline, × 0.6. Heroes ignore slows and stuns, because their movement is predicted on the client.

**Choosing is free and reversible**

- Heroes always enter at the fountain, so the class picked on the title screen applies on entry (`hello.cls`). In Emberhold, out of combat, the C panel changes class.
- Specs change anywhere out of combat, outside a mode activity.
- The hero record keeps the class, plus one spec per class. Saves from before classes load as Emberblades, the class closest to the old kit.

**Balance is a test** (`server/test/balance.test.ts`)

Every class and spec plays its rotation through the real `GameWorld` and must stay inside these bands:

- Each base kit is within 15% of its designed output (Power per second, crits included).
- A spec is never weaker than the base kit, and never more than 30% stronger on one target.
- Every build beats two same-level monsters standing still, without tonics. The tank and healer beat three.
- No build has both the most damage and above-median survival. Within each class, neither spec is better at both.
- Every class kills a same-level monster in 1.5–7 s at levels 5, 10 and 20.

The test prints its table, which is where the design doc's numbers come from.

**Protocol v9**

- `hello` carries `cls`, and a new `class` message changes class and spec.
- `you.cd` covers only the current kit, and `you` adds `st` (statuses) and `sh` (shield).
- Players gain `cl`, `bolt` and `ring` events carry a colour, and a new `fx` event floats status labels.

## Consequences

- **Adding content is cheap.** A new class or spec is a config, an icon and a rotation. A tuning change that breaks a band fails CI before it ships.
- **The engine already has hooks for what comes next.** Talents and gear (designed in the doc, not built yet) will extend `Passive` and Power rather than adding engine branches.
- **The simulation understates range and control.** It stands still, so the Ranger's range and the Trapper's slows are worth more in play than in the numbers.
- **Group specs measure weaker solo.** Bulwark's ally shield and Stillwater's stun pay off in groups; the solo test sees only their passive.
- **Old clients are refused.** Older pages are asked to refresh, as with every protocol bump.
