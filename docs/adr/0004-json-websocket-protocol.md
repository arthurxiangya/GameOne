# ADR 0004: JSON over WebSocket, versioned and validated

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Browsers need a bidirectional, low-latency channel that works through proxies and on mobile. We also want messages that are easy to inspect while the game is young.

## Decision

- Use one WebSocket per player at `/ws`, with JSON text frames discriminated by `t` and short field names.
- Keep message types in `shared/protocol` so both sides compile against the same definitions.
- Validate every client message structurally on the server (`parseClientMessage`); never trust a client field.
- Version the protocol and reject mismatched clients at `hello`.
- Snapshots are full (not delta) views of the area of interest at 10 Hz.

## Consequences

- Each player receives roughly 3–6 KB per snapshot near busy areas, about 50 KB/s, which is fine for tens to hundreds of players.
- The codec is isolated in `encodeMessage`/`decodeServerMessage`. Moving to a binary format with delta compression is a contained change if bandwidth becomes a cost.
