# LoL context and schedule milestone

This milestone extends the clean-room Riot provider without changing the live-analysis safety policy.

## Implemented

- `getLive` is used as a supplemental liveness signal when the regular schedule still reports a series as unstarted.
- Supplemental liveness never overrides completed or cancelled series and never replaces `window`/`details` gameplay telemetry.
- The public schedule route supports provider-neutral `limit` and `cursor` pagination.
- Multiple competition filters are accepted through repeated or comma-separated `competitionId`/`competitionIds` parameters.
- The new `GET /v1/:esport/series/:seriesId/context` route exposes cached pre-match rosters and standings.
- Riot roster enrichment uses `getTeams` only for the selected series.
- Riot standings enrichment resolves the active tournament with `getTournamentsForLeague`, then requests `getStandings`.
- Context failures are partial and explicit; they do not break schedules or live telemetry.
- The web pre-match panel lazily loads context for the selected series and displays available rosters and standings.

## `getGames` decision

The documented `getGames` response contains game ID, state, number, and VOD information. `getEventDetails` already exposes those fields and adds team-side information. No production `getGames` call is added because it would increase upstream requests without adding unique normalized data.

## Safety boundary

`window/{gameId}` and `details/{gameId}` remain the only gameplay-stat sources. Fresh, complete, advancing telemetry is still required before a snapshot is marked safe for live analysis.
