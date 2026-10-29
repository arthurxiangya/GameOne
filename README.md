# Lanternwood Realms

A voxel MMORPG for the browser. An authoritative Node.js game server simulates a floating realm at a fixed tick; players connect over WebSocket with a three.js client that predicts their own movement and interpolates everyone else.

- **Shared world, real players.** Everyone online is in the same realm, sees each other move and fight, and can chat.
- **Five zones and a hub town.** Emberhold, Sunmeadow, Reedmere, Lanternwood, the Amber Dunes and Frostspine Peaks, with leveled monsters and a final boss.
- **Stories.** Four story chains told by seven characters: the main quest to the Warden of the Frost Heart, plus The Drowned Bell, The Lantern Thief and Glass of the Rift, with objectives to defeat, collect, find and talk. Stories are data (`shared/src/game/story.ts`), run by one engine on the server.
- **Daily bounties.** Captain Rook posts three new bounties every day at midnight UTC, the same for everyone, paying gold, XP and Ember Marks.
- **Lantern Night.** Every third night the Night Bell rings and the Gloom marches on Emberhold in five waves, ending with the Gloom Knight. Everyone online defends the Great Lantern together; winners earn Ember Marks, a XP blessing and, after five wins, the Gloom Steed.
- **Rift Trials.** Up to four heroes step into Seer Ilka's stone circle and are taken to a floating rift island: five waves, then the Rift Lord, against the clock, scored on a leaderboard. Rift monsters fight only their own party.
- **Duel Ring.** Challenge another hero to a 90-second, level-matched duel inside a ring. Nobody dies or loses anything; winners climb an Elo rating on the leaderboard.
- **Ember Run.** A time trial through eight checkpoints in every land and back, on foot, judged by the server, with medals and a leaderboard (L).
- **Mounts and pets.** Five mounts (R to ride, up to 80% faster on land) and seven pets that hatch from eggs, level up with you and each give a small bonus (P for the stable).
- **RPG systems.** Four skills, tonics, critical hits, experience and levels up to 20, gold, weapon upgrades, Ember Marks and titles, and a journal (J) that tracks it all.
- **Persistent heroes.** Progress is saved on the server and restored when you return in the same browser.
- **Works on phones.** A touch joystick and skill wheel, tap-to-target, and a smaller draw distance on small screens.
- **Single-player preview.** The same game server can run inside the page, so the game also plays with no server at all.

## Deploy the online server

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/arthurxiangya/GameOne)

The button creates a free Render web service from [render.yaml](render.yaml), building the Dockerfile. When the deploy finishes, open the service's `onrender.com` address on any device; everyone who opens it plays in the same realm.

### Shipping new commits

A service created from the public repository URL is not redeployed by Render when `main` changes. There are two ways to ship:

- **Automatically (one-time setup).** In Render, open the service, then **Settings → Deploy Hook**, and copy the URL. In GitHub, open the repository's **Settings → Secrets and variables → Actions → New repository secret**, name it `RENDER_DEPLOY_HOOK_URL` and paste the URL. From then on, the **Deploy** workflow deploys each push to `main` that passes CI, waits until the live `/healthz` reports that commit, then runs the live probe (bots plus two real browsers) against it.
- **By hand.** In Render, open the service and choose **Manual Deploy → Deploy latest commit**.

`/healthz` shows the protocol version and, on Render, the deployed commit, so you can confirm what's live.

On the free plan the service sleeps after 15 idle minutes (the first visit then takes about a minute to wake it), and its disk is temporary, so heroes reset when it restarts. Use a paid plan with a persistent disk at `/data`, or a database adapter, to keep heroes permanently.

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

### Single-player preview

```bash
npm run build:preview   # packages/client/dist-preview: index.html, standalone.html, game.js
```

The preview runs the authoritative server inside the page and saves the hero in the browser, so it can be hosted on any static file host. three.js loads from the jsDelivr CDN. Any build also switches to single-player with `?offline` in the URL.

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
| `npm run build:preview` | Single-player preview bundle (server runs in the page) |
| `npm run test:browser` | Real-browser checks with Playwright: `online <url>` or `preview <dir>` |

## Configuration

The server reads environment variables (see [.env.example](.env.example)). Invalid values stop startup with a list of every problem.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Where hero save files are written |
| `CLIENT_DIST` | `packages/client/dist` | Built client to serve |
| `WORLD_SEED` | `2026` | Seed for the realm; clients generate the same terrain from it |
| `TICK_RATE` | `20` | Simulation steps per second |
| `SNAPSHOT_EVERY_TICKS` | `1` | Snapshot rate divisor (20 Hz ÷ 1 = 20 snapshots/s) |
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
            game rules (stats, skills, monsters, stories, bounties, economy) and the wire protocol
  server/   Authoritative server, layered as domain → application → infrastructure
  client/   three.js renderer, prediction/interpolation netcode, HUD and input
docs/
  ARCHITECTURE.md   How the system fits together, with diagrams
  PROTOCOL.md       Every message on the wire
  CAPACITY.md       Measured player capacity, latency, and the protocol choice
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

`npm test` runs about 80 tests:

- **Shared:** deterministic world generation, collision physics, protocol validation, game rules and chunk meshing.
- **Server:** combat, stories and bounties, save migration, monster AI, the speed-hack guard, session handling (rate limits, duplicate logins, full server), persistence, and a real WebSocket end-to-end test with two players.
- **Client:** prediction and reconciliation converge with the server, snapshot interpolation, clock sync, and single-player play through the in-page server.

CI also runs real-browser checks in headless Chromium with WebGL: two players join the online build, see each other move and chat, and the single-player preview loads, renders and plays. It then builds the Docker image and checks that the container serves the game.

## License

MIT
