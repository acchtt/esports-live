import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry, type EsportAdapter, type LiveSnapshot } from '@esports-live/core';
import { createApiHandler } from './router.ts';

const snapshot: LiveSnapshot = {
  schemaVersion: '1.0',
  esport: 'lol',
  provider: { id: 'test', name: 'Test Provider' },
  series: {
    id: 'series-1',
    esport: 'lol',
    competition: { id: 'lck', name: 'LCK' },
    teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    bestOf: 3,
    state: 'live',
    scheduledStart: '2026-07-31T08:00:00.000Z',
    games: [{ id: 'game-1', number: 1, state: 'live' }]
  },
  game: { id: 'game-1', number: 1, state: 'live' },
  stats: null,
  quality: {
    freshness: 'unavailable',
    sourceTimestamp: null,
    observedAt: '2026-07-31T08:00:00.000Z',
    ageSeconds: null,
    complete: false,
    advancing: null,
    safeForLiveAnalysis: false,
    reasons: []
  }
};

const adapter: EsportAdapter = {
  esport: 'lol',
  providerId: 'test',
  getSchedule: async () => [],
  getLiveSnapshot: async () => snapshot
};

function handler() {
  const registry = new AdapterRegistry();
  registry.register(adapter);
  return createApiHandler(registry);
}

test('health exposes registered esports', async () => {
  const response = await handler()(new Request('https://example.test/health'));
  const payload = await response.json() as { adapters: string[] };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.adapters, ['lol']);
});

test('live route resolves through the esport registry', async () => {
  const response = await handler()(new Request('https://example.test/v1/lol/games/game-1/live'));
  const payload = await response.json() as LiveSnapshot;

  assert.equal(response.status, 200);
  assert.equal(payload.game.id, 'game-1');
  assert.equal(payload.quality.safeForLiveAnalysis, false);
});
