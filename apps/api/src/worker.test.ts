import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolPlayerState, LolProviderClient, LolProviderSnapshot, LolTeamState } from '@esports-live/adapter-lol';
import { createProductionInventoryProvider, createWorkerHandler } from './worker.ts';

test('Worker health disables LoL when the secret is absent', async () => {
  const response = await createWorkerHandler({})(new Request('https://example.test/health'));
  const payload = await response.json() as { adapters: string[] };
  assert.deepEqual(payload.adapters, []);
});

test('Worker health enables LoL when the secret is configured', async () => {
  const response = await createWorkerHandler({ LOL_ESPORTS_API_KEY: 'configured' })(
    new Request('https://example.test/health')
  );
  const payload = await response.json() as { adapters: string[] };
  assert.deepEqual(payload.adapters, ['lol']);
});

const INVENTORY_NOW = '2026-08-04T15:00:00.000Z';

function inventoryPlayer(id: string, side: 'blue' | 'red'): LolPlayerState {
  return {
    id,
    handle: `${side} player`,
    championId: side === 'blue' ? 'Gnar' : 'Ambessa',
    role: 'top',
    level: 8,
    kills: 1,
    deaths: 0,
    assists: 2,
    creepScore: 80,
    totalGold: 5_000,
    items: null
  };
}

function inventoryTeam(side: 'blue' | 'red', player: LolPlayerState): LolTeamState {
  return {
    id: `${side}-team`,
    name: `${side} team`,
    side,
    gold: 25_000,
    kills: 3,
    objectives: {
      towers: 1,
      inhibitors: 0,
      dragons: [],
      barons: 0,
      heralds: 1,
      grubs: 3
    },
    players: [player]
  };
}

function inventorySnapshot(): LolProviderSnapshot {
  return {
    series: {
      id: 'series-inventory',
      competition: { id: 'league', name: 'League' },
      teams: [
        { id: 'blue-team', name: 'blue team' },
        { id: 'red-team', name: 'red team' }
      ],
      bestOf: 3,
      state: 'live',
      scheduledStart: '2026-08-04T14:30:00.000Z',
      games: [{ id: 'game-inventory', number: 1, state: 'live' }]
    },
    game: { id: 'game-inventory', number: 1, state: 'live' },
    sourceTimestamp: '2026-08-04T14:59:40.000Z',
    observedAt: INVENTORY_NOW,
    advancing: true,
    complete: false,
    stats: {
      gameClockSeconds: 1_200,
      patch: '26.15',
      blue: inventoryTeam('blue', inventoryPlayer('1', 'blue')),
      red: inventoryTeam('red', inventoryPlayer('6', 'red'))
    },
    reasons: [
      { code: 'missing_field', message: 'Missing blue inventory.', field: 'blue.players.0.items' },
      { code: 'missing_field', message: 'Missing red inventory.', field: 'red.players.0.items' }
    ]
  };
}

test('production inventory probing keeps its adaptive frontier across live snapshots', async () => {
  const baseSnapshot = inventorySnapshot();
  const base: LolProviderClient = {
    id: 'base',
    name: 'Base provider',
    async getSchedule() { return []; },
    async getSnapshot() { return structuredClone(baseSnapshot); }
  };
  const requestedAnchors: string[] = [];
  const successfulAnchor = '2026-08-04T14:58:50.000Z';
  const provider = createProductionInventoryProvider(base, {
    now: () => new Date(INVENTORY_NOW),
    inventoryWaitBudgetMs: 100,
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      const anchor = url.searchParams.get('startingTime') ?? '';
      requestedAnchors.push(anchor);
      if (anchor !== successfulAnchor) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({
        frames: [{
          rfc460Timestamp: '2026-08-04T14:59:50.000Z',
          participants: [
            { participantId: 1, items: [{ itemID: 3078 }, { itemID: 3006 }] },
            { participantId: 6, items: [{ itemID: 3157 }] }
          ]
        }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });

  await provider.getSnapshot('game-inventory');
  await provider.getSnapshot('game-inventory');
  const result = await provider.getSnapshot('game-inventory');

  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078', '3006']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['3157']);
  assert.equal(requestedAnchors.at(-1), successfulAnchor);
  assert.equal(requestedAnchors.filter(anchor => anchor === '2026-08-04T14:59:00.000Z').length, 2);
});