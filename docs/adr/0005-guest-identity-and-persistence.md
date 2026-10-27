# ADR 0005: Guest identity and file-based persistence

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

Players should be able to come back to their hero without creating an account. We need to store a little progress per hero (level, gold, quest state) safely, on one server.

## Decision

- **Identity.** The browser generates a 256-bit random token and keeps it in `localStorage`. The server derives the account id as a salted SHA-256 hash, so save files and logs never contain a usable secret.
- **Sessions.** One active session per account; a second login signs the first out after saving it.
- **Storage.** `PlayerRepository` is a domain port. The default adapter writes one JSON file per hero, atomically (temp file plus rename), with per-account write serialisation and strict validation on load.
- **When we save.** On leave, every 30 seconds, and on graceful shutdown.

## Consequences

- No sign-up friction. Clearing site data, or switching browsers, starts a new hero; that is documented to players.
- File storage suits a single server instance. Multi-instance deployments need a shared database adapter, which is a drop-in thanks to the port.
- Real accounts can be layered on later by replacing the token with a signed identity from an auth service.
