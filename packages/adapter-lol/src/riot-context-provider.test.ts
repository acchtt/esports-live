import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiotLolContextProvider } from './riot-context-provider.ts';

const NOW = '2026-07-31T08:10:00.000Z';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function scheduleEvent(state = 'unstarted') {
  return {
    id: 'event-1',
    state,
    startTime: '2026-07-31T08:00:00.000Z',
    blockName: 'Week 10',
    league: { id: '98767991310872058', name: 'LCK Challengers', region: 'KR' },
    match: {
      id: 'match-1',
      state,
      strategy: { count: 3 },
      teams: [
        {
          id: 'team-a',
          slug: 'team-a',
          name: 'Team A',
          code: 'A',
          image: 'https://example.test/a.png'
        },
        {
          id: 'team-b',
          slug: 'team-b',
          name: 'Team B',
          code: 'B',
          image: 'https://example.test/b.png'
        }
      ],
      games: [
        { id: 'game-1', number: 1, state: 'unstarted' },
        { id: 'game-2', number: 2, state: 'unstarted' },
        { id: 'game-3', number: 3, state: 'unstarted' }
      ]
    }
  };
}

function team(id: string, slug: string, name: string) {
  return {
    id,
    slug,
    name,
    code: name.slice(-1),
    image: `https://example.test/${slug}.png`,
    players: Array.from({ length: 5 }, (_, index) => ({
      id: `${id}-player-${index + 1}`,
      summonerName: `${name} Player ${index + 1}`,
      firstName: `First${index + 1}`,
      lastName: `Last${index + 1}`,
      image: `https://example.test/${slug}-${index + 1}.png`,
      role: ['top', 'jungle', 'mid', 'bottom', 'support'][index]
    }))
  };
}

function fetcher(options: { liveFailure?: boolean } = {}) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      return json({ data: { schedule: { events: [scheduleEvent()] } } });
    }
    if (url.pathname.endsWith('/getLive')) {
      if (options.liveFailure) return json({ error: 'unavailable' }, 503);
      return json({ data: { schedule: { events: [scheduleEvent('inProgress')] } } });
    }
    if (url.pathname.endsWith('/getEventDetails')) {
      return json({ data: { event: scheduleEvent() } });
    }
    if (url.pathname.endsWith('/getTeams')) {
      assert.deepEqual(url.searchParams.getAll('id'), ['team-a', 'team-b']);
      return json({ data: { teams: [team('team-a', 'team-a', 'Team A'), team('team-b', 'team-b', 'Team B')] } });
    }
    if (url.pathname.endsWith('/getTournamentsForLeague')) {
      assert.equal(url.searchParams.get('leagueId'), '98767991310872058');
      return json({
        data: {
          leagues: [{
            tournaments: [{
              id: '110733837259396102',
              startDate: '2026-07-01',
              endDate: '2026-08-31'
            }]
          }]
        }
      });
    }
    if (url.pathname.endsWith('/getStandings')) {
      assert.deepEqual(url.searchParams.getAll('tournamentId'), ['110733837259396102']);
      return json({
        data: {
          standings: [{
            stages: [{
              name: 'Regular Season',
              sections: [{
                name: 'Table',
                rankings: [
                  {
                    ordinal: 1,
                    teams: [{
                      id: 'team-a',
                      slug: 'team-a',
                      name: 'Team A',
                      code: 'A',
                      image: 'https://example.test/a.png',
                      record: { wins: 8, losses: 2 }
                    }]
                  },
                  {
                    ordinal: 2,
                    teams: [{
                      id: 'team-b',
                      slug: 'team-b',
                      name: 'Team B',
                      code: 'B',
                      image: 'https://example.test/b.png',
                      record: { wins: 7, losses: 3 }
                    }]
                  }
                ]
              }]
            }]
          }]
        }
      });
    }
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };
}

test('getLive upgrades a delayed schedule state without replacing game data', async () => {
  const provider = createRiotLolContextProvider({
    apiKey: 'test-key',
    fetcher: fetcher(),
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'live');
  assert.equal(schedule[0]?.series.games[0]?.id, 'game-1');
  assert.equal(schedule[0]?.series.games[0]?.state, 'unstarted');
});

test('getLive supplies game IDs when the base schedule omits them', async () => {
  const baseEvent = scheduleEvent();
  baseEvent.match.games = [];
  const liveEvent = scheduleEvent('inProgress');
  liveEvent.match.games = [
    { id: 'game-1', number: 1, state: 'completed' },
    { id: 'game-2', number: 2, state: 'inProgress' },
    { id: 'game-3', number: 3, state: 'unstarted' }
  ];
  const provider = createRiotLolContextProvider({
    apiKey: 'test-key',
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/getSchedule')) {
        return json({ data: { schedule: { events: [baseEvent] } } });
      }
      if (url.pathname.endsWith('/getLive')) {
        return json({ data: { schedule: { events: [liveEvent] } } });
      }
      return json({ error: 'unexpected_url', url: url.toString() }, 500);
    },
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'live');
  assert.deepEqual(schedule[0]?.series.games.map(game => [game.id, game.state]), [
    ['game-1', 'completed'],
    ['game-2', 'live'],
    ['game-3', 'unstarted']
  ]);
});

test('getLive failure leaves the base schedule available', async () => {
  const provider = createRiotLolContextProvider({
    apiKey: 'test-key',
    fetcher: fetcher({ liveFailure: true }),
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'scheduled');
});

test('series context normalizes rosters and active-tournament standings', async () => {
  const provider = createRiotLolContextProvider({
    apiKey: 'test-key',
    fetcher: fetcher(),
    now: () => new Date(NOW)
  });

  const context = await provider.getSeriesContext?.('match-1');
  assert.ok(context);
  assert.equal(context.complete, true);
  assert.equal(context.rosters.length, 2);
  assert.equal(context.rosters[0]?.players.length, 5);
  assert.equal(context.rosters[0]?.players[0]?.role, 'top');
  assert.equal(context.standings.length, 2);
  assert.equal(context.standings[0]?.rank, 1);
  assert.equal(context.standings[0]?.wins, 8);
});
