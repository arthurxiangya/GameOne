# ADR 0006: Single-player mode runs the authoritative server in the page

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

People want to try the game before anyone hosts a server, on static hosts that can't run Node, and on a phone with nothing installed. A separate offline version of the game would drift from the real rules and double the maintenance.

## Decision

- Pull the transport-independent core of the server into `createSimulation()` (world, sessions, fixed-step loop). Both the online server and a new `createEmbeddedServer()` are built from it.
- `simulation.ts` and `embedded.ts` must not use Node APIs or Node-only adapters. ESLint enforces it.
- The client talks to servers through a `Transport` interface: `WebSocketTransport` online, `LoopbackTransport` in single-player. Loopback still sends JSON text and delivers it asynchronously and in order, like a socket.
- Single-player saves use a browser `PlayerRepository` adapter (localStorage, with an in-memory fallback).
- `npm run build:preview` produces a static bundle in single-player mode; `?offline` switches any build.

## Consequences

- Single-player plays by exactly the online rules, and every change to the simulation is exercised in both modes.
- The client package now depends on the server package, but only on its `embedded` entry point, which the package `exports` restrict.
- Single-player is a demo, not a security boundary: the player controls the whole page, so it can be cheated. Nothing it saves ever reaches the online server.
- The page carries both client and server code (about 110 KB minified before three.js).
