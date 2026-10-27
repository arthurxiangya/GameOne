# ADR 0002: Deterministic world generated from a seed

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

The realm is 160 × 160 × 72 blocks, about 1.8 MB raw. Streaming it to every client would dominate join time on mobile networks. The world is not editable by players.

## Decision

The world is a pure function of a seed (`generateWorld(seed)` in `shared`), using seeded value noise and a seeded PRNG only. The server sends the seed in `welcome`; the client generates the identical world locally in about 0.2 s and meshes it progressively.

## Consequences

- Joining costs a few hundred bytes instead of megabytes.
- Client and server collision always agree, which prediction depends on.
- A test (`worldgen.test.ts`) guards determinism, and generation code must never use `Math.random` or the clock.
- If player building is added later, edits need a separate delta channel on top of the seeded base.
