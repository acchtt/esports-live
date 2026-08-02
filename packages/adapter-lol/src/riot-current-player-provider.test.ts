import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';
import { createRiotCurrentPlayerProvider } from './riot-current-player-provider.ts';
import type { LolPlayerState, LolTeamState } from './types.ts';

const SOURCE = '2026-08-02T09:00:00.000Z';

function player(id: string, kills: number, totalGold: number): LolPlayerState {
  return {
    id,
    handle: `Player ${id}`,
    championId: `Champion${id}`,
    role: id === '1' || id === '6' ? 'top' : null,
    level: 6,
    kills,
    deaths: 1,
    assists: 2,
    creepScore: 55,
    totalGold,
    items: ['3006']
  };
}

function team(side: 'blue' | 'red', participant: LolPlayerState): LolTeamState {
  return {
    id: `${side}-team`,
    name: `${side} team`,
    side,
    gold: side === 'blue' ? 31_000 : 29_500,
    kills: side === 'blue' ? 8 : 5,
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

function snapshot(sourceTimestamp = SOURCE): LolProviderSnapshot {
  return {
    series: {
      id: 'series-1',
      competition: { id: 'league-1', name: 'League' },
      teams: [
        { id: 'blue-team', name: 'blue team' },
        { id: 'red-team', name: 'red team' }
      ],
      bestOf: 3,
      state: 'live',
      scheduledStart: '2026-08-02T08:30:00.000Z',
      games: [{ id: 'game-1', number: 1, state: 'live' }]
    },
    game: { id: 'game-1', number: 1, state: 'live' },
    sourceTimestamp,
    observedAt: new Date(Date.parse(sourceTimestamp) + 2_000).toISOString(),
    advancing: true,
    complete: true,
    stats: {
      gameClockSeconds: 1_200,
      patch: '26.15',
      blue: team('blue', player('1', 1, 5_200)),
      red: team('red', player('6', 0, 4_900))
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

function sequenceProvider(values: readonly LolProviderSnapshot[]): LolProviderClient {
  let index = 0;
  return {
    id: 'base',
    name: 'Base provider',
    async getSchedule() { return []; },
    async getSnapshot() {
      const value = values[Math.min(index, values.length - 1)]!;
      index += 1;
      return value;
    }
  };
}

function windowPayload(timestamp: string) {
  return {
    frames: [{
      rfc460Timestamp: timestamp,
      blueTeam: {
        participants: [{
          participantId: 1,
          level: 8,
          kills: 3,
          deaths: 1,
          assists: 5,
          creepScore: 91,
          totalGold: 7_100
        }]
      },
      redTeam: {
        participants: [{
          participantId: 6,
          level: 8,
          kills: 2,
          deaths: 3,
          assists: 4,
          creepScore: 84,
          totalGold: 6_600
        }]
      }
    }]
  };
}

function detailPayload(timestamp: string, blueItem: number, redItem: number) {
  return {
    frames: [{
      rfc460Timestamp: timestamp,
      participants: [
        { participantId: 1, items: [{ itemID: blueItem }] },
        { participantId: 6, items: [{ itemID: redItem }] }
      ]
    }]
  };
}

function windowOnlyFetcher(timestamp: string) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    const value = url.pathname.includes('/window/') ? windowPayload(timestamp) : null;
    return new Response(value === null ? null : JSON.stringify(value), {
      status: value === null ? 204 : 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}

test('uses same-frame window counters while preserving detail inventories', async () => {
  const provider = createRiotCurrentPlayerProvider(baseProvider(snapshot()), {
    fetcher: windowOnlyFetcher(SOURCE)
  });

  const result = await provider.getSnapshot('game-1');
  const blue = result.stats?.blue.players[0];
  const red = result.stats?.red.players[0];

  assert.equal(result.stats?.blue.gold, 31_000);
  assert.equal(blue?.kills, 3);
  assert.equal(blue?.assists, 5);
  assert.equal(blue?.creepScore, 91);
  assert.equal(blue?.totalGold, 7_100);
  assert.deepEqual(blue?.items, ['3006']);
  assert.equal(red?.kills, 2);
  assert.equal(red?.totalGold, 6_600);
});

test('rejects player counters from a different telemetry timestamp', async () => {
  const delayed = new Date(Date.parse(SOURCE) - 10_000).toISOString();
  const provider = createRiotCurrentPlayerProvider(baseProvider(snapshot()), {
    fetcher: windowOnlyFetcher(delayed)
  });

  const result = await provider.getSnapshot('game-1');
  const blue = result.stats?.blue.players[0];

  assert.equal(blue?.kills, 1);
  assert.equal(blue?.creepScore, 55);
  assert.equal(blue?.totalGold, 5_200);
  assert.deepEqual(blue?.items, ['3006']);
});

test('probes the Riot details availability frontier and uses the freshest frame', async () => {
  const older = new Date(Date.parse(SOURCE) - 20_000).toISOString();
  const primaryAnchor = new Date(Date.parse(SOURCE) - 60_000).toISOString();
  const fallbackAnchor = new Date(Date.parse(SOURCE) - 90_000).toISOString();
  const requestedDetails: string[] = [];
  const provider = createRiotCurrentPlayerProvider(baseProvider(snapshot()), {
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.includes('/window/')) {
        return new Response(JSON.stringify(windowPayload(SOURCE)), { status: 200 });
      }
      const anchor = url.searchParams.get('startingTime') ?? '';
      requestedDetails.push(anchor);
      const payload = anchor === primaryAnchor
        ? detailPayload(SOURCE, 3078, 3157)
        : detailPayload(older, 1001, 1004);
      return new Response(JSON.stringify(payload), { status: 200 });
    }
  });

  const result = await provider.getSnapshot('game-1');

  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['3157']);
  assert.equal(result.stats?.blue.players[0]?.kills, 3);
  assert.deepEqual(requestedDetails.sort(), [primaryAnchor, fallbackAnchor].sort());
});

test('does not roll a near-current inventory backward when Riot later returns an older frame', async () => {
  const later = new Date(Date.parse(SOURCE) + 10_000).toISOString();
  const nearCurrent = new Date(Date.parse(SOURCE) - 5_000).toISOString();
  const stale = new Date(Date.parse(SOURCE) - 20_000).toISOString();
  let poll = 0;
  const provider = createRiotCurrentPlayerProvider(
    sequenceProvider([snapshot(SOURCE), snapshot(later)]),
    {
      fetcher: async (input: RequestInfo | URL): Promise<Response> => {
        const url = new URL(String(input));
        if (url.pathname.includes('/window/')) {
          poll += 1;
          return new Response(JSON.stringify(windowPayload(poll === 1 ? SOURCE : later)), { status: 200 });
        }
        const payload = poll === 1
          ? detailPayload(nearCurrent, 3078, 3157)
          : detailPayload(stale, 1001, 1004);
        return new Response(JSON.stringify(payload), { status: 200 });
      }
    }
  );

  const first = await provider.getSnapshot('game-1');
  const second = await provider.getSnapshot('game-1', SOURCE);

  assert.deepEqual(first.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(second.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(second.stats?.red.players[0]?.items, ['3157']);
});
