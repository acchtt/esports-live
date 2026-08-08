import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSnapshot
} from './provider.ts';
import { createRiotScheduleReconciliationProvider } from './riot-schedule-reconciliation-provider.ts';

const NOW = '2026-08-07T14:40:00.000Z';

function rawEvent(id: string, state: 'unstarted' | 'inProgress' | 'completed') {
  return {
    id: `${id}-event`,
    state,
    startTime: '2026-08-07T05:00:00.000Z',
    league: { id: 'lck-cl', name: 'LCK Challengers' },
    match: {
      id,
      strategy: { count: 3 },
      teams: [
        {
          id: `${id}-blue`,
          name: `${id} Blue`,
          code: 'BLU',
          result: { gameWins: state === 'completed' ? 2 : 0 }
        },
        {
          id: `${id}-red`,
          name: `${id} Red`,
          code: 'RED',
          result: { gameWins: 0 }
        }
      ],
      games: [
        { id: `${id}-game-1`, number: 1, state: state === 'completed' ? 'completed' : state },
        { id: `${id}-game-2`, number: 2, state: state === 'completed' ? 'completed' : 'unstarted' },
        { id: `${id}-game-3`, number: 3, state: 'unstarted' }
      ]
    }
  };
}

function entry(id: string, state: 'scheduled' | 'live'): LolProviderScheduleEntry {
  return {
    observedAt: NOW,
    series: {
      id,
      competition: { id: 'lck-cl', name: 'LCK Challengers' },
      teams: [
        { id: `${id}-blue`, name: `${id} Blue`, code: 'BLU' },
        { id: `${id}-red`, name: `${id} Red`, code: 'RED' }
      ],
      bestOf: 3,
      state,
      scheduledStart: '2026-08-07T05:00:00.000Z',
      games: [
        { id: `${id}-game-1`, number: 1, state: state === 'live' ? 'live' : 'unstarted' },
        { id: `${id}-game-2`, number: 2, state: 'unstarted' },
        { id: `${id}-game-3`, number: 3, state: 'unstarted' }
      ]
    }
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function base(schedule: readonly LolProviderScheduleEntry[]): LolProviderClient {
  return {
    id: 'fixture',
    name: 'Fixture',
    getSchedule: async () => schedule,
    getSnapshot: async (): Promise<LolProviderSnapshot> => {
      throw new Error('Snapshot should not be requested by this regression.');
    }
  };
}

test('uses a completed older-page duplicate instead of a stale upcoming current-page state', async () => {
  const id = 'ns-kt';
  const provider = createRiotScheduleReconciliationProvider(base([entry(id, 'scheduled')]), {
    apiKey: 'test-key',
    now: () => new Date(NOW),
    fetcher: async input => {
      const url = new URL(String(input));
      if (url.searchParams.get('pageToken') === 'older-page') {
        return json({
          data: { schedule: { events: [rawEvent(id, 'completed')], pages: {} } }
        });
      }
      return json({
        data: {
          schedule: {
            events: [rawEvent(id, 'unstarted')],
            pages: { older: 'older-page' }
          }
        }
      });
    }
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'completed');
  assert.equal(schedule[0]?.series.games[0]?.state, 'completed');
  assert.equal(schedule[0]?.series.games[1]?.state, 'completed');
});

test('does not let an older scheduled duplicate downgrade a currently live series', async () => {
  const id = 'tes-blg';
  const provider = createRiotScheduleReconciliationProvider(base([entry(id, 'live')]), {
    apiKey: 'test-key',
    now: () => new Date(NOW),
    fetcher: async input => {
      const url = new URL(String(input));
      if (url.searchParams.get('pageToken') === 'older-page') {
        return json({
          data: { schedule: { events: [rawEvent(id, 'unstarted')], pages: {} } }
        });
      }
      return json({
        data: {
          schedule: {
            events: [rawEvent(id, 'inProgress')],
            pages: { older: 'older-page' }
          }
        }
      });
    }
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'live');
  assert.equal(schedule[0]?.series.games[0]?.state, 'live');
});
