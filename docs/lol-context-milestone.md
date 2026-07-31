# LoL context and schedule milestone

This milestone extends the clean-room Riot provider without changing the live-analysis safety policy.

## Implemented

- `getLive` is used as a supplemental liveness signal when the regular schedule still reports a series as unstarted.
- Supplemental liveness never overrides completed or cancelled series and never replaces `window`/`details` gameplay telemetry.
- The public schedule route supports provider-neutral `limit` and `cursor` pagination.
- Multiple competition filters are accepted through repeated or comma-separated `competitionId`/`competitionIds` parameters.
- The new `GET /v1/:esport/series/:seriesId/context` route exposes cached pre-match rosters and standings.
- Riot event details supply current team IDs and the numeric league ID needed for roster and standings resolution.
- Riot's unfiltered team catalog is coalesced and cached for 15 minutes, then selected teams are matched by exact ID with explicit slug, code, or normalized-name fallbacks.
- Provider roster lists are preserved as roster context; they are not described as confirmed starting lineups.
- Riot standings enrichment resolves the active tournament with `getTournamentsForLeague`, then requests `getStandings`.
- Current schedule win-loss records remain available as an explicit fallback when full rankings cannot be resolved.
- Context failures are partial and explicit; they do not break schedules or live telemetry.
- The web pre-match panel lazily loads context for the selected series and displays available rosters and standings.

## `getGames` decision

The documented `getGames` response contains game ID, state, number, and VOD information. `getEventDetails` already exposes those fields and adds team-side information. No production `getGames` call is added because it would increase upstream requests without adding unique normalized data.

## Production verification

The clean `main` Worker deployment was verified on 2026-07-31:

- health returned HTTP 200 with the LoL adapter active
- the temporary diagnostic route returned HTTP 404
- the schedule reported 80 listings and returned two consecutive 20-event cursor pages
- the tested LCK series BNK FEARX vs DN SOOPers returned a complete context response
- both team roster lists contained 12 provider-listed players
- the response contained 10 ranked standings rows and no quality reasons
- the Cloudflare Pages site returned HTTP 200

## Safety boundary

`window/{gameId}` and `details/{gameId}` remain the only gameplay-stat sources. Fresh, complete, advancing telemetry is still required before a snapshot is marked safe for live analysis.
