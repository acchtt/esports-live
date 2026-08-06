import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderClient, LolProviderScheduleEntry } from './provider.ts';
import { RIOT_LPL_LEAGUE_ID } from './riot-supplemental-league-provider.ts';
import { createUsableScheduleProvider } from './usable-schedule-provider.ts';

const observedAt = '2026-08-01T13:00:00.000Z';
const left = { id: 'real-left', name: 'Real Left' };
const right = { id: 'real-right', name: 'Real Right' };

function sparseEntry(state: 'live' | 'scheduled' = 'live'): LolProviderScheduleEntry {
  return {
    observedAt,
    series: {
      id: 'series-1',
      competition: { id: 'lcp', name: 'LCP' },
      teams: [
        { id: 'team-1', name: 'Team 1' },
        { id: 'team-2', name: 'Team 2' }
      ],
      bestOf: 1,
      state,
      scheduledStart: observedAt,
      games: []
    }
  };
}

function baseProvider(entry: LolProviderScheduleEntry, withHistory: boolean): LolProviderClient {
  return {
    id: 'test',
    name: 'Test provider',
    async getSchedule() {
      return [entry];
    },
    async getSnapshot() {
      throw new Error('unused');
    },
    async getSeriesContext(seriesId) {
      return {
        seriesId,
        observedAt,
        rosters: [],
        standings: [],
        ...(withHistory ? {
          history: {
            bestOf: 3,
            winsRequired: 2,
            drawPossible: false,
            score: [
              { team: left, wins: 0 },
              { team: right, wins: 0 }
            ],
            games: [{
              id: 'game-1',
              number: 1,
              state: 'live',
              blueTeam: left,
              redTeam: right,
              winner: null,
              durationSeconds: null
            }]
          }
        } : {}),
        complete: withHistory
      };
    }
  };
}

function delayedLiveProvider(): LolProviderClient {
  const provider = baseProvider(sparseEntry(), true);
  provider.getSeriesContext = async seriesId => ({
    seriesId,
    observedAt,
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [{ team: left, wins: 1 }, { team: right, wins: 0 }],
      games: [
        { id: 'game-1', number: 1, state: 'completed', blueTeam: left, redTeam: right, winner: left, durationSeconds: null },
        { id: 'game-2', number: 2, state: 'unstarted', blueTeam: right, redTeam: left, winner: null, durationSeconds: null },
        { id: 'game-3', number: 3, state: 'unstarted', blueTeam: left, redTeam: right, winner: null, durationSeconds: null }
      ]
    },
    complete: true
  });
  return provider;
}

function staleCompletedLplProvider(): {
  provider: LolProviderClient;
  entry: LolProviderScheduleEntry;
} {
  const entry = sparseEntry('scheduled');
  entry.series.id = 'series-lpl-stale-completed';
  entry.series.competition = { id: RIOT_LPL_LEAGUE_ID, name: 'LPL' };
  entry.series.teams = [left, right];
  entry.series.bestOf = 3;
  entry.series.state = 'completed';
  entry.series.games = [
    { id: 'game-1', number: 1, state: 'completed' }
  ];
  const provider = baseProvider(entry, true);
  provider.getSeriesContext = async seriesId => ({
    seriesId,
    observedAt,
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [{ team: left, wins: 1 }, { team: right, wins: 0 }],
      games: [
        { id: 'game-1', number: 1, state: 'completed', blueTeam: left, redTeam: right, winner: left, durationSeconds: 2_100 },
        { id: 'game-2', number: 2, state: 'unstarted', blueTeam: right, redTeam: left, winner: null, durationSeconds: null },
        { id: 'game-3', number: 3, state: 'unstarted', blueTeam: left, redTeam: right, winner: null, durationSeconds: null }
      ]
    },
    complete: true
  });
  return { provider, entry };
}

test('enriches a sparse live event from series history', async () => {
  const provider = createUsableScheduleProvider(baseProvider(sparseEntry(), true));
  const schedule = await provider.getSchedule();

  assert.equal(schedule.length, 1);
  assert.equal(schedule[0]?.series.teams[0].name, 'Real Left');
  assert.equal(schedule[0]?.series.teams[1].name, 'Real Right');
  assert.equal(schedule[0]?.series.bestOf, 3);
  assert.equal(schedule[0]?.series.games[0]?.id, 'game-1');
});

