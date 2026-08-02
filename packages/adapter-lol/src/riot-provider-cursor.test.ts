import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiotLolProvider } from './riot-provider.ts';

const NOW = '2026-07-31T08:10:00.000Z';
const CURSOR = '2026-07-31T08:09:50.000Z';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function eventPayload() {
  return {
    data: {
      event: {
        id: 'match-1',
        state: 'inProgress',
        match: {
          id: 'match-1',
          strategy: { count: 1 },
          teams: [
            { id: 'team-a', name: 'Team A' },
            { id: 'team-b', name: 'Team B' }
          ],
          games: [{
            id: 'game-1',
            number: 1,
            state: 'inProgress',
            teams: [
              { id: 'team-a', side: 'blue' },
              { id: 'team-b', side: 'red' }
            ],
            vods: []
          }]
        }
      }
    }
  };
}

function windowPayload(timestamp: string) {
  const players = (start: number) => Array.from({ length: 5 }, (_, index) => ({
    participantId: start + index,
    level: 7,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 70,
    totalGold: 6000
  }));
  return {
    esportsMatchId: 'match-1',
    gameMetadata: {
      esportsMatchId: 'match-1',
      blueTeamMetadata: { esportsTeamId: 'team-a', participantMetadata: [] },
      redTeamMetadata: { esportsTeamId: 'team-b', participantMetadata: [] }
    },
    frames: [{
      rfc460Timestamp: timestamp,
      blueTeam: {
        totalGold: 30000,
        totalKills: 0,
        towers: 0,
        inhibitors: 0,
        dragons: [],
        barons: 0,
        heralds: 0,
        participants: players(1)
      },
      redTeam: {
        totalGold: 30000,
        totalKills: 0,
        towers: 0,
        inhibitors: 0,
        dragons: [],
        barons: 0,
        heralds: 0,
        participants: players(6)
      }
    }]
  };
}

test('does not roll back to a recent direct frame older than the cursor', async () => {
  const older = new Date(Date.parse(CURSOR) - 10_000).toISOString();
  const newer = new Date(Date.parse(CURSOR) + 10_000).toISOString();
  let historicalRequests = 0;
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    includeDetails: false,
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/getEventDetails')) return json(eventPayload());
      if (url.pathname.includes('/window/game-1')) {
        if (!url.searchParams.has('startingTime')) return json(windowPayload(older));
        historicalRequests += 1;
        return json(windowPayload(newer));
      }
      return json({ error: 'unexpected_url', url: url.toString() }, 500);
    },
    now: () => new Date(NOW)
  });

  const result = await provider.getSnapshot('game-1', CURSOR);

  assert.ok(historicalRequests > 0);
  assert.equal(result.sourceTimestamp, newer);
  assert.equal(result.advancing, true);
  assert.ok(result.stats);
});
