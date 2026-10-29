# Wire protocol (v7)

All messages are JSON text frames on `ws(s)://<host>/ws`, discriminated by the `t` field. Types live in [`packages/shared/src/protocol/messages.ts`](../packages/shared/src/protocol/messages.ts). Client messages are validated by `parseClientMessage`; anything else is rejected with an `error`. Field names are short because snapshots go out twenty times a second.

## Handshake

```
client                                   server
  | --- hello {v, token, name} ----------> |
  | <-- welcome {you, seed, progress, …} - |   (or reject {reason} + close)
  | --- input / skill / npc / chat … ----> |
  | <-- snapshot (20/s), progress, chat -- |
```

`token` is a 64-hex-character secret the browser generates once and keeps in `localStorage`. The server stores only its salted hash.

## Client → server

| `t` | Fields | Notes |
| --- | --- | --- |
| `hello` | `v`, `token`, `name` | `v` must equal `PROTOCOL_VERSION`. The name is sanitised to 2–14 letters, numbers, spaces and `_ ' . -`. |
| `input` | `frames: InputFrame[]` (1–10) | Each frame is one `SIM_DT` step: `{seq, fwd, strafe, yaw, jump, swim}`. `fwd` and `strafe` are in [-1, 1], relative to the camera `yaw`. |
| `skill` | `skill`, `target` | `skill` is one of `strike`, `bolt`, `mend`, `ring`, `tonic`. `target` is an entity id or `null` (the server picks the nearest monster in front). |
| `npc` | `npc`, `action`, `arg` | You must stand within 4.5 blocks of the character. `greet` opens a conversation (it counts for bounties). `accept`, `turnIn` and `talk` take a story chain id in `arg` (`main`, `bell`, `thief`, `rift`); the server checks that this character gives, takes back or is the subject of that step. `buyTonic` and `sharpen` need a character with the forge (Oda); `buy` needs one who trades and takes an item id in `arg` (see `SHOP_ITEMS`). `race` starts an Ember Run at Pip the Runner. `rift` asks Seer Ilka to open a rift (level 6 and up). `arg` is `null` otherwise. |
| `title` | `title` | Show one of your earned titles under your name, or `null` for none. |
| `mount` | `on` | `true` calls your chosen mount (1.5 s; not within 5 s of combat), `false` gets off. Using a skill or taking damage also puts you on foot. |
| `choose` | `kind`, `id` | `kind: 'mount'` picks which owned mount R calls; `kind: 'pet'` picks which owned pet follows you. `id` may be `null`. |
| `petName` | `pet`, `name` | Renames an owned pet; the name is sanitised like a hero name. |
| `quit` | — | Gives up the current mode activity, such as an Ember Run. |
| `boards` | — | Asks for the leaderboards; answered with `boards`. |
| `chat` | `text` | Sanitised and capped at 140 characters; at most one every two seconds after a burst of five. |
| `respawn` | — | Only while defeated. |
| `ping` | `at` | Echoed back in `pong` for round-trip measurement. |

## Server → client

| `t` | Fields | Notes |
| --- | --- | --- |
| `welcome` | `v`, `you`, `seed`, `tickRate`, `look`, `progress`, `day`, `dayLength` | `you` is your entity id. Generate the world locally from `seed`. |
| `reject` | `reason` | Sent before the server closes a failed hello (old client, full server, load failure). |
| `snapshot` | `tick`, `st`, `day`, `ack`, `you`, `ents`, `ev` | See below. |
| `mode` | `m` | Your mode state changed, or `null`. Ember Run: `{kind: 'race', phase, startsAt, next, total}` (`startsAt` is server time; `next` indexes `coursePoints`). Rift Trial: `{kind: 'rift', phase, wave, waves, endsAt, deadline, remaining, party, score}` with `phase` one of `gathering`, `starting`, `wave`, `break`, `done`, `failed`. |
| `boards` | `boards` | The leaderboards: `{id, entries: [{name, value, at, detail?}]}` for `race` (seconds, lower is better), `rift` and `duel`. |
| `siege` | `s` | Lantern Night, sent to everyone: `{phase, wave, waves, lantern, lanternMax, remaining, endsAt, gates}` while a siege is on (`phase` is `warning`, `wave`, `break`, `won` or `lost`; `gates` index the generated `siegeGates`), and `null` when it clears. Sent on join if one is on; Lantern health updates at most 4 times a second. |
| `progress` | `p` | Your persistent progress, sent whenever it changes: level, gold and tonics, each story chain's step and state, today's bounties, Ember Marks and titles. Bounties are sent as ids; `bountyFromId` in `shared` rebuilds them. |
| `chat` | `from`, `text` | Broadcast to everyone online. |
| `system` | `text` | Join and leave announcements. |
| `error` | `reason` | A rejected message, or chat sent too fast. Safe to show. |
| `pong` | `at`, `server` | `at` echoed from `ping`. |