test('retains real team names when Riot only supplies fallback team IDs', async () => {
  const fallbackLeft = { id: 'team-1', name: 'GIANTX', code: 'GX' };
  const fallbackRight = { id: 'team-2', name: 'SK Gaming', code: 'SK' };
  const provider = baseProvider(sparseEntry(), true);
  provider.getSeriesContext = async seriesId => ({
    seriesId,
    observedAt,
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: fallbackLeft, wins: 1 },
        { team: fallbackRight, wins: 1 }
      ],
      games: [{
        id: 'game-3',
        number: 3,
        state: 'live',
        blueTeam: fallbackLeft,
        redTeam: fallbackRight,
        winner: null,
        durationSeconds: null
      }]
    },
    complete: true
  });

  const schedule = await createUsableScheduleProvider(provider).getSchedule();

  assert.equal(schedule.length, 1);
  assert.equal(schedule[0]?.series.teams[0].name, 'GIANTX');
  assert.equal(schedule[0]?.series.teams[1].name, 'SK Gaming');
  assert.equal(schedule[0]?.series.games[0]?.id, 'game-3');
});

test('suppresses a live placeholder that cannot be resolved', async () => {
  const provider = createUsableScheduleProvider(baseProvider(sparseEntry(), false));
  assert.deepEqual(await provider.getSchedule(), []);
});

test('keeps a real-team event scheduled while Riot game IDs are pending', async () => {
  const entry = sparseEntry();
  entry.series.teams = [
    { id: 'team-a', name: 'Anyone’s Legend', code: 'AL' },
    { id: 'team-b', name: 'Bilibili Gaming', code: 'BLG' }
  ];
  const provider = createUsableScheduleProvider(baseProvider(entry, false));

  const schedule = await provider.getSchedule();

  assert.equal(schedule.length, 1);
  assert.equal(schedule[0]?.series.state, 'scheduled');
  assert.equal(schedule[0]?.series.teams[0].name, 'Anyone’s Legend');
  assert.deepEqual(schedule[0]?.series.games, []);
});

test('retains scheduled entries before Riot publishes game IDs', async () => {
  let contextCalls = 0;
  const base = baseProvider(sparseEntry('scheduled'), false);
  const getSeriesContext = base.getSeriesContext!;
  base.getSeriesContext = async seriesId => {
    contextCalls += 1;
    return getSeriesContext(seriesId);
  };

  const schedule = await createUsableScheduleProvider(base).getSchedule();
  assert.equal(schedule.length, 1);
  assert.equal(contextCalls, 0);
});

test('demotes stale LPL live metadata when no game has active telemetry', async () => {
  const base = delayedLiveProvider();
  const snapshotCalls: string[] = [];
  base.getSnapshot = async gameId => {
    snapshotCalls.push(gameId);
    return {
      series: sparseEntry().series,
      game: {
        id: gameId,
        number: gameId === 'game-3' ? 3 : 2,
        state: 'unstarted'
      },
      sourceTimestamp: null,
      observedAt,
      advancing: false,
      complete: false,
      stats: null
    };
  };

  const schedule = await createUsableScheduleProvider(base).getSchedule();

  assert.deepEqual(snapshotCalls, ['game-2', 'game-3']);
  assert.equal(schedule[0]?.series.state, 'scheduled');
  assert.equal(schedule[0]?.series.games.some(game => (
    game.state === 'live' || game.state === 'draft' || game.state === 'paused'
  )), false);
});

test('removes a stale live listing when the active game is already completed', async () => {
  const entry = sparseEntry();
  entry.series.teams = [left, right];
  entry.series.games = [{ id: 'game-1', number: 1, state: 'live' }];
  const base = baseProvider(entry, false);
  base.getSnapshot = async gameId => ({
    series: entry.series,
    game: { id: gameId, number: 1, state: 'completed' },
    sourceTimestamp: observedAt,
    observedAt,
    advancing: false,
    complete: true,
    stats: {} as never
  });

  const schedule = await createUsableScheduleProvider(base).getSchedule();

  assert.equal(schedule[0]?.series.state, 'completed');
  assert.equal(schedule[0]?.series.games[0]?.state, 'completed');
});

