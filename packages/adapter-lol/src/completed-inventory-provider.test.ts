import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';
import { createCompletedInventoryProvider } from './completed-inventory-provider.ts';
import type { LolPlayerState, LolTeamState } from './types.ts';

function player(id: string, items: readonly string[] | null): LolPlayerState {
  return {
    id,
    handle: `Player ${id}`,
    championId: `Champion${id}`,
    role: 'top',
    level: 18,
    kills: 5,
    deaths: 2,
    assists: 8,
    creepScore: 300,
    totalGold: 15_000,
    items
  };
}

function team(side: 'blue' | 'red', items: readonly string[] | null): LolTeamState {
  return {
    id: `${side}-team`,
    name: `${side} team`,
    side,
    gold: 60_000,
    kills: 15,
    objectives: {
      towers: 7,
      inhibitors: 1,
      dragons: ['infernal'],
      barons: 1,
      heralds: 1,
      grubs: null
    },
    players: [player(side === 'blue' ? '1' : '6', items)]
  };
}

function snapshot(
  state: 'live' | 'completed',
  blueItems: readonly string[] | null,
  redItems: readonly string[] | null
): LolProviderSnapshot {
  const seriesState = state === 'completed' ? 'completed' : 'live';
  return {
    series: {
      id: 'series-1',
      competition: { id: 'league-1', name: 'League' },
      teams: [
        { id: 'blue-team', name: 'blue team' },
        { id: 'red-team', name: 'red team' }
      ],
      bestOf: 3,
      state: seriesState,
      scheduledStart: '2026-08-03T00:00:00.000Z',
      games: [{ id: 'game-1', number: 1, state }]
    },
    game: { id: 'game-1', number: 1, state },
    sourceTimestamp: '2026-08-03T01:00:00.000Z',
    observedAt: '2026-08-03T01:00:01.000Z',
    advancing: false,
    complete: Boolean(blueItems?.length && redItems?.length),
    stats: {
      gameClockSeconds: 2_400,
      patch: '26.15',
      blue: team('blue', blueItems),
      red: team('red', redItems)
    }
  };
}

function sequenceProvider(
  values: readonly (LolProviderSnapshot | Error)[],
  afterValues: (string | undefined)[]
): LolProviderClient {
  let index = 0;
  return {
    id: 'base',
    name: 'Base provider',
    async getSchedule() { return []; },
    async getSnapshot(_gameId: string, after?: string) {
      afterValues.push(after);
      const value = values[Math.min(index, values.length - 1)]!;
      index += 1;
      if (value instanceof Error) throw value;
      return value;
    }
  };
}

test('retries a completed snapshot until player inventories are available', async () => {
  const afterValues: (string | undefined)[] = [];
  const provider = createCompletedInventoryProvider(
    sequenceProvider([
      snapshot('completed', null, null),
      snapshot('completed', ['3078'], ['3157'])
    ], afterValues),
    { retryDelaysMs: [0], sleep: async () => {} }
  );

  const result = await provider.getSnapshot('game-1', 'cursor');

  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['3157']);
  assert.deepEqual(afterValues, ['cursor', undefined]);
});

test('treats empty item arrays as unresolved completed inventory', async () => {
  const afterValues: (string | undefined)[] = [];
  const provider = createCompletedInventoryProvider(
    sequenceProvider([
      snapshot('completed', [], []),
      snapshot('completed', ['3078'], ['3157'])
    ], afterValues),
    { retryDelaysMs: [0], sleep: async () => {} }
  );

  const result = await provider.getSnapshot('game-1', 'cursor');

  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['3157']);
  assert.deepEqual(afterValues, ['cursor', undefined]);
});

test('retains the last verified live build when the final frame clears item arrays', async () => {
  const afterValues: (string | undefined)[] = [];
  const provider = createCompletedInventoryProvider(
    sequenceProvider([
      snapshot('live', ['3078', '3006'], ['3157']),
      snapshot('completed', [], [])
    ], afterValues),
    { retryDelaysMs: [0], sleep: async () => {} }
  );

  const live = await provider.getSnapshot('game-1', 'live-cursor');
  const final = await provider.getSnapshot('game-1', 'final-cursor');

  assert.deepEqual(live.stats?.blue.players[0]?.items, ['3078', '3006']);
  assert.deepEqual(final.stats?.blue.players[0]?.items, ['3078', '3006']);
  assert.deepEqual(final.stats?.red.players[0]?.items, ['3157']);
  assert.deepEqual(afterValues, ['live-cursor', 'final-cursor']);
});

test('does not add inventory retries to live snapshots', async () => {
  const afterValues: (string | undefined)[] = [];
  const provider = createCompletedInventoryProvider(
    sequenceProvider([snapshot('live', null, null)], afterValues),
    { retryDelaysMs: [0], sleep: async () => {} }
  );

  const result = await provider.getSnapshot('game-1', 'cursor');

  assert.equal(result.game.state, 'live');
  assert.deepEqual(afterValues, ['cursor']);
});

test('preserves a usable completed snapshot when optional retries fail', async () => {
  const initial = snapshot('completed', ['3078'], null);
  const provider = createCompletedInventoryProvider(
    sequenceProvider([initial, new Error('Riot details unavailable')], []),
    { retryDelaysMs: [0], sleep: async () => {} }
  );

  const result = await provider.getSnapshot('game-1');

  assert.equal(result.game.state, initial.game.state);
  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078']);
  assert.equal(result.stats?.red.players[0]?.items, null);
});
