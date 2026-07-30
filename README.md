# Esports Live

A provider-neutral live esports platform, beginning with League of Legends.

## Current milestone

The first functional LoL vertical slice is implemented:

- server-side Riot schedule and live-telemetry provider
- bounded live-window probing and explicit source freshness
- normalized series, game, team, objective, and player state
- quality-aware API responses and response headers
- responsive schedule and live analysis workspace
- short-lived request caching and concurrent-request coalescing
- Cloudflare Worker and Pages deployment configuration

Only fresh, complete, advancing telemetry is eligible for live analysis. Partial, delayed, stale, and unavailable states remain visible but are never promoted to verified data.

## Goals

- Normalize schedules, series, games, teams, players, objectives, and telemetry across esports.
- Keep provider-specific behavior behind adapters.
- Expose explicit data-quality and freshness states instead of guessing.
- Separate the public API, web client, and domain model.
- Add new esports without rewriting the core platform.

## Repository layout

```text
apps/
  api/         HTTP API and Cloudflare Worker composition
  web/         Browser client
packages/
  core/        Shared domain contracts, quality rules, and caching
  adapter-lol/ League of Legends provider boundary and Riot implementation
docs/
  architecture.md
  data-quality.md
  deployment.md
  reference-review.md
```

## Development

```bash
npm install
npm run check
npm run dev:api
npm run dev:web
```

Copy `.dev.vars.example` to `.dev.vars` for local API development. Configure `VITE_API_BASE_URL` in `apps/web/.env` when the web client and API use different origins.

## Deployment

Cloudflare releases are manual through the **Deploy Cloudflare** GitHub Actions workflow. See `docs/deployment.md` for one-time secret, Worker, Pages, and repository-variable setup.

## Clean-room policy

This repository is a clean-room rebuild. No source code is copied from the archived LoL Live Analyzer project or reviewed third-party projects.