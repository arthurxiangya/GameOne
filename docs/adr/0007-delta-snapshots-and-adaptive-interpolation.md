# ADR 0007: Delta snapshots at 20 Hz, adaptive interpolation, input credit

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Players testing two windows side by side reported that movement looked laggy. Measured on the Render deployment with `net-probe` (from a GitHub runner, 72 ms ping):

| Measure | Result |
| --- | --- |
| Own prediction vs server | 0 corrections in 600 snapshots, so own movement was exact |
| Server tick | 0.3 ms average, no lag resets |
| Snapshot spacing | 100 ms (10 Hz), 7 KB each, 69 KB/s per player |
| Input acknowledged | 123 ms p50, 172 ms p95 |
| Another player seen moving | 167 ms after the input left, plus a fixed 200 ms client render delay |

The visible lag was everything between one player's input and another player seeing it. The biggest parts were the fixed 200 ms render delay, the 100 ms snapshot spacing, and input waiting in the server queue: one frame of credit per tick with a six-frame cap let a backlog form and never drain.

## Decision

- Send a snapshot every tick (20 Hz).
- Delta-encode snapshots per viewer: new entities in full, then only changed fields, `gone` for departures. This is protocol v2.
- Make the client's render delay adaptive: snapshot spacing plus 95th-percentile lateness, clamped to 50–300 ms and eased.
- Bank input credit up to one second, give new players four frames, and drop backlog beyond four frames, acknowledging it so the client reconciles.
- Show fps next to ping, and lower render quality step by step when a device stays below 30 fps.

## Consequences

- One player sees another move roughly 200 ms sooner. Bandwidth per player falls by about two thirds even at twice the rate.
- Snapshot building keeps per-viewer state, which must be forgotten when a player leaves (done in `SessionService.leave`).
- After a stall longer than a second, a few frames of input are dropped and the client snaps or smooths to the server position.
- Old (v1) clients are told to refresh.
