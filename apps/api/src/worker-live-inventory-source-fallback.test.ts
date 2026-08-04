import test from 'node:test';
import assert from 'node:assert/strict';
import {
  type LolPlayerState,
  type LolProviderClient,
  type LolProviderSnapshot,
  type LolTeamState
} from '@esports-live/adapter-lol';
import { createProductionInventoryProvider } from './worker.ts';

const SOURCE = '2026-08-05T00:00:00.000Z';
const LIVE_NOW = '2026-08-05T00:02:00.000Z';
const WALL_DETAIL = '2026-08-05T00:01:50.000Z';

function player(id: string): LolPlayerState {
  return {
    id,
    handle: `Player ${id}`,
    championId: `Champion${id}`,
    role: id === '1' || id === '6' ? 'top' : null,
    level: 4,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 20,
    totalGold: 1_200,
    items: null
  };
}

function team(side: 'blue' | 'red', member: LolPlayerState): LolTeamState {
  return {
    id: `${side}-team`,
    name: `${side} team`,
    side,
    gold: 6_000,
    kills: 0,
    objectives: {
      towers: 0,
      inhibitors: 0,
      dragons: [],
      barons: 0,
      heralds: 0,
      grubs: 0
    },
    players: [member]
  };
}

function snapshot(): LolProviderSnapshot {
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
      scheduledStart: '2026-08-04T23:30:00.000Z',
      games: [{ id: 'game-1', number: 1, state: 'live' }]
    },
    game: { id: 'game-1', number: 1, state: 'live' },
    sourceTimestamp: SOURCE,
    observedAt: LIVE_NOW,
    advancing: true,
    complete: false,
    stats: {
      gameClockSeconds: 120,
      patch: '26.15',
      blue: team('blue', player('1')),
      red: team('red', player('6'))
    }
  };
}

function windowPayload(timestamp: string) {
  return {
    frames: [{
      rfc460Timestamp: timestamp,
      blueTeam: { participants: [{ participantId: 1 }] },
      redTeam: { participants: [{ participantId: 6 }] }
    }]
  };
}

function detailPayload(timestamp: string) {
  return {
    frames: [{
      rfc460Timestamp: timestamp,
      participants: [
        { participantId: 1, items: [{ itemID: 1055 }, { itemID: 2003 }] },
        { participantId: 6, items: [{ itemID: 1054 }, { itemID: 2003 }] }
      ]
    }]
  };
}

function roundedIso(value: number): string {
  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();
}

test('falls back to source-aligned inventories when wall-clock frames are newer than the board', async () => {
  const wallAnchor = roundedIso(Date.parse(LIVE_NOW) - 60_000);
  const sourceAnchor = roundedIso(Date.parse(SOURCE) - 60_000);
  const requestedDetails: string[] = [];
  let windowRequests = 0;
  const base: LolProviderClient = {
    id: 'base',
    name: 'Base provider',
    async getSchedule() { return []; },
    async getSnapshot() { return snapshot(); }
  };
  const provider = createProductionInventoryProvider(base, {
    now: () => new Date(LIVE_NOW),
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.includes('/window/')) {
        windowRequests += 1;
        return new Response(JSON.stringify(windowPayload(SOURCE)), { status: 200 });
      }
      const anchor = url.searchParams.get('startingTime') ?? '';
      requestedDetails.push(anchor);
      const payload = anchor === wallAnchor
        ? detailPayload(WALL_DETAIL)
        : detailPayload(SOURCE);
      return new Response(JSON.stringify(payload), { status: 200 });
    }
  });

  const result = await provider.getSnapshot('game-1');

  assert.ok(windowRequests >= 1);
  assert.deepEqual(requestedDetails, [wallAnchor, sourceAnchor]);
  assert.deepEqual(result.stats?.blue.players[0]?.items, ['1055', '2003']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['1054', '2003']);
});