### Snapshot

- `st` — server simulation time in seconds, used for interpolation.
- `ack` — the highest input `seq` the server has applied. Replay any later frames on top of `you`.
- `you` — your full-precision physics body plus `hp`, `mhp`, `mp`, `mmp`, `dead`, `cd` (remaining cooldown per skill), `mt` (the mount you ride, or `null`) and `call` (seconds left calling a mount). Predict movement with `stepPlayer(..., mountSpeed(mt))`.
- `ents` — delta-encoded entities within the interest radius. The first time an entity is sent to you it arrives in full:
  - Player: `{k:'p', id, x, y, z, yaw, hp, mhp, lv, nm, look, dead, ti, mt, pet}` where `ti` is the title shown under the name, `mt` the mount being ridden and `pet` the pet following them (each `null` if none). Clients draw the pet trailing its hero; the server never simulates it.
  - Monster: `{k:'m', id, x, y, z, yaw, hp, mhp, lv, ty, sc, st}` where `st` is `idle`, `move`, `attack` or `dead`. `ty` includes the Gloom (`wisp`, `shade`, `gloomknight`), which only appear on Lantern Night and are removed after their death animation.

  After that, only `id` plus the fields that changed since your previous snapshot are sent (for example `{id: 12, x: 4.31, z: -7.02}`). An entity that changed nothing is left out entirely. Apply patches on top of the known state (`applyEntityUpdates` in `shared`).
- `gone` — ids of entities that left your area of interest or despawned. Forget them.
- `ev` — events since your last snapshot:

| `e` | Fields | Meaning |
| --- | --- | --- |
| `dmg` | `id`, `amt`, `crit` | Entity took damage |
| `heal` | `id`, `amt` | Entity healed |
| `die` | `id` | Entity died |
| `lvl` | `id`, `lv` | Player levelled up |
| `swing` / `cast` | `id` | Attack animations |
| `bolt` | `from`, `to`, `flight` | Ember Bolt in flight; damage arrives after `flight` seconds |
| `ring` | `id`, `r` | Flame Ring around a player |
| `slamWarn` | `x`, `y`, `z`, `r`, `delay` | Boss slam incoming: leave the circle |
| `slam` | `x`, `y`, `z`, `r` | Boss slam landed |
| `xp` | `amt` | You gained experience (private) |
| `target` | `id` | The server picked a target for you (private) |
| `log` | `text`, `c` | Message log line; `c` is `sys`, `foe`, `loot` or `good` (private) |
| `toast` | `text` | Short on-screen notice, e.g. why an action failed (private) |
| `respawned` | `fell` | You were moved to town (private) |
| `story` | `title`, `text` | You completed a story step; `text` is what the character says (private) |
| `banner` | `title`, `text` | Something worth a big banner, such as a new mount or a hatched pet (private) |

## Close codes

| Code | Meaning |
| --- | --- |
| 1000 | Normal close |
| 4001 | Server restarting (progress saved) |
| 4400 | Too many invalid messages |
| 4403 | Rejected (outdated client, or load failure) |
| 4409 | Signed in from another window |
| 4503 | Realm full |

## Versioning

Any incompatible change bumps `PROTOCOL_VERSION`. Older clients are rejected at `hello` with a "please refresh" message instead of misbehaving.

| Version | Change |
| --- | --- |
| 1 | First release: full snapshots at 10/s |
| 2 | Delta snapshots (`ents` patches and `gone`) at 20/s |
| 3 | Story chains, daily bounties, Ember Marks and titles: `npc` gains `arg`, new `title` message, `ti` on players, `story` event |
| 4 | Mounts and pets: `mount`, `choose` and `petName` messages; `mt` and `call` in `you`; `mt` and `pet` on players; `banner` event |
| 5 | Ember Run and leaderboards: `npc` action `race`, `quit` and `boards` messages, `mode` and `boards` replies |
| 6 | Lantern Night: `siege` broadcast, Gloom monster types, story `event` objectives |
| 7 | Rift Trials: `npc` action `rift`, `rift` mode state, the `riftlord` monster |
