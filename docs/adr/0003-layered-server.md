# ADR 0003: Ports-and-adapters layering on the server

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Game servers tend to grow into one large loop that mixes sockets, rules and storage. That makes them hard to test and hard to change: swapping the storage engine, the transport or the tick strategy ends up touching everything.

## Decision

The server is split into three layers with inward-only dependencies:

- **Domain** (`src/domain`): entities and rules (combat, AI, quests, shop, progression). No I/O. Declares the interfaces it needs (`CombatWorld`, `AiWorld`, `EventSink`, `Clock`, `PlayerRepository`).
- **Application** (`src/application`): `GameWorld` runs a tick and implements the domain's world interfaces; `SessionService` maps connections to players, validates and rate-limits messages, and routes events.
- **Infrastructure** (`src/infrastructure`): WebSocket gateway, HTTP static server, JSON persistence, scheduler, logger, hashing.

`src/app.ts` is the composition root. ESLint's `no-restricted-imports` enforces the layer rules in CI.

## Consequences

- Domain and application code is tested with plain objects and fakes, with no sockets or files.
- The same `createGameServer` boots inside tests for real end-to-end checks.
- Replacing JSON files with a database, or WebSockets with another transport, means writing one adapter.
- There is some indirection (interfaces, an event buffer) that a 200-line prototype would not need. That cost is accepted for maintainability.
