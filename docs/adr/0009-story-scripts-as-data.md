# ADR 0009: Story scripts and bounties are data, counted from achievements

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

- The game had one hard-coded quest chain: a quest index on the hero, a `QuestService` called directly by combat, and dialog written for Elder Maren alone.
- We are adding several storylines, daily bounties and game modes. Each new objective kind would otherwise mean another call from combat, movement or conversation code into the quest code.
- Changing what a save stores must never lose an existing hero.

## Decision

- **Stories are data.** `shared/src/game/story.ts` holds the chains. Each step has one objective (defeat, collect, visit, talk), who takes it back, its lines and its reward. The server engine (`StoryService`) and the client (dialog, journal, map marker) read the same data.
- **Append-only steps.** Saves store each chain's step index, so steps are only ever appended. A hero who finished a chain picks up a new last step automatically.
- **Achievements.** Combat, landmark arrivals and conversations report achievements (`kill`, `visit`, `greet`) to an `AchievementSink`. `ProgressTracker` hands each one to the story and bounty services. A new objective kind is a new achievement, not a change to combat.
- **Bounties from seed and day.** Daily bounties are chosen from the world seed and the UTC day number, and each is fully described by its id. Servers, the single-player preview and the client agree without storing the board.
- **Lenient saves.** New record fields are optional on disk and default when missing or damaged. Saves from before this change are migrated: the old quest index becomes the main chain's step, and heroes who already beat the Warden get the Hero of the Realm title.
- **Landmarks and characters are placed by the world generator.** Each gets a small structure, or is snapped to the nearest solid, dry ground, so content works on every seed.

## Consequences

- New stories and bounties need no engine changes.
- Steps that depend on later modes (Lantern Night, Rift Trials) are appended when those modes ship.
- Protocol v3: `npc` actions carry a chain or item id, players carry a title, and progress grows to include story, bounties, Ember Marks and titles.
- The rule that steps are only appended is enforced by review, not by code.
