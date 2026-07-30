import test from 'node:test';
import assert from 'node:assert/strict';
import type { EsportAdapter, LiveSnapshot } from './index.ts';
import { CachedAdapter } from './cached-adapter.ts';

const snapshot: LiveSnapshot = {
  schemaVersion: '1.0',
  esport: 'lol',
  provider: { id: 'test', name: 'Test' },
  series: {
    id: 'series',
    esport: 'lol',
    competition: { id: 'league', name: 'League' },
    teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    bestOf: 3,
    state: 'live',
    scheduledStart: '2026-07-31T00:00:00.000Z',
    games: [{ id: 'game', number: 1, state: 'live' }]
  },
  game: { id: 'game', number: 1, state: 'live' },
  stats: null,
  quality: {
    freshness: 'unavailable',
    sourceTimestamp: null,
    observedAt: '2026-07-31T00:00:00.000Z',
    ageSeconds: null,
    complete: false,
    advancing: null,
    safeForLiveAnalysis: false,
    reasons: []
  }
};

test('coalesces concurrent live snapshot requests', async () => {
  let calls = 0;
  const adapter: EsportAdapter = {
    esport: 'lol',
    providerId: 'test',
    getSchedule: async () => [],
    getLiveSnapshot: async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return snapshot;
    }
  };
  const cached = new CachedAdapter(adapter);
  const [left, right] = await Promise.all([
    cached.getLiveSnapshot('game'),
    cached.getLiveSnapshot('game')
  ]);
  assert.equal(calls, 1);
  assert.equal(left, right);
});

test('expires cached snapshots after the configured TTL', async () => {
  let calls = 0;
  let now = 1_000;
  const adapter: EsportAdapter = {
    esport: 'lol',
    providerId: 'test',
    getSchedule: async () => [],
    getLiveSnapshot: async () => {
      calls += 1;
      return snapshot;
    }
  };
  const cached = new CachedAdapter(adapter, { liveSnapshotTtlMs: 100 }, () => now);
  await cached.getLiveSnapshot('game');
  await cached.getLiveSnapshot('game');
  assert.equal(calls, 1);
  now += 101;
  await cached.getLiveSnapshot('game');
  assert.equal(calls, 2);
});