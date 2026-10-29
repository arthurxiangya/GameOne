# ADR 0011: Game modes plug into the world through one interface

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Four modes are planned: Ember Run, Lantern Night, Rift Trials and duels. Each one changes rules that live in the simulation core:

- who monsters attack;
- which skills a hero may use;
- whether a hero may ride;
- whether a hero may move during a countdown.

Each also needs to teleport heroes, pay rewards and post results. Adding those as branches inside `GameWorld`, combat and monster AI would make every mode a change to the core.

## Decision

**The mode interface**

- A mode implements `GameMode`: `step(dt)`, `status(player)` for the hero's HUD, and optional rule hooks: `quit`, `onPlayerRemoved`, `onPlayerFell`, `skillBlocked`, `mountBlocked`, `ignoredByMonsters` and `frozen`.
- A mode acts on the world only through `ModeHost`: time, events, achievements, progression, leaderboards, the calendar, teleport, and marking a hero's mode state as changed.

**How the core uses it**

- `GameWorld` holds the list of modes. It steps them after heroes and monsters, and answers the rule questions by asking each mode.
- `CombatWorld.skillBlocked` and `AiWorld.ignoredByMonsters` carry those answers into the domain services, which still know nothing about modes.

**Reaching the client**

- A hero's mode state goes to their client as a `mode` message when it changes, not in every snapshot.

**Leaderboards**

- The `Leaderboards` service keeps the boards in memory and writes them through a `LeaderboardRepository` port, with adapters for a JSON file (online), localStorage (single-player) and memory (tests).
- Entries carry an owner key, so each hero holds at most one place. The key is stripped before boards are sent to clients.

## Consequences

- A new mode is a new class plus one line in `GameWorld`'s mode list. The Ember Run is the first, and it needed no change to combat or AI beyond the two hooks.
- Rule hooks are checked for every hero on every relevant action. That is cheap for a handful of modes and should be revisited if there are many.
- Ember Run times are measured on the server's own simulation of the runner, so they can't be faster than the movement the server allows.