test('promotes an unstarted LPL game when the live-stat feed has gameplay', async () => {
  const base = delayedLiveProvider();
  const snapshotCalls: string[] = [];
  base.getSnapshot = async gameId => {
    snapshotCalls.push(gameId);
    return {
      series: sparseEntry().series,
      game: { id: gameId, number: 2, state: 'live' },
      sourceTimestamp: observedAt,
      observedAt,
      advancing: null,
      complete: false,
      stats: {} as never
    };
  };

  const schedule = await createUsableScheduleProvider(base).getSchedule();
  assert.deepEqual(snapshotCalls, ['game-2']);
  assert.equal(schedule[0]?.series.state, 'live');
  assert.equal(schedule[0]?.series.games[1]?.state, 'live');
});

test('tries the next unpublished game slot after a live-stat miss', async () => {
  const base = delayedLiveProvider();
  const snapshotCalls: string[] = [];
  base.getSnapshot = async gameId => {
    snapshotCalls.push(gameId);
    return {
      series: sparseEntry().series,
      game: { id: gameId, number: gameId === 'game-3' ? 3 : 2, state: gameId === 'game-3' ? 'live' : 'unstarted' },
      sourceTimestamp: gameId === 'game-3' ? observedAt : null,
      observedAt,
      advancing: null,
      complete: false,
      stats: gameId === 'game-3' ? {} as never : null
    };
  };

  const schedule = await createUsableScheduleProvider(base).getSchedule();
  assert.deepEqual(snapshotCalls, ['game-2', 'game-3']);
  assert.equal(schedule[0]?.series.state, 'live');
  assert.equal(schedule[0]?.series.games[2]?.state, 'live');
});

test('rescues a recent LPL series misclassified as completed when the next game is live', async () => {
  const { provider, entry } = staleCompletedLplProvider();
  const snapshotCalls: string[] = [];
  provider.getSnapshot = async gameId => {
    snapshotCalls.push(gameId);
    return {
      series: entry.series,
      game: { id: gameId, number: gameId === 'game-3' ? 3 : 2, state: 'live' },
      sourceTimestamp: '2026-08-01T13:45:00.000Z',
      observedAt: '2026-08-01T13:45:01.000Z',
      advancing: true,
      complete: true,
      stats: {} as never
    };
  };

  const schedule = await createUsableScheduleProvider(provider, {
    now: () => new Date('2026-08-01T14:00:00.000Z')
  }).getSchedule();

  assert.deepEqual(snapshotCalls, ['game-2']);
  assert.equal(schedule[0]?.series.state, 'live');
  assert.equal(schedule[0]?.series.games[0]?.state, 'completed');
  assert.equal(schedule[0]?.series.games[1]?.id, 'game-2');
  assert.equal(schedule[0]?.series.games[1]?.state, 'live');
});

test('keeps a recent completed LPL series ended when no unfinished game has telemetry', async () => {
  const { provider, entry } = staleCompletedLplProvider();
  const snapshotCalls: string[] = [];
  provider.getSnapshot = async gameId => {
    snapshotCalls.push(gameId);
    return {
      series: entry.series,
      game: {
        id: gameId,
        number: gameId === 'game-3' ? 3 : 2,
        state: 'unstarted'
      },
      sourceTimestamp: null,
      observedAt: '2026-08-01T13:45:01.000Z',
      advancing: false,
      complete: false,
      stats: null
    };
  };

  const schedule = await createUsableScheduleProvider(provider, {
    now: () => new Date('2026-08-01T14:00:00.000Z')
  }).getSchedule();

  assert.deepEqual(snapshotCalls, ['game-2', 'game-3']);
  assert.equal(schedule[0]?.series.state, 'completed');
  assert.deepEqual(schedule[0]?.series.games, entry.series.games);
});
