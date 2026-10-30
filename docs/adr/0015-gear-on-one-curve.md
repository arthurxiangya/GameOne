# ADR 0015: Gear is data on one diminishing curve, and every set and legendary is measured

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

The equipment design adds six slots, five rarities, random affixes, sets, legendaries and crafting at Smith Oda. The game already had one piece of gear: a weapon tier (0–5) bought by sharpening, worth +4 Power per tier.

Gear is where MMOs usually creep. Each new tier outclasses the last, one stat becomes the stat, and a set or legendary becomes the only build. The design's constraints rule all three out:

- gear may add about a third to a hero's output, no more;
- mixing stats must beat stacking one;
- a set must be a different build, not a better one;
- a legendary must stay as small as a talent.

## Decision

**Items are data** (`shared/src/game/gear.ts`)

An item is a slot, a rarity, an item level, a source tier and a list of affix stats. Its name, main line and every number come from shared functions, so the server, the client's gear panel and the tests agree. Items are never edited in place: an upgrade or reforge replaces the object, and so does the hero's `gear` record. The server's `Player` memoizes its stats by reference and recomputes them exactly when something changes.

| Slot | Main line |
| --- | --- |
| Weapon | +0.2 × iLvl Power (shown as your class's primary stat) |
| Helm, chest, gloves, boots | +0.4 × iLvl health |
| Charm | None; one extra affix instead |

- **Rarity sets the affix count:** Common 0, Uncommon 1, Rare 2, Epic 3, Legendary 2, set pieces 2.
- **Item level:** an item drops at 5 × the source's level (never above the killer's own level), plus 5 for elite and 10 for raid sources. The ceiling is 110.
- **One curve for every affix stat.** Each affix is worth 0.1 × iLvl rating. A stat's bonus is cap × R ÷ (R + 60), where R is your total rating in it. The caps are Power 30%, Crit 20%, Haste 20% and Vigor 30%.

**Hero stats** (`shared/src/game/hero.ts`)

`heroStats()` puts class, spec, talents and gear together:

```
Power  = (P₀(L) + 0.2 × weapon iLvl) × (1 + Power bonus)
Health = (HP₀(L) × h + 0.4 × Σ armour iLvl) × (1 + max-health group, capped at +50%)
```

Crit and Haste add to the same passive fields that specs and talents use, so every existing hook (crit chance, faster cooldowns and resource) works with no new engine code. In a duel, each item counts at no more than 5 × the matched level plus its tier.

**Old weapon tiers become weapons.** A save with weapon tier w gets a Common weapon of iLvl 20w. That gives the same +4w Power, so nobody gets weaker. Sharpening is gone; Oda sells a plain weapon at 5 × your level for 20 + 10 × level gold.

**Sets and legendaries reuse what exists**

- A set's two-piece bonus is a `Passive`. Its four-piece bonus is one of three engine hooks (`GearProc`):
  - Frostward: a shield when you drop below 40% health;
  - Emberfall: a burn on each critical hit;
  - Bellsong: a damage buff to allies when you use your fourth skill.
- **A legendary is a talent carried by an item.** It has the same `change` and `passive` and goes through the same `kitFor` pipeline, applied after the talents. It works only for its own spec, and only one can be worn.
- Two legendaries needed one small new mechanic each:
  - `reflect`, a status field: Frost Heart Aegis sends back part of each blow;
  - `echo`: Pip's Lucky Quiver repeats every fourth Aimed Shot for free.
- A splash share of 0 now means "statuses only". Tanglewood Treads uses it to spread Pinning Shot's slow without its damage.

**Drops and the forge** (`server/src/domain/services/gear-service.ts`)

- **Regular monsters:** 6% chance per kill (Common 60%, Uncommon 35%, Rare 5%).
- **Bosses:** every hero within 30 blocks gets a roll when a boss falls. Healers are included even though they make no threat.
- **Stand-ins until dungeons open:**
  - the Warden of the Frost Heart drops elite gear, with Frostward pieces;
  - the Rift Lord drops elite gear, with Emberfall pieces and an 8% legendary chance;
  - the Gloom Knight on Lantern Night drops raid gear, with Bellsong pieces and an 8% legendary chance.
- **Loot uses its own random stream**, so a drop never shifts a fight's crits.
- **Bag:** 24 items. A full bag salvages new drops into Embers on the spot, so nothing is lost.
- **Salvage** works anywhere. Changing what you wear needs you out of combat and outside a mode, like talents.
- **Upgrade, reforge and craft** need Smith Oda:

| Action | Cost | Limit |
| --- | --- | --- |
| Upgrade | 20 Embers | +5 iLvl, up to the source's ceiling and 5 × your level |
| Reforge | 10 Embers + 1 Mark | Choose a new stat for one affix; after that, only that affix can be reforged |
| Craft | 40 Embers + 3 Marks | A rare item for the slot you choose |

**Protocol v11.** There is one new client message, `gear`, with `op` set to `equip`, `unequip`, `salvage`, `upgrade`, `reforge` or `craft`. The NPC action `sharpen` is replaced by `buyWeapon`. Progress gains `gear`, `bag`, `embers` and `itemSeq`, and loses `weapon`.

**Every band is a test**

- `shared/test/gear.test.ts` checks the curve and the design doc's table:
  - all Power ×1.23;
  - even mix ×1.34;
  - iLvl 110 within 2–5% of iLvl 100.
- `server/test/gear-balance.test.ts` measures through the real server (helpers in `balance-harness.ts`):
  - Every class gets about ×1.23 from stacking Power, and more from an even mix, at most about a third.
  - A survival mix gives about +20% health.
  - Each legendary, worn by its own spec and compared with a plain item in the same slot, stays inside the talent caps (+15% to damage measures, +25% to survival) and moves some measure by at least 2%.
  - A seventh measure, *hold*, counts damage dealt while three boars hit back. That is the only place a reflecting tank shows.
  - Each set, compared with four plain epics that carry one more affix each, must win at something, must not win at everything, and must stay inside the caps.

## Consequences

**The measurements redesigned half the legendaries.** The first drafts failed in instructive ways:

- Shield Wall reflection and an Ashen Kindle never fired, because their skills are only used when hurt.
- A 40% Sunbolt splash added 57% to pack damage.
- Every fifth Quick Shot as a free Aimed Shot added 36% to single-target damage.

The shipped versions moved the Aegis to Taunt, Ashen Mantle to Searing Edge, Cinder Lantern to a burn, and Pip's Quiver to every fourth Aimed Shot. Bellsong's four-piece was raised to +8% for 8 s.

**Stand-in sources are temporary.** When dungeons ship, sets and legendaries move to the dungeon tiers that the design names. Only the drop tables change.

**Measuring noise.** In-engine output moves a few percent with cooldown timing, so the in-engine bands are wide, and the exact formulas are checked separately in the shared tests.

**Statuses keep their tick clock when refreshed.** A burn refreshed by every crit still ticks once a second. Before, a refresh reset the clock. The class and talent bands still pass with the change.

**Test time.** The gear bands add about 30 seconds, in their own file, so they run alongside the class and talent bands.
