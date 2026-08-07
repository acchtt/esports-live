import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSnapshot
} from './provider.ts';
import { createRiotFinalityProvider } from './riot-finality-provider.ts';

const SERIES = {
  id: 'match-1',
  competition: { id: 'lck-cl', name: 'LCK Challengers' },
  teams: [
    { id: 'ns', name: 'NS Challengers', code: 'NS' },
    { id: 'kt', name: 'kt Challengers', code: 'KT' }
  ] as const,
  bestOf: 3,
  state: 'live' as const,
  scheduledStart: '2026-08-07T05:00:00.000Z',
  games: [
    { id: 'game-1', number: 1, state: 'unstarted' as const },
    { id: 'game-2', number: 2, state: 'live' as const },
    { id: 'game-3', number: 3, state: 'unstarted' as const }
  ]
};

function snapshot(advancing: boolean | null = false): LolProviderSnapshot {
  return {
    series: SERIES,
    game: SERIES.games[1]!,
    sourceTimestamp: '2026-08-07T09:49:00.000Z',
    observedAt: '2026-08-07T09:50:00.000Z',
    advancing,
    complete: true,
    stats: null
  };
}

function scheduleEntry(): LolProviderScheduleEntry {
  return {
    series: SERIES,
    observedAt: '2026-08-07T09:50:00.000Z'
  };
}

function base(
  snapshotValue: LolProviderSnapshot,
  scheduleValue: readonly LolProviderScheduleEntry[] = []
): LolProviderClient {
  return {
    id: 'fixture',
    name: 'Fixture',
    getSchedule: async () => scheduleValue,
    getSnapshot: async () => snapshotValue
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function eventPayload(state: 'inProgress' | 'completed', gameId = 'game-2') {
  return {
    data: {
      event: {
        id: 'match-1',
        state,
        match: {
          id: 'match-1',
          strategy: { count: 3 },
          teams: [
            { id: 'ns', result: { gameWins: state === 'completed' ? 2 : 1 } },
            { id: 'kt', result: { gameWins: 0 } }
          ],
          games: [
            { id: 'game-1', number: 1, state: 'completed' },
            { id: gameId, number: 2, state },
            { id: 'game-3', number: 3, state: 'unstarted' }
          ]
        }
      }
    }
  };
}

test('refreshes stale finality signals and promotes an ended game out of live state', async () => {
  let currentTime = Date.parse('2026-08-07T09:50:00.000Z');
  let detailRequests = 0;
  const provider = createRiotFinalityProvider(base(snapshot(false)), {
    apiKey: 'test-key',
    now: () => new Date(currentTime),
    fetcher: async () => {
      detailRequests += 1;
      return json(eventPayload(detailRequests === 1 ? 'inProgress' : 'completed'));
    }
  });

  const first = await provider.getSnapshot('game-2', '2026-08-07T09:49:00.000Z');
  assert.equal(first.game.state, 'live');
  assert.equal(detailRequests, 1);

  currentTime += 6_000;
  const ended = await provider.getSnapshot('game-2', '2026-08-07T09:49:00.000Z');
  assert.equal(detailRequests, 2);
  assert.equal(ended.game.state, 'completed');
  assert.equal(ended.series.state, 'completed');
  assert.equal(ended.series.games[1]?.state, 'completed');
  assert.equal(ended.advancing, false);
});

test('matches Riot finality by game number when the history game id differs', async () => {
  const provider = createRiotFinalityProvider(base(snapshot(false)), {
    apiKey: 'test-key',
    fetcher: async () => json(eventPayload('completed', 'riot-history-game-2'))
  });

  const ended = await provider.getSnapshot('game-2');
  assert.equal(ended.game.state, 'completed');
  assert.equal(ended.series.games[1]?.state, 'completed');
});

test('does not spend a finality request while live telemetry is still advancing', async () => {
  let detailRequests = 0;
  const provider = createRiotFinalityProvider(base(snapshot(true)), {
    apiKey: 'test-key',
    fetcher: async () => {
      detailRequests += 1;
      return json(eventPayload('completed'));
    }
  });

  const live = await provider.getSnapshot('game-2');
  assert.equal(live.game.state, 'live');
  assert.equal(detailRequests, 0);
});

test('reconciles stale live match-list entries against Riot finality', async () => {
  const provider = createRiotFinalityProvider(base(snapshot(false), [scheduleEntry()]), {
    apiKey: 'test-key',
    now: () => new Date('2026-08-07T09:50:00.000Z'),
    fetcher: async () => json(eventPayload('completed'))
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'completed');
  assert.equal(schedule[0]?.series.games[1]?.state, 'completed');
  assert.equal(schedule[0]?.series.games.some(game => game.state === 'live'), false);
});

test('does not treat Riot between-game completed flags as series finality', async () => {
  const betweenGames = eventPayload('completed');
  betweenGames.data.event.match.teams[0]!.result.gameWins = 1;
  betweenGames.data.event.match.games[1]!.state = 'unstarted';

  const provider = createRiotFinalityProvider(base(snapshot(false), [scheduleEntry()]), {
    apiKey: 'test-key',
    now: () => new Date('2026-08-07T09:50:00.000Z'),
    fetcher: async () => json(betweenGames)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'live');
});

test('keeps an observed completed series ended when Riot later reports it live again', async () => {
  let currentTime = Date.parse('2026-08-07T09:50:00.000Z');
  let detailRequests = 0;
  const provider = createRiotFinalityProvider(base(snapshot(false), [scheduleEntry()]), {
    apiKey: 'test-key',
    now: () => new Date(currentTime),
    fetcher: async () => {
      detailRequests += 1;
      return json(eventPayload(detailRequests === 1 ? 'completed' : 'inProgress'));
    }
  });

  const first = await provider.getSchedule();
  assert.equal(first[0]?.series.state, 'completed');
  assert.equal(detailRequests, 1);

  currentTime += 10_000;
  const second = await provider.getSchedule();
  assert.equal(second[0]?.series.state, 'completed');
  assert.equal(second[0]?.series.games[1]?.state, 'completed');
  assert.equal(detailRequests, 1);
});
