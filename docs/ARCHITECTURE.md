# Architecture

## Principles

1. The core package does not import an esport adapter.
2. Provider payloads never cross an adapter boundary unchanged.
3. Every live snapshot includes provenance, source time, observation time, completeness, advancement, and a safety decision.
4. HTTP routes are versioned and dispatch through an adapter registry.
5. The web client consumes normalized API responses only.

## Packages

### `@esports-live/core`

Owns the stable domain model:

- esport, competition, series, game, team, and player identity
- schedule and live-snapshot contracts
- adapter interface and registry
- shared freshness and safety policy

### `@esports-live/adapter-lol`

Owns League of Legends concepts and provider normalization:

- map clock and patch
- team gold and kills
- towers, inhibitors, dragons, barons, heralds, and Void Grubs
- player champion, role, KDA, CS, gold, and items

The adapter accepts an injected provider client. Authentication, endpoint selection, caching, retries, and raw payload parsing belong to the provider implementation—not the core or UI.

## Applications

### `apps/api`

Exposes normalized endpoints:

- `GET /health`
- `GET /v1/esports`
- `GET /v1/:esport/schedule`
- `GET /v1/:esport/games/:gameId/live`

### `apps/web`

Discovers enabled adapters from `/health` and renders normalized responses. It must not call game-provider endpoints directly.

## Adding another esport

1. Define its normalized telemetry types.
2. Define a provider-client boundary.
3. Implement `EsportAdapter<TStats>`.
4. Add adapter contract tests.
5. Register it in the API composition root.
6. Add UI views using normalized API data.
