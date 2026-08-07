import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderClient, LolProviderScheduleEntry } from './provider.ts';
import {
  createRiotSupplementalLeagueProvider,
  RIOT_LPL_LEAGUE_ID
} from './riot-supplemental-league-provider.ts';

const observedAt = '2026-08-06T07:55:00.000Z';

function entry(): LolProviderScheduleEntry {
  return {
    observedAt,
    series: {
      id: 'lck-match',
      competition: { id: 'lck', name: 'LCK' },
      teams: [{ id: 'lck-a', name: 'LCK A' }, { id: 'lck-b', name: 'LCK B' }],
      bestOf: 3,
      state: 'scheduled',
      scheduledStart: observedAt,
      games: []
    }
  };
}

function lplEvent(id: string, state: 'inProgress' | 'unstarted' | 'completed') {
  return {
    id: `${id}-event`,
    state,
    startTime: observedAt,
    blockName: 'Regular Season',
    league: { id: RIOT_LPL_LEAGUE_ID, name: 'LPL', region: 'CN' },
    match: {
      id,
      state,
      strategy: { count: 3 },
      teams: [
        { id: `${id}-left`, name: `${id} Left`, code: 'L' },
        { id: `${id}-right`, name: `${id} Right`, code: 'R' }
      ],
      games: state === 'inProgress'
        ? [{ id: `${id}-game-1`, number: 1, state: 'inProgress' }]
        : state === 'completed'
          ? [{ id: `${id}-game-1`, number: 1, state: 'completed' }]
          : []
    }
  };
}

function baseProvider(): LolProviderClient {
  return {
    id: 'fixture',
    name: 'Fixture provider',
    async getSchedule() {
      return [entry()];
    },
    async getSnapshot() {
      throw new Error('unused');
    }
  };
}

test('adds live and scheduled LPL matches omitted by the global schedule', async () => {
  const requestedLeagueIds: string[] = [];
  const provider = createRiotSupplementalLeagueProvider(baseProvider(), {
    apiKey: 'test-key',
    now: () => new Date(observedAt),
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedLeagueIds.push(url.searchParams.get('leagueId') ?? '');
      return new Response(JSON.stringify({
        data: {
          schedule: {
            events: [
              lplEvent('lpl-live-match', 'inProgress'),
              lplEvent('lpl-scheduled-match', 'unstarted')
            ]
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });

  const schedule = await provider.getSchedule();

  assert.deepEqual(requestedLeagueIds, [RIOT_LPL_LEAGUE_ID]);
  assert.equal(schedule.length, 3);
  assert.equal(schedule.find(item => item.series.id === 'lpl-live-match')?.series.state, 'live');
  assert.equal(schedule.find(item => item.series.id === 'lpl-scheduled-match')?.series.state, 'scheduled');
});

test('reads the first older LPL page so a just-ended match does not disappear', async () => {
  const requestedPageTokens: Array<string | null> = [];
  const provider = createRiotSupplementalLeagueProvider(baseProvider(), {
    apiKey: 'test-key',
    now: () => new Date(observedAt),
    fetcher: async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const pageToken = url.searchParams.get('pageToken');
      requestedPageTokens.push(pageToken);
      const events = pageToken === 'older-page'
        ? [lplEvent('we-finished-match', 'completed')]
        : [lplEvent('lpl-scheduled-match', 'unstarted')];
      return new Response(JSON.stringify({
        data: {
          schedule: {
            events,
            pages: pageToken ? {} : { older: 'older-page' }
          }
        }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });

  const schedule = await provider.getSchedule();

  assert.deepEqual(requestedPageTokens, [null, 'older-page']);
  assert.equal(schedule.find(item => item.series.id === 'we-finished-match')?.series.state, 'completed');
});

test('keeps the base schedule when the supplemental league request fails', async () => {
  const provider = createRiotSupplementalLeagueProvider(baseProvider(), {
    apiKey: 'test-key',
    fetcher: async () => new Response('unavailable', { status: 503 })
  });

  const schedule = await provider.getSchedule();

  assert.deepEqual(schedule, [entry()]);
});
