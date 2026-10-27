# Lanternwood Realms

A voxel MMORPG for the browser. An authoritative Node.js game server simulates a floating realm at a fixed tick; players connect over WebSocket with a three.js client that predicts their own movement and interpolates everyone else.

- **Shared world, real players.** Everyone online is in the same realm, sees each other move and fight, and can chat.
- **Five zones and a hub town.** Emberhold (quests and a shop), Sunmeadow, Reedmere, Lanternwood, the Amber Dunes and Frostspine Peaks, with leveled monsters and a final boss.
- **RPG systems.** Four skills, tonics, critical hits, experience and levels up to 20, gold, weapon upgrades and a six-quest chain.
- **Persistent heroes.** Progress is saved on the server and restored when you return in the same browser.
- **Works on phones.** A touch joystick and skill wheel, tap-to-target, and a smaller draw distance on small screens.

## Quick start

Requires Node.js 20.11 or newer.

```bash
npm install
npm run dev
```

`npm run dev` starts the game server on port 8080 and the Vite dev server on port 5173. Open http://localhost:5173 in two browser windows to see multiplayer working. The Vite server proxies `/ws` to the game server, so the browser only ever talks to one origin.

### Production

```bash
npm run build      # builds packages/client/dist and packages/server/dist
npm start          # one process serves the client, the WebSocket and /healthz on :8080
```

Or with Docker:

```bash
docker compose up --build
```

Hero saves live in the `game-data` volume (`/data` in the container).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (auto-reloading) plus the Vite client with hot reload |
| `npm run build` | Production client bundle and single-file server bundle |
| `npm start` | Runs the built server |
| `npm test` | Unit, integration and end-to-end tests (Node's built-in test runner) |
| `npm run typecheck` | Strict TypeScript checks for all three packages |
| `npm run lint` | ESLint, including the architecture import rules |
| `npm run check` | Typecheck, lint and test, as CI does |

## Configuration

The server reads environment variables (see [.env.example](.env.example)). Invalid values stop startup with a list of every problem.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Where hero save files are written |
| `CLIENT_DIST` | `packages/client/dist` | Built client to serve |
| `WORLD_SEED` | `2026` | Seed for the realm; clients generate the same terrain from it |
| `TICK_RATE` | `20` | Simulation steps per second |
| `SNAPSHOT_EVERY_TICKS` | `2` | Snapshot rate divisor (20 Hz ÷ 2 = 10 snapshots/s) |
| `MAX_PLAYERS` | `64` | Concurrent heroes |
| `INTEREST_RADIUS` | `80` | Blocks; entities further away are not sent |
| `AUTOSAVE_SECONDS` | `30` | Periodic save interval |
| `DAY_LENGTH_SECONDS` | `480` | One full day–night cycle |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `ALLOWED_ORIGINS` | *(any)* | Comma-separated WebSocket origin allow-list |
| `TOKEN_SALT` | `lanternwood-realms` | Salt for hashing guest tokens; keep stable |

## Project layout

```
packages/
  shared/   Pure TypeScript used by both sides: world generation, mesher, physics,
            game rules (stats, skills, monsters, quests, economy) and the wire protocol
  server/   Authoritative server, layered as domain → application → infrastructure
  client/   three.js renderer, prediction/interpolation netcode, HUD and input
docs/
  ARCHITECTURE.md   How the system fits together, with diagrams
  PROTOCOL.md       Every message on the wire
  adr/              Architecture decision records
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing code. It explains the layering rules that ESLint enforces.

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | WASD or arrow keys | Left joystick |
| Look and zoom | Drag, scroll wheel | Drag, pinch |
| Target a monster | Click it, or Tab to cycle | Tap it |
| Strike (hold to repeat), Ember Bolt, Mend, Flame Ring | 1, 2, 3, 4 | Skill wheel |
| Healing tonic | Q | Flask button |
| Jump or swim up | Space | Jump button |
| Talk to an NPC | E, or click them | Talk button, or tap them |
| Chat | Enter | Speech bubble button |

## Testing

`npm test` runs about 75 tests:

- **Shared:** deterministic world generation, collision physics, protocol validation, game rules and chunk meshing.
- **Server:** combat, quests, monster AI, the speed-hack guard, session handling (rate limits, duplicate logins, full server), persistence, and a real WebSocket end-to-end test with two players.
- **Client:** prediction and reconciliation converge with the server, plus snapshot interpolation and clock sync.

## License

MIT
