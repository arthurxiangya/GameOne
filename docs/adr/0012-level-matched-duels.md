# ADR 0012: Player-versus-player only inside consensual, level-matched duels

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Heroes can see and stand next to each other, but until now no skill could hit another hero. The Duel Ring adds PvP. Open-world PvP would let high-level heroes bully new ones, and losing a duel must not cost anything a hero worked for.

## Decision

**Consent and range**

- A duel starts only when one hero challenges another within 12 blocks and the other accepts within 15 s. Both must be free: not in an Ember Run, a Rift Trial or another duel.
- Duels are refused during Lantern Night and in the single-player preview.

**The fight**

- Both heroes are healed and put on foot, then a 3 s countdown freezes them (no movement, no skills), then they fight for up to 90 s inside a ring of radius 6 around the midpoint where they stood.
- For the length of the duel both heroes fight at the lower hero's level (`Player.duelLevel`, read through `statLevel`), so max HP, MP and attack match.
- Hero-on-hero hits exist only between the two duellists (`CombatWorld.duelOpponent`). Damage is scaled by 0.6 so fights last long enough to read.
- Nobody dies: a hit that would bring a hero to 0 HP leaves them at 1 and ends the duel. Leaving the ring forfeits. At the time limit the higher HP share wins, and a tie is a draw.
- Tonics are blocked during the fight, monsters ignore duellists, and mounts are blocked.

**After the fight**

- Both heroes are healed again. Ratings move by Elo with K = 32, from 1000. Wins, losses and draws are saved with the hero, and the rating goes on the Duel Ring leaderboard.
- Each result is an achievement, so the Spar bounty counts duels like any other objective.

## Consequences

- PvP is a plug-in mode (ADR 0011); combat gains one branch for hero targets, and the core never lets heroes hurt each other outside a duel.
- Rating can be farmed by two friends trading wins. That is acceptable for now; if it matters, limit rating changes between the same pair per day.
