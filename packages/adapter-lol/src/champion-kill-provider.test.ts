import test from 'node:test';
import assert from 'node:assert/strict';
import { createChampionKillProvider } from './champion-kill-provider.ts';
import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';
import type { LolPlayerState, LolTeamState } from './types.ts';

function player(id: string, kills: number | null): LolPlayerState {
  return {
    id,
    handle: `Player ${id}`,
    championId: `Champion${id}`,
    role: null,
    level: 8,
    kills,
    deaths: 1,
    assists: 2,
    creepScore: 80,
    totalGold: 6_000,
    items: []
  };
}

function team(
  side: 'blue' | 'red',
  reportedKills: number,
  playerKills: readonly (number | null)[]
): LolTeamState {
  return {
    id: `${side}-team`,
    name: `${side} team`,
    side,
    gold: 30_000,
    kills: reportedKills,
    objectives: {
      towers: 2,
      inhibitors: 0,
      dragons: [],
      barons: 0,
      heralds: 0,
      grubs: null
    },
    players: playerKills.map((kills, index) => player(String(index + (side === 'blue' ? 1 : 6)), kills))
  };
}

function snapshot(blue: LolTeamState, red: LolTeamState): LolProviderSnapshot {
  return {
    series: {
      id: 'series-1',
      competition: { id: 'league-1', name: 'League' },
      teams: [
        { id: blue.id, name: blue.name },
        { id: red.id, name: red.name }
      ],
      bestOf: 3,
      state: 'live',
      scheduledStart: '2026-08-10T16:00:00.000Z',
      games: [{ id: 'game-1', number: 1, state: 'live' }]
    },
    game: { id: 'game-1', number: 1, state: 'live' },
    sourceTimestamp: '2026-08-10T16:10:00.000Z',
    observedAt: '2026-08-10T16:10:02.000Z',
    advancing: true,
    complete: true,
    stats: {
      gameClockSeconds: 600,
      patch: '26.15',
      blue,
      red
    }
  };
}

function baseProvider(value: LolProviderSnapshot): LolProviderClient {
  return {
    id: 'base',
    name: 'Base provider',
    async getSchedule() { return []; },
    async getSnapshot() { return value; }
  };
}

test('does not credit an execution to the opposing team kill total', async () => {
  const value = snapshot(
    team('blue', 4, [2, 1, 0, 0, 0]),
    team('red', 2, [1, 1, 0, 0, 0])
  );
  const provider = createChampionKillProvider(baseProvider(value));

  const result = await provider.getSnapshot('game-1');

  assert.equal(result.stats?.blue.kills, 3);
  assert.equal(result.stats?.red.kills, 2);
  assert.equal(result.stats?.blue.players.reduce((sum, entry) => sum + (entry.kills ?? 0), 0), 3);
});

test('keeps the reported team total when the five-player kill board is incomplete', async () => {
  const value = snapshot(
    team('blue', 4, [2, 1, null, 0, 0]),
    team('red', 2, [1, 1, 0, 0, 0])
  );
  const provider = createChampionKillProvider(baseProvider(value));

  const result = await provider.getSnapshot('game-1');

  assert.equal(result.stats?.blue.kills, 4);
  assert.equal(result.stats?.red.kills, 2);
});
