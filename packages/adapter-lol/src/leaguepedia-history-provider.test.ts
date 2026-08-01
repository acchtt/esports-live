import test from 'node:test';
import assert from 'node:assert/strict';
import type { SeriesHistoryRef, TeamRef } from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSeriesContext
} from './provider.ts';
import { createLeaguepediaHistoryFallbackProvider } from './leaguepedia-history-provider.ts';

const observedAt = '2026-08-01T17:30:00.000Z';
const left: TeamRef = { id: 'left', name: 'GIANTX', code: 'GX' };
const right: TeamRef = { id: 'right', name: 'SK Gaming', code: 'SK' };

const schedule: LolProviderScheduleEntry = {
  observedAt,
  series: {
    id: 'series-1',
    competition: { id: 'lec', name: 'LEC', stage: 'Week 2' },
    teams: [left, right],
    bestOf: 3,
    state: 'live',
    scheduledStart: '2026-08-01T16:00:00.000Z',
    games: [
      { id: 'game-1', number: 1, state: 'completed' },
      { id: 'game-2', number: 2, state: 'completed' },
      { id: 'game-3', number: 3, state: 'live' }
    ]
  }
};

function history(winners: readonly (TeamRef | null)[] = [null, null, null]): SeriesHistoryRef {
  return {
    bestOf: 3,
    winsRequired: 2,
    drawPossible: false,
    score: [
      { team: left, wins: 1 },
      { team: right, wins: 1 }
    ],
    games: schedule.series.games.map((game, index) => ({
      ...game,
      blueTeam: left,
      redTeam: right,
      winner: winners[index] ?? null,
      durationSeconds: null
    }))
  };
}

function context(value: SeriesHistoryRef): LolProviderSeriesContext {
  return {
    seriesId: schedule.series.id,
    observedAt,
    rosters: [],
    standings: [],
    history: value,
    complete: false,
    reasons: []
  };
}

function baseProvider(value: SeriesHistoryRef): LolProviderClient {
  return {
    id: 'riot',
    name: 'Riot Games',
    getSchedule: async () => [schedule],
    getSnapshot: async () => {
      throw new Error('Snapshot not used in this test.');
    },
    getSeriesContext: async () => context(value)
  };
}

test('supplements ambiguous completed-game winners and durations from Leaguepedia', async () => {
  let requests = 0;
  const provider = createLeaguepediaHistoryFallbackProvider(baseProvider(history()), {
    now: () => new Date(observedAt),
    fetcher: async input => {
      requests += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('action'), 'cargoquery');
      assert.match(url.searchParams.get('where') ?? '', /GIANTX/);
      assert.match(url.searchParams.get('where') ?? '', /SK Gaming/);
      return Response.json({
        cargoquery: [
          {
            title: {
              MatchId: 'lec-week-2-match-1',
              Team1: 'GIANTX',
              Team2: 'SK Gaming',
              WinTeam: 'GIANTX',
              Winner: '1',
              Gamelength: '42:07',
              N_GameInMatch: '1',
              DateTime_UTC: '2026-08-01 16:00:00'
            }
          },
          {
            title: {
              MatchId: 'lec-week-2-match-1',
              Team1: 'GIANTX',
              Team2: 'SK Gaming',
              WinTeam: 'SK Gaming',
              Winner: '2',
              Gamelength: '49:11',
              N_GameInMatch: '2',
              DateTime_UTC: '2026-08-01 16:50:00'
            }
          }
        ]
      });
    }
  });

  await provider.getSchedule();
  const result = await provider.getSeriesContext!(schedule.series.id);

  assert.equal(requests, 1);
  assert.deepEqual(result.history?.games.map(game => game.winner?.id ?? null), ['left', 'right', null]);
  assert.deepEqual(result.history?.games.map(game => game.durationSeconds), [2_527, 2_951, null]);
  assert.ok(result.reasons?.some(reason => reason.code === 'history_supplemented'));
});

test('does not request fallback data when completed games already have results', async () => {
  let requests = 0;
  const provider = createLeaguepediaHistoryFallbackProvider(
    baseProvider(history([left, right, null])),
    { fetcher: async () => { requests += 1; return Response.json({ cargoquery: [] }); } }
  );

  const result = await provider.getSeriesContext!(schedule.series.id);

  assert.equal(requests, 0);
  assert.deepEqual(result.history?.games.map(game => game.winner?.id ?? null), ['left', 'right', null]);
});
