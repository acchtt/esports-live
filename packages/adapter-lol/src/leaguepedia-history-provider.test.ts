import test from 'node:test';
import assert from 'node:assert/strict';
import type { SeriesHistoryRef, TeamRef } from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSeriesContext,
  LolProviderSnapshot
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

function history(
  winners: readonly (TeamRef | null)[] = [null, null, null],
  durations: readonly (number | null)[] = [null, null, null]
): SeriesHistoryRef {
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
      durationSeconds: durations[index] ?? null
    }))
  };
}

function staleLiveHistory(): SeriesHistoryRef {
  const value = history([left, null, null], [2_527, null, null]);
  const states = ['completed', 'live', 'unstarted'] as const;
  return {
    ...value,
    score: [
      { team: left, wins: 1 },
      { team: right, wins: 0 }
    ],
    games: value.games.map((game, index) => ({ ...game, state: states[index]! }))
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

function baseProvider(value: SeriesHistoryRef, snapshot?: LolProviderSnapshot): LolProviderClient {
  return {
    id: 'riot',
    name: 'Riot Games',
    getSchedule: async () => [schedule],
    getSnapshot: async () => {
      if (snapshot) return snapshot;
      throw new Error('Snapshot not used in this test.');
    },
    getSeriesContext: async () => context(value)
  };
}

function completedSnapshot(): LolProviderSnapshot {
  return {
    series: schedule.series,
    game: schedule.series.games[1]!,
    sourceTimestamp: '2026-08-01T16:49:11.000Z',
    observedAt,
    advancing: false,
    complete: true,
    stats: {
      gameClockSeconds: 2_951,
      patch: '26.15',
      blue: {
        id: right.id,
        name: right.name,
        side: 'blue',
        gold: 61_000,
        kills: 13,
        objectives: {
          towers: 8,
          inhibitors: 1,
          dragons: ['infernal', 'cloud', 'mountain', 'hextech'],
          barons: 1,
          heralds: 0,
          grubs: null
        },
        players: []
      },
      red: {
        id: left.id,
        name: left.name,
        side: 'red',
        gold: 57_000,
        kills: 7,
        objectives: {
          towers: 1,
          inhibitors: 0,
          dragons: ['ocean'],
          barons: 0,
          heralds: 1,
          grubs: null
        },
        players: []
      }
    }
  };
}

function grubsPayload(
  team1 = 'GIANTX Academy',
  team2 = 'SK Gaming Academy',
  gameId = 'leaguepedia-game-2'
) {
  return {
    cargoquery: [{
      title: {
        MatchId: 'lec-week-2-match-1',
        GameId: gameId,
        Team1: team1,
        Team2: team2,
        WinTeam: team2,
        Winner: '2',
        Gamelength: '49:11',
        N_GameInMatch: '2',
        DateTime_UTC: '2026-08-01 16:50:00',
        Team1VoidGrubs: '2',
        Team2VoidGrubs: '4'
      }
    }]
  };
}

function resultRows(winners: readonly TeamRef[]) {
  return {
    cargoquery: winners.map((winner, index) => ({
      title: {
        MatchId: 'lec-week-2-match-1',
        GameId: `leaguepedia-game-${index + 1}`,
        Team1: 'GIANTX',
        Team2: 'SK Gaming',
        WinTeam: winner.name,
        Winner: winner.id === left.id ? '1' : '2',
        Gamelength: `${40 + index}:00`,
        N_GameInMatch: String(index + 1),
        DateTime_UTC: `2026-08-01 ${String(16 + index).padStart(2, '0')}:00:00`
      }
    }))
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
      const where = url.searchParams.get('where') ?? '';
      assert.match(where, /SG\.DateTime_UTC/);
      assert.doesNotMatch(where, /GIANTX/);
      assert.doesNotMatch(where, /SK Gaming/);
      return Response.json({
        cargoquery: [
          {
            title: {
              MatchId: 'lec-week-2-match-1',
              GameId: 'leaguepedia-game-1',
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
              GameId: 'leaguepedia-game-2',
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

test('recovers a stale live series when matched completed games prove the final result', async () => {
  let requests = 0;
  const provider = createLeaguepediaHistoryFallbackProvider(baseProvider(staleLiveHistory()), {
    now: () => new Date(observedAt),
    fetcher: async () => {
      requests += 1;
      return Response.json(resultRows([left, right, right]));
    }
  });

  await provider.getSchedule();
  const result = await provider.getSeriesContext!(schedule.series.id);

  assert.equal(requests, 1);
  assert.deepEqual(result.history?.score.map(entry => entry.wins), [1, 2]);
  assert.deepEqual(result.history?.games.map(game => game.state), ['completed', 'completed', 'completed']);
  assert.deepEqual(result.history?.games.map(game => game.winner?.id ?? null), ['left', 'right', 'right']);
  assert.ok(result.reasons?.some(reason => reason.code === 'history_supplemented'));
});

test('keeps a genuinely active game live when fallback only proves earlier completed games', async () => {
  let requests = 0;
  const provider = createLeaguepediaHistoryFallbackProvider(baseProvider(staleLiveHistory()), {
    now: () => new Date(observedAt),
    fetcher: async () => {
      requests += 1;
      return Response.json(resultRows([left]));
    }
  });

  await provider.getSchedule();
  const result = await provider.getSeriesContext!(schedule.series.id);

  assert.equal(requests, 1);
  assert.deepEqual(result.history?.score.map(entry => entry.wins), [1, 0]);
  assert.equal(result.history?.games[1]?.state, 'live');
  assert.equal(result.history?.games[2]?.state, 'unstarted');
});

test('supplements completed-game Void Grubs despite Leaguepedia team-name drift', async () => {
  let requests = 0;
  const provider = createLeaguepediaHistoryFallbackProvider(
    baseProvider(history([left, right, null], [2_527, 2_951, null]), completedSnapshot()),
    {
      now: () => new Date(observedAt),
      fetcher: async (input, init) => {
        requests += 1;
        const url = new URL(String(input));
        const fields = url.searchParams.get('fields') ?? '';
        const where = url.searchParams.get('where') ?? '';
        assert.match(fields, /SG\.GameId=GameId/);
        assert.match(fields, /SG\.Team1VoidGrubs=Team1VoidGrubs/);
        assert.match(fields, /SG\.Team2VoidGrubs=Team2VoidGrubs/);
        assert.doesNotMatch(where, /GIANTX/);
        assert.doesNotMatch(where, /SK Gaming/);
        assert.equal(new Headers(init?.headers).get('user-agent'), 'esports-live/1.0 (Leaguepedia completed-game enrichment)');
        return Response.json(grubsPayload());
      }
    }
  );

  const result = await provider.getSnapshot('game-2');

  assert.equal(requests, 1);
  assert.equal(result.stats?.blue.id, right.id);
  assert.equal(result.stats?.red.id, left.id);
  assert.equal(result.stats?.blue.objectives.grubs, 4);
  assert.equal(result.stats?.red.objectives.grubs, 2);
});

test('retries a transient Leaguepedia Cargo throttle before giving up Grubs enrichment', async () => {
  let requests = 0;
  const delays: number[] = [];
  const provider = createLeaguepediaHistoryFallbackProvider(
    baseProvider(history([left, right, null], [2_527, 2_951, null]), completedSnapshot()),
    {
      now: () => new Date(observedAt),
      sleep: async delayMs => { delays.push(delayMs); },
      fetcher: async () => {
        requests += 1;
        if (requests === 1) {
          return Response.json({ error: { code: 'ratelimited', info: 'Try again later.' } });
        }
        return Response.json(grubsPayload('GIANTX', 'SK Gaming', 'game-2'));
      }
    }
  );

  const result = await provider.getSnapshot('game-2');

  assert.equal(requests, 2);
  assert.deepEqual(delays, [750]);
  assert.equal(result.stats?.blue.objectives.grubs, 4);
  assert.equal(result.stats?.red.objectives.grubs, 2);
});

test('does not request fallback data when completed games have results and active history is fresh', async () => {
  let requests = 0;
  const provider = createLeaguepediaHistoryFallbackProvider(
    baseProvider(history([left, right, null], [2_527, 2_951, null])),
    {
      now: () => new Date('2026-08-01T17:00:00.000Z'),
      fetcher: async () => { requests += 1; return Response.json({ cargoquery: [] }); }
    }
  );

  const result = await provider.getSeriesContext!(schedule.series.id);

  assert.equal(requests, 0);
  assert.deepEqual(result.history?.games.map(game => game.winner?.id ?? null), ['left', 'right', null]);
});
