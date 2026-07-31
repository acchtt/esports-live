from pathlib import Path

provider_path = Path('packages/adapter-lol/src/riot-resolved-provider.ts')
test_path = Path('packages/adapter-lol/src/riot-resolved-provider.test.ts')

provider = provider_path.read_text()

placeholder_block = """function isPlaceholderTeamId(value: string | null): boolean {
  return value === null
    || /^team-\\d+$/i.test(value)
    || /^unknown-team-/i.test(value);
}
"""

tier_block = """type DevelopmentTier = 'academy' | 'challenger' | 'youth' | 'junior' | 'reserve';

const DEVELOPMENT_TIER_PATTERNS: ReadonlyArray<readonly [DevelopmentTier, RegExp]> = [
  ['academy', /(?:^| )(?:academy|academia|akademi)(?: |$)/],
  ['challenger', /(?:^| )challengers?(?: |$)/],
  ['youth', /(?:^| )youth(?: |$)/],
  ['junior', /(?:^| )(?:junior|juniors|jr)(?: |$)/],
  ['reserve', /(?:^| )(?:reserve|reserves|secondary|b team)(?: |$)/]
];

function developmentTiers(...values: readonly (string | null)[]): ReadonlySet<DevelopmentTier> {
  const text = normalizedText(values.filter((value): value is string => Boolean(value)).join(' '));
  const tiers = new Set<DevelopmentTier>();
  for (const [tier, pattern] of DEVELOPMENT_TIER_PATTERNS) {
    if (pattern.test(text)) tiers.add(tier);
  }
  return tiers;
}

function descriptorDevelopmentTiers(descriptor: TeamDescriptor): ReadonlySet<DevelopmentTier> {
  return developmentTiers(descriptor.name, descriptor.slug);
}

function catalogDevelopmentTiers(team: Json): ReadonlySet<DevelopmentTier> {
  return developmentTiers(
    firstString(team, ['name']),
    firstString(team, ['slug'])
  );
}

function developmentTierCompatible(team: Json, descriptor: TeamDescriptor): boolean {
  const expected = descriptorDevelopmentTiers(descriptor);
  const candidate = catalogDevelopmentTiers(team);
  if (!expected.size && !candidate.size) return true;
  if (!expected.size || !candidate.size) return false;
  return [...expected].some(tier => candidate.has(tier));
}

""" + placeholder_block

if provider.count(placeholder_block) != 1:
    raise SystemExit('Expected one placeholder-team block.')
provider = provider.replace(placeholder_block, tier_block)

score_setup = """  let score = 0;
  let method: TeamMatchMethod | null = null;

  if (!isPlaceholderTeamId(descriptor.id) && id === descriptor.id) {
"""
score_setup_replacement = """  let score = 0;
  let method: TeamMatchMethod | null = null;
  const leagueMatches = homeLeagueTokens(team).some(token => leagueTokens.has(token));

  // Riot event details can point academy or challenger fixtures at the parent
  // organization's team ID. Never accept a cross-tier catalog entry, even by ID.
  if (!developmentTierCompatible(team, descriptor)) return { score: 0, method: null };

  if (!isPlaceholderTeamId(descriptor.id) && id === descriptor.id) {
"""
if provider.count(score_setup) != 1:
    raise SystemExit('Expected one team-catalog score setup block.')
provider = provider.replace(score_setup, score_setup_replacement)

league_bonus = """  if (!method) return { score: 0, method: null };
  if (normalizedText(firstString(team, ['status'])) === 'active') score += 100;
  if (homeLeagueTokens(team).some(token => leagueTokens.has(token))) score += 50;
  score += Math.min(array(team.players).length, 25);
"""
league_bonus_replacement = """  if (!method) return { score: 0, method: null };
  if (normalizedText(firstString(team, ['status'])) === 'active') score += 100;
  // League affinity must dominate ambiguous shared organization codes such as
  // DK, HLE, and BFX once the development tier has been validated.
  if (leagueMatches) score += method === 'id' ? 250 : 500;
  score += Math.min(array(team.players).length, 25);
"""
if provider.count(league_bonus) != 1:
    raise SystemExit('Expected one team-catalog league bonus block.')
provider = provider.replace(league_bonus, league_bonus_replacement)
provider_path.write_text(provider)

tests = test_path.read_text()
marker = "keeps academy and challenger rosters isolated from parent organizations"
if marker in tests:
    raise SystemExit('Development roster regression test already exists.')

tests += r'''

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
              7
            ),
            developmentCatalogTeam('dk-main-id', 'dplus-kia', 'DK', 'Dplus KIA', mainLeague, 12),
            developmentCatalogTeam(
              'dk-challengers-id',
              'dk-challengers',
              'DK',
              'DK Challengers',
              developmentLeague,
              8
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
  assert.deepEqual(context.rosters.map(roster => roster.players.length), [7, 8]);
  assert.equal(context.rosters.some(roster => roster.team.id === 't1-main-id'), false);
  assert.equal(context.rosters.some(roster => roster.team.id === 'dk-main-id'), false);
  assert.ok(context.reasons?.filter(reason => reason.code === 'roster_team_fallback_match').length === 2);
});
'''

test_path.write_text(tests)

Path('.github/workflows/apply-development-roster-fix.yml').unlink(missing_ok=True)
Path('.github/scripts/apply-development-roster-fix.py').unlink(missing_ok=True)
