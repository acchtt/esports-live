import test from 'node:test';
import assert from 'node:assert/strict';
import { LolAdapter } from './adapter.ts';
import type { LolProviderClient, LolProviderSeries } from './provider.ts';
import type { LolStats } from './types.ts';

const series: LolProviderSeries = {
  id: 'series-1',
  competition: { id: 'lck', name: 'LCK', region: 'KR' },
  teams: [
    { id: 'team-a', name: 'Team A', code: 'A' },
    { id: 'team-b', name: 'Team B', code: 'B' }
  ],
  bestOf: 3,
  state: 'live',
  scheduledStart: '2026-07-31T08:00:00.000Z',
  games: [{ id: 'game-1', number: 1, state: 'live' }],
  score: [1, 0]
};

const stats: LolStats = {
  gameClockSeconds: 600,
  patch: '26.14',
  blue: {
    id: 'team-a',
    name: 'Team A',
    side: 'blue',
    gold: 18000,
    kills: 3,
    objectives: { towers: 1, inhibitors: 0, dragons: ['infernal'], barons: 0, heralds: 1, grubs: 4 },
    players: []
  },
  red: {
    id: 'team-b',
    name: 'Team B',
    side: 'red',
    gold: 17500,
    kills: 2,
    objectives: { towers: 0, inhibitors: 0, dragons: [], barons: 0, heralds: 0, grubs: 2 },
    players: []
  }
};

function provider(overrides: Partial<LolProviderClient> = {}): LolProviderClient {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    getSchedule: async () => [{ series, observedAt: '2026-07-31T08:10:00.000Z' }],
    getSnapshot: async () => ({
      series,
      game: series.games[0]!,
      sourceTimestamp: '2026-07-31T08:09:50.000Z',
      observedAt: '2026-07-31T08:10:00.000Z',
      advancing: true,
      complete: true,
      stats
    }),
    ...overrides
  };
}

test('LoL adapter emits normalized fresh snapshots', async () => {
  const adapter = new LolAdapter(provider());
  const snapshot = await adapter.getLiveSnapshot('game-1');

  assert.equal(snapshot.esport, 'lol');
  assert.equal(snapshot.game.id, 'game-1');
  assert.equal(snapshot.quality.freshness, 'fresh');
  assert.equal(snapshot.quality.safeForLiveAnalysis, true);
  assert.deepEqual(snapshot.series.score?.map(entry => entry.wins), [1, 0]);
});

test('LoL adapter rejects incomplete snapshots for live analysis', async () => {
  const adapter = new LolAdapter(provider({
    getSnapshot: async () => ({
      series,
      game: series.games[0]!,
      sourceTimestamp: '2026-07-31T08:09:50.000Z',
      observedAt: '2026-07-31T08:10:00.000Z',
      advancing: true,
      complete: false,
      stats
    })
  }));

  const snapshot = await adapter.getLiveSnapshot('game-1');
  assert.equal(snapshot.quality.freshness, 'fresh');
  assert.equal(snapshot.quality.safeForLiveAnalysis, false);
});
