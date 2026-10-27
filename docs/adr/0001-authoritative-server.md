# ADR 0001: Authoritative server with client-side prediction

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

An online RPG has to stop players from editing their position, damage or gold. It also has to feel responsive on mobile networks with 100–200 ms of latency, where waiting for the server before moving feels broken.

## Decision

- The server owns all game state and simulates it at a fixed 20 Hz tick. Clients send only intent: movement frames and commands.
- The client predicts its own hero with the exact physics the server runs (`stepPlayer` in `shared`), and reconciles on every snapshot by adopting the server state and replaying unacknowledged frames.
- Remote entities are rendered 200 ms in the past, interpolated between snapshots.
- Movement is rate-limited by an input credit (one frame per tick, up to six banked), so a modified client cannot move faster than real time.

## Consequences

- Cheating on movement, combat and economy requires breaking the server, not the client.
- Physics must stay deterministic and shared. Any change to `stepPlayer` affects both sides at once, which is the point.
- Other players are seen 200 ms late. That is acceptable for a cooperative RPG; competitive PvP would need lag compensation.
