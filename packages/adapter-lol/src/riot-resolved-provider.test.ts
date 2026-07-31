import test from 'node:test';
import assert from 'node:assert/strict';
import { createRiotLolResolvedProvider } from './riot-resolved-provider.ts';

const NOW = '2026-07-31T08:10:00.000Z';
const LEAGUE_ID = '98767991310872058';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function scheduleEvent(matchId: string) {
  return {
    state: 'unstarted',
    startTime: '2026-07-31T08:00:00.000Z',
    blockName: 'Week 10',
    league: { name: 'LCK', slug: 'lck' },
    match: {
      id: matchId,
      strategy: { count: 3 },
      teams: [
        {
          name: 'BNK FEARX',
          code: 'BFX',
          image: 'https://example.test/bfx.png',
          record: { wins: 8, losses: 2 }
        },
        {
          name: 'DN SOOPers',
          code: 'DNS',
          image: 'https://example.test/dns.png',
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

function eventDetails() {
  return {
    id: 'selected-series',
    league: { id: LEAGUE_ID, slug: 'lck', name: 'LCK' },
    match: {
      strategy: { count: 3 },
      teams: [
        {
          id: 'old-bfx-id',
          name: 'BNK FEARX',
          code: 'BFX',
          image: 'https://example.test/bfx.png'
        },
        {
          id: 'dns-current-id',
          name: 'DN SOOPers',
          code: 'DNS',
          image: 'https://example.test/dns.png'
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

function catalogTeam(
  id: string,
  slug: string,
  code: string,
  name: string,
  playerCount: number
) {
  return {
    id,
    slug,
    code,
    name,
    status: 'active',
    homeLeague: { id: LEAGUE_ID, slug: 'lck', name: 'LCK' },
    image: `https://example.test/${slug}.png`,
    players: Array.from({ length: playerCount }, (_, index) => ({
      id: `${id}-player-${index + 1}`,
      summonerName: `${code} Player ${index + 1}`,
      firstName: `First${index + 1}`,
      lastName: `Last${index + 1}`,
      role: ['top', 'jungle', 'mid', 'bottom', 'support', 'sub'][index % 6]
    }))
  };
}

function fullStandings() {
  return {
    data: {
      standings: [{
        stages: [{
          name: 'Regular Season',
          sections: [{
            name: 'Table',
            rankings: [{
              ordinal: 1,
              teams: [{
                id: 'dns-current-id',
                slug: 'kwangdong-freecs',
                name: 'DN SOOPers',
                code: 'DNS',
                record: { wins: 9, losses: 1 }
              }]
            }, {
              ordinal: 2,
              teams: [{
                id: 'new-bfx-id',
                slug: 'bnk-fearx',
                name: 'BNK FEARX',
                code: 'BFX',
                record: { wins: 8, losses: 2 }
              }]
            }]
          }]
        }]
      }]
    }
  };
}

test('uses event details, cached team catalog, and numeric league ID for context', async () => {
  let scheduleCalls = 0;
  let teamCatalogCalls = 0;
  let tournamentLeagueId: string | null = null;

  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      scheduleCalls += 1;
      return json({
        data: {
          schedule: {
            events: [scheduleEvent(scheduleCalls === 1 ? 'selected-series' : 'changed-match-id')]
          }
        }
      });
    }
    if (url.pathname.endsWith('/getLive')) {
      return json({ data: { schedule: { events: [] } } });
    }
    if (url.pathname.endsWith('/getEventDetails')) {
      assert.equal(url.searchParams.get('id'), 'selected-series');
      return json({ data: { event: eventDetails() } });
    }
    if (url.pathname.endsWith('/getTeams')) {
      teamCatalogCalls += 1;
      assert.deepEqual(url.searchParams.getAll('id'), []);
      return json({
        data: {
          teams: [
            catalogTeam('unrelated-team', 'unrelated', 'OTHER', 'Other Team', 5),
            catalogTeam('new-bfx-id', 'bnk-fearx', 'BFX', 'BNK FEARX', 6),
            catalogTeam('dns-current-id', 'kwangdong-freecs', 'DNS', 'DN SOOPers', 12)
          ]
        }
      });
    }
    if (url.pathname.endsWith('/getTournamentsForLeague')) {
      tournamentLeagueId = url.searchParams.get('leagueId');
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
      assert.deepEqual(url.searchParams.getAll('tournamentId'), ['tournament-1']);
      return json(fullStandings());
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

  const first = await provider.getSeriesContext?.('selected-series');
  const second = await provider.getSeriesContext?.('selected-series');
  assert.ok(first);
  assert.ok(second);
  assert.equal(teamCatalogCalls, 1);
  assert.equal(tournamentLeagueId, LEAGUE_ID);
  assert.equal(first.complete, true);
  assert.equal(first.rosters.length, 2);
  assert.deepEqual(first.rosters.map(roster => roster.players.length), [6, 12]);
  assert.equal(first.rosters[0]?.team.id, 'new-bfx-id');
  assert.equal(first.rosters[1]?.team.id, 'dns-current-id');
  assert.ok(first.reasons?.some(reason => (
    reason.code === 'roster_team_fallback_match'
    && reason.message.includes('BNK FEARX')
    && reason.message.includes('code')
  )));
  assert.equal(first.standings.length, 2);
  assert.equal(first.standings[0]?.rank, 1);
  assert.equal(first.standings[0]?.team.id, 'dns-current-id');
  assert.equal(first.reasons?.some(reason => reason.code === 'standings_from_schedule_record') ?? false, false);
});

test('keeps schedule records when full standings fail and reports a missing roster', async () => {
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      return json({ data: { schedule: { events: [scheduleEvent('selected-series')] } } });
    }
    if (url.pathname.endsWith('/getLive')) {
      return json({ data: { schedule: { events: [] } } });
    }
    if (url.pathname.endsWith('/getEventDetails')) {
      return json({ data: { event: eventDetails() } });
    }
    if (url.pathname.endsWith('/getTeams')) {
      return json({
        data: {
          teams: [catalogTeam('dns-current-id', 'kwangdong-freecs', 'DNS', 'DN SOOPers', 12)]
        }
      });
    }
    if (url.pathname.endsWith('/getTournamentsForLeague')) {
      return json({ error: 'unavailable' }, 503);
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
  assert.equal(context.complete, false);
  assert.equal(context.rosters.length, 1);
  assert.equal(context.rosters[0]?.team.id, 'dns-current-id');
  assert.equal(context.standings.length, 2);
  assert.equal(context.standings[0]?.rank, null);
  assert.ok(context.reasons?.some(reason => reason.code === 'roster_team_not_found'));
  assert.ok(context.reasons?.some(reason => reason.code === 'rosters_incomplete'));
  assert.ok(context.reasons?.some(reason => reason.code === 'standings_lookup_unavailable'));
  assert.ok(context.reasons?.some(reason => reason.code === 'standings_from_schedule_record'));
});
