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
            catalogTeam('new-bfx-id', 'bnk-fearx', 'BFX', 'BNK FEARX', 5),
            catalogTeam('dns-current-id', 'kwangdong-freecs', 'DNS', 'DN SOOPers', 5)
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
  assert.deepEqual(first.rosters.map(roster => roster.players.length), [5, 5]);
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
          teams: [catalogTeam('dns-current-id', 'kwangdong-freecs', 'DNS', 'DN SOOPers', 5)]
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


test('keeps academy and challenger rosters isolated from parent organizations', async () => {
  const developmentLeagueId = 'lck-challengers-id';

  const developmentScheduleEvent = {
    state: 'unstarted',
    startTime: '2026-07-31T08:00:00.000Z',
    blockName: 'Week 10',
    league: { name: 'LCK Challengers', slug: 'lck_challengers_league' },
    match: {
      id: 'development-series',
      strategy: { count: 3 },
      teams: [{
        name: 'T1 Esports Academy',
        code: 'T1A',
        record: { wins: 8, losses: 2 }
      }, {
        name: 'DK Challengers',
        code: 'DK',
        record: { wins: 7, losses: 3 }
      }],
      games: [{ id: 'development-game-1', number: 1, state: 'unstarted' }]
    }
  };

  const developmentDetails = {
    id: 'development-series',
    league: {
      id: developmentLeagueId,
      slug: 'lck_challengers_league',
      name: 'LCK Challengers'
    },
    match: {
      strategy: { count: 3 },
      teams: [{
        // Riot can expose the parent organization's ID here.
        id: 't1-main-id',
        name: 'T1 Esports Academy',
        code: 'T1A'
      }, {
        id: 'dk-main-id',
        name: 'DK Challengers',
        code: 'DK'
      }],
      games: [{ id: 'development-game-1', number: 1, state: 'unstarted' }]
    }
  };

  const developmentCatalogTeam = (
    id: string,
    slug: string,
    code: string,
    name: string,
    homeLeague: { id: string; slug: string; name: string },
    playerCount: number
  ) => ({
    id,
    slug,
    code,
    name,
    status: 'active',
    homeLeague,
    players: Array.from({ length: playerCount }, (_, index) => ({
      id: `${id}-player-${index + 1}`,
      summonerName: `${code} Player ${index + 1}`,
      role: ['top', 'jungle', 'mid', 'bottom', 'support', 'sub'][index % 6]
    }))
  });

  const mainLeague = { id: LEAGUE_ID, slug: 'lck', name: 'LCK' };
  const developmentLeague = {
    id: developmentLeagueId,
    slug: 'lck_challengers_league',
    name: 'LCK Challengers'
  };

  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      return json({ data: { schedule: { events: [developmentScheduleEvent] } } });
    }
    if (url.pathname.endsWith('/getLive')) {
      return json({ data: { schedule: { events: [] } } });
    }
    if (url.pathname.endsWith('/getEventDetails')) {
      return json({ data: { event: developmentDetails } });
    }
    if (url.pathname.endsWith('/getTeams')) {
      return json({
        data: {
          teams: [
            developmentCatalogTeam('t1-main-id', 't1', 'T1', 'T1', mainLeague, 12),
            developmentCatalogTeam(
              't1-academy-id',
              't1-esports-academy',
              'T1A',
              'T1 Esports Academy',
              developmentLeague,
              5
            ),
            developmentCatalogTeam('dk-main-id', 'dplus-kia', 'DK', 'Dplus KIA', mainLeague, 12),
            developmentCatalogTeam(
              'dk-challengers-id',
              'dk-challengers',
              'DK',
              'DK Challengers',
              developmentLeague,
              5
            )
          ]
        }
      });
    }
    if (url.pathname.endsWith('/getTournamentsForLeague')) {
      assert.equal(url.searchParams.get('leagueId'), developmentLeagueId);
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
  assert.equal(selected, 'development-series');

  const context = await provider.getSeriesContext?.(selected);
  assert.ok(context);
  assert.deepEqual(
    context.rosters.map(roster => roster.team.id),
    ['t1-academy-id', 'dk-challengers-id']
  );
  assert.deepEqual(context.rosters.map(roster => roster.players.length), [5, 5]);
  assert.equal(context.rosters.some(roster => roster.team.id === 't1-main-id'), false);
  assert.equal(context.rosters.some(roster => roster.team.id === 'dk-main-id'), false);
  assert.ok(context.reasons?.filter(reason => reason.code === 'roster_team_fallback_match').length === 2);
});


