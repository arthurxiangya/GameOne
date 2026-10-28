# Capacity and protocol

Measured, not estimated. Reproduce with the **Load test** and **Live probe** workflows (Actions tab), or run `packages/server/scripts/net-probe.ts` yourself.

## How many players can one server hold?

The load test starts a fresh server, connects N bots (all in the one shared realm, all walking, 20 inputs per second each) and reads the server's own tick timing. It ran on a GitHub-hosted runner (4 vCPU) with the bots on the same machine, after the protocol v2 changes (ADR 0007).

| Players | Server time per tick (50 ms budget) | Input acknowledged, p95 | Server upload |
| --- | --- | --- | --- |
| 51 | 6.3 ms (13%) | 37 ms | 2.5 MB/s |
| 102 | 16.4 ms (33%) | 59 ms | 7.7 MB/s |
| 201 | 42.9 ms (86%) | 231 ms | 11.1 MB/s |
| 300 | 92.7 ms (185%): overloaded | 723 ms | 24.1 MB/s |
| 402 | 139 ms (278%): overloaded | 1,107 ms | 32.8 MB/s |

**One server process holds about 150–200 players** at 20 Hz when they are all in view of each other, which is always the case on this island. Cost grows faster than linearly, roughly N^1.7, because every player receives every other player.

The Render free plan has 0.1 CPU, a tenth of one core, so expect roughly 20 players there before ticks run late. That's fine for testing with friends; use a paid instance for anything bigger.

## Can it hold 10,000 players at once?

**No, not as built, and no single server process could.** With everyone visible to everyone, 10,000 players would mean about 10,000 × 10,000 × 20 = 2 billion entity updates per second. Real MMOs reach tens of thousands by never letting everyone see everyone, and by spreading players over many processes and machines. Getting there:

1. **Interest caps.** Send each player only the nearest ~100 entities, plus party members, so per-player cost stops growing with the population.
2. **A much larger world split into zones,** with one simulation process per zone or per channel (copies of a busy zone) at roughly 150–200 players each. 10,000 players means about 50–70 zone processes on 10–20 machines.
3. **A gateway** that holds the client connections and routes them to the right zone, with handoff when a player crosses a border. `GameWorld` already owns one simulation and knows nothing about transport, which is the seam for this.
4. **Shared services:** a database for heroes (a `PlayerRepository` adapter for Postgres), and a message bus (Redis or NATS) for cross-zone chat, parties and presence.
5. **A binary protocol** with quantised positions. That's about 3–5 times smaller than JSON, keeping total egress for 10,000 players around 1–2 Gbit/s instead of several times that.
6. **Load tests at each step,** using the same workflow with more bots, and bots spread across machines.

Steps 1, 5 and a single-machine version of 2–4 would take this codebase to a few thousand players. 10,000 concurrent is a multi-machine deployment, not a Render free instance.

## Is WebSocket the right protocol?

For this game today, yes.

| Option | Browser support | Server side (Node) | Hosting (Render) | Fit |
| --- | --- | --- | --- | --- |
| **WebSocket** (current) | Every browser | Mature (`ws`) | Supported | Reliable and ordered. A lost packet briefly holds back later ones, which is acceptable for an RPG. |
| **WebTransport** (HTTP/3, QUIC) | Baseline since Safari 26.4, March 2026 (about 92% of users) | `node:quic` is still experimental and has no WebTransport API | Render forwards HTTPS to the app; WebTransport needs QUIC end to end | Best long-term option: unreliable datagrams for movement, streams for everything else. Revisit when Node or the host supports it, and keep WebSocket as the fallback. |
| **WebRTC data channels** | Every browser | Possible through native add-ons | Needs UDP plus STUN/TURN | Unreliable delivery like UDP, but heavy to operate for a client-server game. |
| **Lockstep / frame sync** | n/a | n/a | n/a | For small RTS/MOBA matches, not MMOs (see ADR 0001). |

What mattered more than the transport was how it is used: update rate, delta encoding, interpolation delay and input queueing (ADR 0007). The transport is isolated behind `Transport` on the client and `ClientLink` on the server, so adding WebTransport later is an adapter on each side, not a rewrite.

## Latency on the live server

Measured with the **Live probe** workflow from a GitHub runner to the Render deployment in Oregon (about 72 ms ping from the runner; lower for players on the US West Coast).

| Measure | Protocol v1 (10 Hz full snapshots) | Protocol v2 (20 Hz deltas) |
| --- | --- | --- |
| Input acknowledged, p50 / p95 | 123 / 172 ms | see the latest Live probe run |
| Another player seen moving (server side) | 167 ms | see the latest Live probe run |
| Client render delay | 200 ms fixed | about 60 ms on a steady connection (adaptive) |
| Snapshot size near town | 7.0 KB | about 1.2 KB |
| Download per player | 69 KB/s | about 21 KB/s |
| Own-movement prediction corrections | 0 | 0 |
