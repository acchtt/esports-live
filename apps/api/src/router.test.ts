import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdapterRegistry,
  type EsportAdapter,
  type LiveSnapshot,
  type ScheduleEvent,
  type SeriesContext
} from '@esports-live/core';
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

const context: SeriesContext = {
  schemaVersion: '1.0',
  esport: 'lol',
  seriesId: 'series-1',
  provider: { id: 'test', name: 'Test Provider' },
  observedAt: '2026-07-31T08:00:00.000Z',
  rosters: [],
  standings: [],
  complete: false,
  reasons: [{ code: 'test_context', message: 'Context fixture.' }]
};

const adapter: EsportAdapter = {
  esport: 'lol',
  providerId: 'test',
  getSchedule: async () => [],
  getLiveSnapshot: async () => snapshot,
  getSeriesContext: async () => context
};

function handler(customAdapter: EsportAdapter = adapter) {
  const registry = new AdapterRegistry();
  registry.register(customAdapter);
  return createApiHandler(registry);
}

function scheduleEvents(count: number): readonly ScheduleEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    series: {
      ...snapshot.series,
      id: `series-${index + 1}`,
      scheduledStart: new Date(Date.parse(snapshot.series.scheduledStart) + index * 60_000).toISOString()
    },
    provider: snapshot.provider,
    observedAt: '2026-07-31T08:00:00.000Z'
  }));
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

test('batch live route returns schedule and snapshots in one request', async () => {
  let scheduleCalls = 0;
  let snapshotCalls = 0;
  const batchAdapter: EsportAdapter = {
    ...adapter,
    getSchedule: async () => {
      scheduleCalls += 1;
      return scheduleEvents(1);
    },
    getLiveSnapshot: async () => {
      snapshotCalls += 1;
      return snapshot;
    }
  };
  const response = await handler(batchAdapter)(new Request('https://example.test/v1/lol/live'));
  const payload = await response.json() as {
    events: ScheduleEvent[];
    snapshots: LiveSnapshot[];
    partial: boolean;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.snapshots.length, 1);
  assert.equal(payload.partial, false);
  assert.equal(scheduleCalls, 1);
  assert.equal(snapshotCalls, 1);
});

test('schedule route uses provider-neutral cursors', async () => {
  const pagedAdapter: EsportAdapter = {
    ...adapter,
    getSchedule: async () => scheduleEvents(5)
  };
  const firstResponse = await handler(pagedAdapter)(
    new Request('https://example.test/v1/lol/schedule?limit=2')
  );
  const first = await firstResponse.json() as {
    events: ScheduleEvent[];
    page: { total: number; nextCursor: string | null };
  };

  assert.equal(firstResponse.status, 200);
  assert.equal(first.events.length, 2);
  assert.equal(first.events[0]?.series.id, 'series-1');
  assert.equal(first.page.total, 5);
  assert.ok(first.page.nextCursor);

  const secondResponse = await handler(pagedAdapter)(
    new Request(`https://example.test/v1/lol/schedule?limit=2&cursor=${encodeURIComponent(first.page.nextCursor)}`)
  );
  const second = await secondResponse.json() as { events: ScheduleEvent[] };
  assert.equal(second.events[0]?.series.id, 'series-3');
  assert.equal(second.events.length, 2);
});

test('schedule route rejects invalid limits', async () => {
  const response = await handler()(new Request('https://example.test/v1/lol/schedule?limit=0'));
  const payload = await response.json() as { error: string };
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'invalid_limit');
});

test('series context route resolves through the adapter', async () => {
  const response = await handler()(new Request('https://example.test/v1/lol/series/series-1/context'));
  const payload = await response.json() as SeriesContext;
  assert.equal(response.status, 200);
  assert.equal(payload.seriesId, 'series-1');
  assert.equal(payload.reasons[0]?.code, 'test_context');
});