test('resolves mixed organization pools from a verified five-player game lineup', async () => {
  const developmentLeagueId = 'lck-challengers-id';
  const currentEvent = {
    state: 'unstarted',
    startTime: '2026-07-31T08:00:00.000Z',
    league: { id: developmentLeagueId, slug: 'lck-challengers', name: 'LCK Challengers' },
    match: {
      id: 'academy-current',
      strategy: { count: 3 },
      teams: [
        { id: 't1-academy-id', name: 'T1 Esports Academy', code: 'T1A' },
        { id: 'dk-challengers-id', name: 'DK Challengers', code: 'DK' }
      ],
      games: [{ id: 'future-game', number: 1, state: 'unstarted' }]
    }
  };
  const previousEvent = {
    ...currentEvent,
    state: 'completed',
    startTime: '2026-07-30T08:00:00.000Z',
    match: {
      ...currentEvent.match,
      id: 'academy-previous',
      games: [{ id: 'verified-game', number: 1, state: 'completed' }]
    }
  };
  const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
  const academyHandles = ['Guardian', 'Painter', 'Guti', 'Cypher', 'Cloud'];
  const dkHandles = ['Nevid', 'Solid', 'Garden', 'Wayne', 'Career'];
  const mixedTeam = (id: string, slug: string, code: string, name: string, own: readonly string[], senior: readonly string[]) => ({
    id,
    slug,
    code,
    name,
    status: 'active',
    homeLeague: { id: developmentLeagueId, slug: 'lck-challengers', name: 'LCK Challengers' },
    players: [...own, ...senior].map((handle, index) => ({
      id: `${id}-${handle}`,
      summonerName: handle,
      role: roles[index % 5]
    }))
  });
  let verifiedWindowCalls = 0;
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      return json({ data: { schedule: { events: [currentEvent, previousEvent] } } });
    }
    if (url.pathname.endsWith('/getLive')) return json({ data: { schedule: { events: [] } } });
    if (url.pathname.endsWith('/getEventDetails')) {
      return json({ data: { event: currentEvent } });
    }
    if (url.pathname.endsWith('/getTeams')) {
      return json({ data: { teams: [
        mixedTeam('t1-academy-id', 't1-challengers', 'T1A', 'T1 Esports Academy', academyHandles, ['Doran', 'Oner', 'Faker', 'Peyz', 'Keria']),
        mixedTeam('dk-challengers-id', 'dwg-kia-challengers', 'DK', 'DK Challengers', dkHandles, ['Siwoo', 'Lucid', 'ShowMaker', 'Smash', 'Loopy'])
      ] } });
    }
    if (url.pathname.endsWith('/getTournamentsForLeague')) return json({ error: 'unavailable' }, 503);
    if (url.pathname.includes('/window/future-game')) return json({ error: 'not_started' }, 404);
    if (url.pathname.includes('/window/verified-game')) {
      verifiedWindowCalls += 1;
      const metadata = (teamId: string, handles: readonly string[]) => ({
        esportsTeamId: teamId,
        participantMetadata: handles.map((summonerName, index) => ({
          participantId: index + 1,
          summonerName,
          role: roles[index]
        }))
      });
      return json({
        gameMetadata: {
          blueTeamMetadata: metadata('t1-academy-id', academyHandles),
          redTeamMetadata: metadata('dk-challengers-id', dkHandles)
        },
        frames: []
      });
    }
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };

  const provider = createRiotLolResolvedProvider({ apiKey: 'test-key', fetcher, now: () => new Date(NOW) });
  await provider.getSchedule();
  const context = await provider.getSeriesContext?.('academy-current');
  assert.ok(context);
  assert.equal(context.complete, false);
  assert.deepEqual(context.rosters.map(roster => roster.players.map(player => player.handle)), [
    academyHandles,
    dkHandles
  ]);
  assert.equal(context.rosters.every(roster => roster.players.length === 5), true);
  assert.equal(context.rosters.some(roster => roster.players.some(player => ['Faker', 'ShowMaker'].includes(player.handle))), false);
  assert.equal(verifiedWindowCalls, 1);
  assert.equal(context.reasons?.filter(reason => reason.code === 'roster_from_recent_verified_lineup').length, 2);
});

test('hides an ambiguous organization pool when no gameplay lineup can be verified', async () => {
  const event = scheduleEvent('selected-series');
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) return json({ data: { schedule: { events: [event] } } });
    if (url.pathname.endsWith('/getLive')) return json({ data: { schedule: { events: [] } } });
    if (url.pathname.endsWith('/getEventDetails')) return json({ data: { event: eventDetails() } });
    if (url.pathname.endsWith('/getTeams')) return json({ data: { teams: [
      catalogTeam('new-bfx-id', 'bnk-fearx', 'BFX', 'BNK FEARX', 10),
      catalogTeam('dns-current-id', 'kwangdong-freecs', 'DNS', 'DN SOOPers', 10)
    ] } });
    if (url.pathname.endsWith('/getTournamentsForLeague')) return json({ error: 'unavailable' }, 503);
    if (url.pathname.includes('/window/')) return json({ error: 'unavailable' }, 404);
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };

  const provider = createRiotLolResolvedProvider({ apiKey: 'test-key', fetcher, now: () => new Date(NOW) });
  await provider.getSchedule();
  const context = await provider.getSeriesContext?.('selected-series');
  assert.ok(context);
  assert.equal(context.complete, false);
  assert.deepEqual(context.rosters.map(roster => roster.players.length), [0, 0]);
  assert.equal(context.reasons?.filter(reason => reason.code === 'roster_pool_ambiguous').length, 2);
});
