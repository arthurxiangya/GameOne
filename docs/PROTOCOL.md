# Wire protocol (v1)

All messages are JSON text frames on `ws(s)://<host>/ws`, discriminated by the `t` field. Types live in [`packages/shared/src/protocol/messages.ts`](../packages/shared/src/protocol/messages.ts). Client messages are validated by `parseClientMessage`; anything else is rejected with an `error`. Field names are short because snapshots go out ten times a second.

## Handshake

```
client                                   server
  | --- hello {v, token, name} ----------> |
  | <-- welcome {you, seed, progress, …} - |   (or reject {reason} + close)
  | --- input / skill / npc / chat … ----> |
  | <-- snapshot (10/s), progress, chat -- |
```

`token` is a 64-hex-character secret the browser generates once and keeps in `localStorage`. The server stores only its salted hash.

## Client → server

| `t` | Fields | Notes |
| --- | --- | --- |
| `hello` | `v`, `token`, `name` | `v` must equal `PROTOCOL_VERSION`. The name is sanitised to 2–14 letters, numbers, spaces and `_ ' . -`. |
| `input` | `frames: InputFrame[]` (1–10) | Each frame is one `SIM_DT` step: `{seq, fwd, strafe, yaw, jump, swim}`. `fwd` and `strafe` are in [-1, 1], relative to the camera `yaw`. |
| `skill` | `skill`, `target` | `skill` is one of `strike`, `bolt`, `mend`, `ring`, `tonic`. `target` is an entity id or `null` (the server picks the nearest monster in front). |
| `npc` | `npc`, `action` | `maren`: `questAccept`, `questTurnIn`. `oda`: `buyTonic`, `sharpen`. You must stand within 4.5 blocks. |
| `chat` | `text` | Sanitised and capped at 140 characters; at most one every two seconds after a burst of five. |
| `respawn` | — | Only while defeated. |
| `ping` | `at` | Echoed back in `pong` for round-trip measurement. |

## Server → client

| `t` | Fields | Notes |
| --- | --- | --- |
| `welcome` | `v`, `you`, `seed`, `tickRate`, `look`, `progress`, `day`, `dayLength` | `you` is your entity id. Generate the world locally from `seed`. |
| `reject` | `reason` | Sent before the server closes a failed hello (old client, full server, load failure). |
| `snapshot` | `tick`, `st`, `day`, `ack`, `you`, `ents`, `ev` | See below. |
| `progress` | `p` | Your persistent progress, sent whenever it changes. |
| `chat` | `from`, `text` | Broadcast to everyone online. |
| `system` | `text` | Join and leave announcements. |
| `error` | `reason` | A rejected message, or chat sent too fast. Safe to show. |
| `pong` | `at`, `server` | `at` echoed from `ping`. |

### Snapshot

- `st` — server simulation time in seconds, used for interpolation.
- `ack` — the highest input `seq` the server has applied. Replay any later frames on top of `you`.
- `you` — your full-precision physics body plus `hp`, `mhp`, `mp`, `mmp`, `dead`, and `cd` (remaining cooldown per skill).
- `ents` — everyone within the interest radius:
  - Player: `{k:'p', id, x, y, z, yaw, hp, mhp, lv, nm, look, dead}`
  - Monster: `{k:'m', id, x, y, z, yaw, hp, mhp, lv, ty, sc, st}` where `st` is `idle`, `move`, `attack` or `dead`.
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
