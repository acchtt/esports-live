# External reference review

This project remains a clean-room implementation. External repositories may be reviewed to understand public API behavior and operational failure modes, but their source code, component structure, styles, and naming are not copied.

## AndyDanger/live-lol-esports

Reviewed concepts:

- Riot persisted schedule and event endpoints
- Riot live `window` and `details` endpoints
- 10-second timestamp alignment
- querying behind wall clock when the latest cache key is unavailable
- schedule-to-game navigation and objective-change notifications

Decisions for Esports Live:

- keep API credentials exclusively in the server-side Worker
- use bounded immutable probe plans instead of mutable global delay state
- poll at a controlled client cadence rather than every 500 ms
- classify source freshness independently from request latency
- never infer official outcomes from inhibitors, incomplete series state, or stale telemetry
- keep provider payloads behind the LoL adapter boundary

The reviewed repository is GPL-3.0 licensed. No code from it is incorporated here.

## vickz84259/lolesports-api-docs

Reviewed concepts from the unofficial OpenAPI description:

- persisted endpoints for leagues, schedules, live events, tournaments, standings, completed events, event details, teams, and games
- schedule filters and pagination through `leagueIds` and `pageToken`
- live-stat `window/{gameId}` and `details/{gameId}` routes
- `startingTime` probing and underscore-separated `participantIds`
- documented response shapes for series, games, teams, rosters, standings, streams, VODs, window frames, and participant detail frames
- separation between the persisted Rel API, live-stat feed, and legacy Highlander endpoints

Current alignment:

- the production LoL provider already uses `getSchedule`, `getEventDetails`, `window/{gameId}`, and `details/{gameId}`
- the production provider already sends underscore-separated participant IDs, aligns probes to 10-second boundaries, and treats source freshness separately from request time
- the Worker keeps the persisted API credential server-side while the live-stat feed remains behind the adapter boundary

Candidates for live verification before implementation:

- use `getLive` as a supplemental liveness signal when schedule state appears delayed
- support schedule filtering and pagination without leaking provider-specific tokens into the core model
- use `getTeams` for roster enrichment and `getStandings` for pre-match competition context
- evaluate `getGames` only where it adds information not already available through event details

The OpenAPI repository is an unofficial, alpha-era reference whose latest commit is from 2022. Its documented endpoints and schemas must be verified against current Riot behavior before production use. The repository is MIT licensed. No source or generated schema is incorporated into Esports Live.