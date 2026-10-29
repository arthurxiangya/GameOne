# ADR 0010: Mounts change speed through the shared physics; pets are drawn only by clients

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Players asked for mounts and pets.

- A mount changes how fast a hero moves. Movement is predicted on the client and simulated on the server, so both must use exactly the same speed or every step would be corrected.
- A pet that the server simulated as an entity would roughly double the entities near every hero, and with them the snapshot size and AI cost, for something purely cosmetic.

## Decision

**Mounts**

- `stepPlayer` takes a land-speed multiplier. Swimming is never faster.
- The server owns whether a hero is riding. It sends the mount in the hero's own snapshot (`you.mt`), and the client predicts with the same multiplier.
- Input credit still limits movement to one frame per tick of real time, so a mount changes distance per frame, not frames per second. It cannot be used to move faster than the mount allows.
- Calling takes 1.5 seconds and is refused within 5 seconds of combat. Using a skill or taking damage dismounts.

**Pets**

- A pet is one field on its hero's entity state. Each client draws it trailing its hero.
- The server only applies the pet's bonus, in the existing gold, XP, mana, healing and drop calculations. Pets never fight.

**Unlocks**

- Rewards that unlock something (titles, mounts) are granted again on load for steps a hero already finished. Existing heroes get unlocks that were added after they played.

## Consequences

- Mounts add no new network messages to the movement path, and no prediction corrections beyond the one tick where riding starts or stops.
- Pets cost no server simulation and add two small fields per hero to snapshots.
- Every client draws a pet in a slightly different place, which is fine for something cosmetic.
