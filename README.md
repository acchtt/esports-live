# Esports Live

A provider-neutral live esports platform, beginning with League of Legends.

## Goals

- Normalize schedules, series, games, teams, players, objectives, and telemetry across esports.
- Keep provider-specific behavior behind adapters.
- Expose explicit data-quality and freshness states instead of guessing.
- Separate the public API, web client, and domain model.
- Add new esports without rewriting the core platform.

## Initial scope

Version 1 supports League of Legends through a dedicated adapter. The core contracts are intentionally game-agnostic so CS2, Dota 2, and other titles can be added later.

## Repository layout

```text
apps/
  api/       HTTP API service
  web/       Browser client
packages/
  core/      Shared domain contracts and quality rules
  adapter-lol/ League of Legends provider adapter
```

## Development

```bash
npm install
npm run typecheck
npm test
```

This repository is a clean-room rebuild. No source code is copied from the archived LoL Live Analyzer project.
