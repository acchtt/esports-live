import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderClient, LolProviderSnapshot, LolTeamState } from '@esports-live/adapter-lol';
import { createGrubsCvProvider } from './grubs-cv-provider.ts';

const NOW = Date.parse('2026-08-10T12:00:00.000Z');

function team(side: 'blue' | 'red', grubs: number | null): LolTeamState {
  return {
    id: `${side}-team`,
    name: `${side} team`,
    side,
    gold: side === 'blue' ? 34_000 : 32_000,
    kills: side === 'blue' ? 10 : 7,
    objectives: {
      towers: side === 'blue' ? 5 : 2,
      inhibitors: 0,
      dragons: [],
      barons: 0,
      heralds: null,
      grubs
    },
    players: []
  };
}

function snapshot(state: 'live' | 'paused' | 'completed' = 'live'): LolProviderSnapshot {
  return {
    series: {
      id: 'series-cv',
      competition: { id: 'league', name: 'League' },
      teams: [
        { id: 'blue-team', name: 'blue team' },
        { id: 'red-team', name: 'red team' }
      ],
      bestOf: 3,
      state: state === 'completed' ? 'completed' : 'live',
      scheduledStart: '2026-08-10T11:00:00.000Z',
      games: [{ id: 'game-cv', number: 1, state }]
    },
    game: { id: 'game-cv', number: 1, state },
    sourceTimestamp: '2026-08-10T11:59:58.000Z',
    observedAt: '2026-08-10T11:59:59.000Z',
    advancing: state === 'live',
    complete: true,
    stats: {
      gameClockSeconds: 1_730,
      patch: '26.15',
      blue: team('blue', null),
      red: team('red', null)
    }
  };
}

function base(value: LolProviderSnapshot): LolProviderClient {
  return {
    id: 'base',
    name: 'Base',
    async getSchedule() { return []; },
    async getSnapshot() { return value; }
  };
}

function cvResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    schemaVersion: '1.0',
    gameId: 'game-cv',
    blue: 4,
    red: 2,
    confidence: 0.97,
    observedAt: new Date(NOW - 2_000).toISOString(),
    source: 'broadcast-cv',
    mode: 'vision',
    ...overrides
  });
}

test('CV provider fills missing live Grubs from a recent high-confidence vision result', async () => {
  let requests = 0;
  const provider = createGrubsCvProvider(base(snapshot()), {
    baseUrl: 'https://cv.example.test/',
    now: () => NOW,
    fetchImpl: async input => {
      requests += 1;
      assert.equal(String(input), 'https://cv.example.test/v1/grubs/game-cv');
      return cvResponse();
    }
  });

  const result = await provider.getSnapshot('game-cv');
  assert.equal(result.stats?.blue.objectives.grubs, 4);
  assert.equal(result.stats?.red.objectives.grubs, 2);
  assert.equal(requests, 1);
});

test('CV provider never overwrites Grubs already supplied by an authoritative source', async () => {
  const value = snapshot();
  value.stats!.blue.objectives.grubs = 3;
  value.stats!.red.objectives.grubs = 3;
  let requests = 0;
  const provider = createGrubsCvProvider(base(value), {
    baseUrl: 'https://cv.example.test',
    fetchImpl: async () => {
      requests += 1;
      return cvResponse();
    }
  });

  const result = await provider.getSnapshot('game-cv');
  assert.equal(result.stats?.blue.objectives.grubs, 3);
  assert.equal(result.stats?.red.objectives.grubs, 3);
  assert.equal(requests, 0);
});

test('CV provider rejects stale, low-confidence, mismatched and simulated live values by default', async () => {
  for (const overrides of [
    { confidence: 0.6 },
    { gameId: 'another-game' },
    { observedAt: new Date(NOW - 60_000).toISOString() },
    { mode: 'simulated' }
  ]) {
    const provider = createGrubsCvProvider(base(snapshot()), {
      baseUrl: 'https://cv.example.test',
      now: () => NOW,
      fetchImpl: async () => cvResponse(overrides)
    });
    const result = await provider.getSnapshot('game-cv');
    assert.equal(result.stats?.blue.objectives.grubs, null);
    assert.equal(result.stats?.red.objectives.grubs, null);
  }
});

test('CV provider can explicitly accept simulated values for a mobile-demo integration test', async () => {
  const provider = createGrubsCvProvider(base(snapshot()), {
    baseUrl: 'https://cv.example.test',
    now: () => NOW,
    allowSimulated: true,
    fetchImpl: async () => cvResponse({ mode: 'simulated', blue: 5, red: 1 })
  });
  const result = await provider.getSnapshot('game-cv');
  assert.equal(result.stats?.blue.objectives.grubs, 5);
  assert.equal(result.stats?.red.objectives.grubs, 1);
});
