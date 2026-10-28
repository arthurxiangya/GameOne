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
- Snapshots cover the area of interest. They started as full views at 10 Hz; ADR 0007 moved them to per-viewer deltas at 20 Hz.

## Consequences

- With full snapshots each player received about 7 KB per snapshot near town, about 70 KB/s. Deltas brought that to about 1.2 KB per snapshot, about 21 KB/s at twice the rate.
- The codec is isolated in `encodeMessage`/`decodeServerMessage`. Moving to a binary format with delta compression is a contained change if bandwidth becomes a cost.
