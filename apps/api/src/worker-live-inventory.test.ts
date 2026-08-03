import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type LolPlayerState,
  type LolProviderClient,
  type LolProviderSnapshot,
  type LolTeamState
} from '@esports-live/adapter-lol';
import {
  LIVE_INVENTORY_SETTLE_BUDGET_MS,
  createProductionInventoryProvider
} from './worker.ts';

const SOURCE = '2026-08-03T05:00:00.000Z';
const LIVE_NOW = '2026-08-03T05:02:00.000Z';

function player(id: string): LolPlayerState {
  return {
    id,
    handle: `Player ${id}`,
    championId: `Champion${id}`,
    role: id === '1' || id === '6' ? 'top' : null,
    level: 8,
    kills: 1,
    deaths: 1,
    assists: 2,
    creepScore: 90,
    totalGold: 7_000,
    items: null
  };
}

function team(side: 'blue' | 'red', participant: LolPlayerState): LolTeamState {
  return {
    id: `${side}-team`,
    name: `${side} team`,
    side,
    gold: side === 'blue' ? 31_000 : 30_000,
    kills: side === 'blue' ? 8 : 6,
    objectives: {
      towers: 3,
      inhibitors: 0,
      dragons: [],
      barons: 0,
      heralds: 1,
      grubs: 3
    },
    players: [participant]
  };
}

function snapshot(state: 'live' | 'completed'): LolProviderSnapshot {
  return {
    series: {
      id: 'series-1',
      competition: { id: 'league-1', name: 'League' },
      teams: [
        { id: 'blue-team', name: 'blue team' },
        { id: 'red-team', name: 'red team' }
      ],
      bestOf: 3,
      state,
      scheduledStart: '2026-08-03T04:30:00.000Z',
      games: [{ id: 'game-1', number: 1, state }]
    },
    game: { id: 'game-1', number: 1, state },
    sourceTimestamp: SOURCE,
    observedAt: new Date(Date.parse(SOURCE) + 2_000).toISOString(),
    advancing: state === 'live',
    complete: false,
    stats: {
      gameClockSeconds: 1_200,
      patch: '26.15',
      blue: team('blue', player('1')),
      red: team('red', player('6'))
    },
    reasons: [
      { code: 'missing_field', message: 'Missing blue items.', field: 'blue.players.0.items' },
      { code: 'missing_field', message: 'Missing red items.', field: 'red.players.0.items' }
    ]
  };
}

function baseProvider(state: 'live' | 'completed'): LolProviderClient {
  return {
    id: 'base',
    name: 'Base provider',
    async getSchedule() { return []; },
    async getSnapshot() { return snapshot(state); }
  };
}

function windowPayload() {
  return {
    frames: [{
      rfc460Timestamp: SOURCE,
      blueTeam: { participants: [{ participantId: 1 }] },
      redTeam: { participants: [{ participantId: 6 }] }
    }]
  };
}

function detailsPayload() {
  return {
    frames: [{
      rfc460Timestamp: SOURCE,
      participants: [
        { participantId: 1, items: [{ itemID: 3078 }] },
        { participantId: 6, items: [{ itemID: 3157 }] }
      ]
    }]
  };
}

function roundedIso(value: number): string {
  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();
}

test('production live games use the wall-clock details frontier without an unanchored window probe', async () => {
  const requestedDetails: string[] = [];
  let windowRequests = 0;
  const expectedAnchor = roundedIso(Date.parse(LIVE_NOW) - 60_000);
  const provider = createProductionInventoryProvider(baseProvider('live'), {
    now: () => new Date(LIVE_NOW),
    inventoryWaitBudgetMs: LIVE_INVENTORY_SETTLE_BUDGET_MS,
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.includes('/window/')) {
        windowRequests += 1;
        return new Response(JSON.stringify(windowPayload()), { status: 200 });
      }

      const anchor = url.searchParams.get('startingTime') ?? '';
      requestedDetails.push(anchor);
      return new Response(
        anchor === expectedAnchor ? JSON.stringify(detailsPayload()) : null,
        { status: anchor === expectedAnchor ? 200 : 204 }
      );
    }
  });

  const result = await provider.getSnapshot('game-1');

  assert.equal(windowRequests, 0);
  assert.deepEqual(requestedDetails, [expectedAnchor]);
  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['3157']);
  assert.equal(result.complete, true);
});

test('production completed games retain their final source-window inventory anchor', async () => {
  const requestedDetails: string[] = [];
  let windowRequests = 0;
  const expectedAnchor = roundedIso(Date.parse(SOURCE) - 60_000);
  const provider = createProductionInventoryProvider(baseProvider('completed'), {
    now: () => new Date(Date.parse(SOURCE) + 24 * 60 * 60 * 1_000),
    inventoryWaitBudgetMs: LIVE_INVENTORY_SETTLE_BUDGET_MS,
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.includes('/window/')) {
        windowRequests += 1;
        return new Response(JSON.stringify(windowPayload()), { status: 200 });
      }

      const anchor = url.searchParams.get('startingTime') ?? '';
      requestedDetails.push(anchor);
      return new Response(
        anchor === expectedAnchor ? JSON.stringify(detailsPayload()) : null,
        { status: anchor === expectedAnchor ? 200 : 204 }
      );
    }
  });

  const result = await provider.getSnapshot('game-1');

  assert.ok(windowRequests >= 1);
  assert.deepEqual(requestedDetails, [expectedAnchor]);
  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['3157']);
  assert.equal(result.complete, true);
});
