import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiotLolResolvedProvider } from './riot-resolved-provider.ts';

const NOW = '2026-07-31T08:10:00.000Z';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function event(matchId: string, includeSlugs: boolean) {
  return {
    id: `event-${matchId}`,
    state: 'unstarted',
    startTime: '2026-07-31T08:00:00.000Z',
    blockName: 'Week 10',
    league: { id: 'lck-cl', name: 'LCK Challengers', region: 'KR' },
    match: {
      id: matchId,
      strategy: { count: 3 },
      teams: [
        {
          id: 'team-a',
          ...(includeSlugs ? { slug: 'team-a' } : {}),
          name: 'Team A',
          code: 'A',
          image: 'https://example.test/a.png',
          record: { wins: 8, losses: 2 }
        },
        {
          id: 'team-b',
          ...(includeSlugs ? { slug: 'team-b' } : {}),
          name: 'Team B',
          code: 'B',
          image: 'https://example.test/b.png',
          record: { wins: 7, losses: 3 }
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

test('resolves selected series after Riot changes event identifiers', async () => {
  let scheduleCalls = 0;
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      scheduleCalls += 1;
      const payload = scheduleCalls === 1
        ? event('selected-series', false)
        : event('new-provider-match-id', true);
      return json({ data: { schedule: { events: [payload] } } });
    }
    if (url.pathname.endsWith('/getLive')) {
      return json({ data: { schedule: { events: [] } } });
    }
    if (url.pathname.endsWith('/getTeams')) {
      assert.deepEqual(url.searchParams.getAll('id'), ['team-a', 'team-b']);
      return json({
        data: {
          teams: [
            team('team-a', 'team-a', 'Team A'),
            team('team-b', 'team-b', 'Team B')
          ]
        }
      });
    }
    if (url.pathname.endsWith('/getTournamentsForLeague')) {
      assert.equal(url.searchParams.get('leagueId'), 'lck-cl');
      return json({ error: 'not_available' }, 503);
    }
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };

  const provider = createRiotLolResolvedProvider({
    apiKey: 'test-key',
    fetcher,
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.id, 'selected-series');

  const context = await provider.getSeriesContext?.('selected-series');
  assert.ok(context);
  assert.equal(context.complete, true);
  assert.equal(context.rosters.length, 2);
  assert.deepEqual(context.rosters.map(roster => roster.players.length), [5, 5]);
  assert.equal(context.standings.length, 2);
  assert.equal(context.standings[0]?.rank, null);
  assert.equal(context.standings[0]?.wins, 8);
  assert.ok(context.reasons?.some(reason => reason.code === 'standings_from_schedule_record'));
});

test('uses full tournament rankings when Riot standings resolve', async () => {
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      return json({ data: { schedule: { events: [event('selected-series', true)] } } });
    }
    if (url.pathname.endsWith('/getLive')) {
      return json({ data: { schedule: { events: [] } } });
    }
    if (url.pathname.endsWith('/getTeams')) {
      return json({
        data: {
          teams: [
            team('team-a', 'team-a', 'Team A'),
            team('team-b', 'team-b', 'Team B')
          ]
        }
      });
    }
    if (url.pathname.endsWith('/getTournamentsForLeague')) {
      return json({
        data: {
          leagues: [{
            tournaments: [{
              id: 'tournament-1',
              startDate: '2026-07-01',
              endDate: '2026-08-31'
            }]
          }]
        }
      });
    }
    if (url.pathname.endsWith('/getStandings')) {
      return json({
        data: {
          standings: [{
            stages: [{
              name: 'Regular Season',
              sections: [{
                name: 'Table',
                rankings: [{
                  ordinal: 1,
                  teams: [{
                    id: 'team-b',
                    slug: 'team-b',
                    name: 'Team B',
                    record: { wins: 9, losses: 1 }
                  }]
                }, {
                  ordinal: 2,
                  teams: [{
                    id: 'team-a',
                    slug: 'team-a',
                    name: 'Team A',
                    record: { wins: 8, losses: 2 }
                  }]
                }]
              }]
            }]
          }]
        }
      });
    }
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };

  const provider = createRiotLolResolvedProvider({
    apiKey: 'test-key',
    fetcher,
    now: () => new Date(NOW)
  });
  const selected = (await provider.getSchedule())[0]?.series.id;
  assert.equal(selected, 'selected-series');

  const context = await provider.getSeriesContext?.(selected);
  assert.ok(context);
  assert.equal(context.complete, true);
  assert.equal(context.standings.length, 2);
  assert.equal(context.standings[0]?.rank, 1);
  assert.equal(context.standings[0]?.team.id, 'team-b');
  assert.equal(context.reasons?.some(reason => reason.code === 'standings_from_schedule_record'), false);
});
