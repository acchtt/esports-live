from pathlib import Path

PROVIDER = Path('packages/adapter-lol/src/riot-resolved-provider.ts')
TESTS = Path('packages/adapter-lol/src/riot-resolved-provider.test.ts')
PREMATCH = Path('apps/web/src/prematch-view.ts')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


provider = PROVIDER.read_text()
provider = replace_once(
    provider,
    "const TEAM_CATALOG_TTL_MS = 15 * 60 * 1_000;\n",
    "const TEAM_CATALOG_TTL_MS = 15 * 60 * 1_000;\n"
    "const VERIFIED_LINEUP_TTL_MS = 15 * 60 * 1_000;\n"
    "const FAILED_LINEUP_TTL_MS = 2 * 60 * 1_000;\n"
    "const MAX_LINEUP_CANDIDATE_GAMES = 10;\n"
    "const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';\n",
    'provider constants'
)
provider = replace_once(
    provider,
    "interface TeamCatalogCache {\n"
    "  expiresAt: number;\n"
    "  teams: readonly Json[];\n"
    "}\n",
    "interface TeamCatalogCache {\n"
    "  expiresAt: number;\n"
    "  teams: readonly Json[];\n"
    "}\n\n"
    "type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';\n\n"
    "interface VerifiedLineupResult {\n"
    "  gameId: string | null;\n"
    "  players: readonly PlayerRef[];\n"
    "}\n\n"
    "interface VerifiedLineupCacheEntry extends VerifiedLineupResult {\n"
    "  expiresAt: number;\n"
    "}\n\n"
    "interface GameWindowCacheEntry {\n"
    "  expiresAt: number;\n"
    "  payload: unknown;\n"
    "}\n",
    'provider cache interfaces'
)

old_roster = """function rosterFromCatalog(team: Json, descriptor: TeamDescriptor): TeamRosterRef {
  const normalizedTeam = teamRef(team, descriptor);
  const playersById = new Map<string, PlayerRef>();
  for (const value of array(team.players)) {
    const player = playerRef(value, normalizedTeam.id);
    if (player) playersById.set(player.id, player);
  }
  return { team: normalizedTeam, players: [...playersById.values()] };
}
"""
new_roster = """const CANONICAL_ROLE_ORDER: readonly CanonicalRole[] = [
  'top',
  'jungle',
  'mid',
  'bottom',
  'support'
];

function canonicalRole(value: string | null): CanonicalRole | null {
  switch (normalizedText(value).replaceAll(' ', '')) {
    case 'top':
    case 'toplane': return 'top';
    case 'jungle':
    case 'jungler': return 'jungle';
    case 'mid':
    case 'middle':
    case 'midlane': return 'mid';
    case 'bottom':
    case 'bot':
    case 'botlane':
    case 'adc': return 'bottom';
    case 'support':
    case 'utility': return 'support';
    default: return null;
  }
}

function exactFivePlayerLineup(players: readonly PlayerRef[]): readonly PlayerRef[] | null {
  const byRole = new Map<CanonicalRole, PlayerRef>();
  const playerIds = new Set<string>();
  for (const player of players) {
    const role = canonicalRole(player.role ?? null);
    if (!role || byRole.has(role) || playerIds.has(player.id)) return null;
    playerIds.add(player.id);
    byRole.set(role, { ...player, role });
  }
  if (byRole.size !== CANONICAL_ROLE_ORDER.length) return null;
  return CANONICAL_ROLE_ORDER.map(role => byRole.get(role)!);
}

function catalogPlayers(team: Json, teamId: string): readonly PlayerRef[] {
  const playersById = new Map<string, PlayerRef>();
  for (const value of array(team.players)) {
    const player = playerRef(value, teamId);
    if (player) playersById.set(player.id, player);
  }
  return [...playersById.values()];
}

function developmentTierSetsCompatible(
  expected: ReadonlySet<DevelopmentTier>,
  candidate: ReadonlySet<DevelopmentTier>
): boolean {
  if (!expected.size && !candidate.size) return true;
  if (!expected.size || !candidate.size) return false;
  return [...expected].some(tier => candidate.has(tier));
}

function seriesTeamMatchesDescriptor(team: TeamRef, descriptor: TeamDescriptor): boolean {
  if (!developmentTierSetsCompatible(
    descriptorDevelopmentTiers(descriptor),
    developmentTiers(team.name, team.slug ?? null)
  )) return false;

  if (!isPlaceholderTeamId(descriptor.id) && !isPlaceholderTeamId(team.id) && team.id === descriptor.id) {
    return true;
  }
  if (normalizedText(team.name) === normalizedText(descriptor.name)) return true;
  const teamCode = normalizedText(team.code ?? null);
  const descriptorCode = normalizedText(descriptor.code);
  return Boolean(teamCode && descriptorCode && teamCode === descriptorCode);
}

function verifiedPlayersFromWindow(
  payload: unknown,
  descriptor: TeamDescriptor,
  normalizedTeam: TeamRef,
  pool: readonly PlayerRef[]
): readonly PlayerRef[] | null {
  const root = object(payload);
  const frames = array(root.frames).map(object);
  const metadata = object(root.gameMetadata ?? frames.at(-1)?.gameMetadata);
  const teamMetadata = [
    object(metadata.blueTeamMetadata),
    object(metadata.redTeamMetadata)
  ];
  const targetIds = new Set(
    [descriptor.id, normalizedTeam.id].filter(id => !isPlaceholderTeamId(id))
  );
  const selected = teamMetadata.find(team => {
    const id = firstString(team, ['esportsTeamId', 'teamId', 'id']);
    return Boolean(id && targetIds.has(id));
  });
  if (!selected) return null;

  const byHandle = new Map<string, PlayerRef[]>();
  for (const player of pool) {
    const key = normalizedText(player.handle);
    byHandle.set(key, [...(byHandle.get(key) ?? []), player]);
  }

  const verified = array(selected.participantMetadata).flatMap(value => {
    const participant = object(value);
    const handle = firstString(participant, ['summonerName', 'name']);
    const role = canonicalRole(firstString(participant, ['role', 'roleSlug']));
    if (!handle || !role) return [];
    const matches = byHandle.get(normalizedText(handle)) ?? [];
    const catalogMatch = matches.find(player => canonicalRole(player.role ?? null) === role)
      ?? matches[0]
      ?? null;
    const syntheticHandle = normalizedText(handle).replaceAll(' ', '-');
    return [{
      ...(catalogMatch ?? {
        id: `verified:${normalizedTeam.id}:${syntheticHandle}`,
        handle,
        teamId: normalizedTeam.id
      }),
      handle,
      teamId: normalizedTeam.id,
      role
    } satisfies PlayerRef];
  });
  return exactFivePlayerLineup(verified);
}
"""
provider = replace_once(provider, old_roster, new_roster, 'provider roster helper')

request_marker = "\nexport function createRiotLolResolvedProvider(options: RiotLolProviderOptions): LolProviderClient {"
public_request = """

async function requestPublicJson(fetcher: FetchLike, url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Riot live feed returned HTTP ${response.status}.`);
    return body.trim() ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timer);
  }
}
"""
if request_marker not in provider:
    raise SystemExit('provider export marker not found')
provider = provider.replace(request_marker, public_request + request_marker, 1)

provider = replace_once(
    provider,
    "  let teamCatalogCache: TeamCatalogCache | null = null;\n"
    "  let teamCatalogInFlight: Promise<readonly Json[]> | null = null;\n",
    "  let teamCatalogCache: TeamCatalogCache | null = null;\n"
    "  let teamCatalogInFlight: Promise<readonly Json[]> | null = null;\n"
    "  const verifiedLineupCache = new Map<string, VerifiedLineupCacheEntry>();\n"
    "  const verifiedLineupInFlight = new Map<string, Promise<VerifiedLineupResult>>();\n"
    "  const gameWindowCache = new Map<string, GameWindowCacheEntry>();\n"
    "  const gameWindowInFlight = new Map<string, Promise<unknown>>();\n",
    'provider runtime caches'
)

return_marker = "\n\n  return {\n    id: primary.id,"
loaders = """

  const loadGameWindow = async (gameId: string): Promise<unknown> => {
    const currentTime = now().getTime();
    const cached = gameWindowCache.get(gameId);
    if (cached && cached.expiresAt > currentTime) return cached.payload;
    const pending = gameWindowInFlight.get(gameId);
    if (pending) return pending;

    const url = new URL(`${LIVE_BASE}/window/${encodeURIComponent(gameId)}`);
    const request = requestPublicJson(fetcher, url)
      .catch(() => null)
      .then(payload => {
        gameWindowCache.set(gameId, {
          payload,
          expiresAt: now().getTime() + (payload ? VERIFIED_LINEUP_TTL_MS : FAILED_LINEUP_TTL_MS)
        });
        return payload;
      })
      .finally(() => {
        if (gameWindowInFlight.get(gameId) === request) gameWindowInFlight.delete(gameId);
      });
    gameWindowInFlight.set(gameId, request);
    return request;
  };

  const loadVerifiedLineup = async (
    descriptor: TeamDescriptor,
    normalizedTeam: TeamRef,
    pool: readonly PlayerRef[],
    selectedSeries: LolProviderSeries
  ): Promise<VerifiedLineupResult> => {
    const key = [
      normalizedTeam.id,
      selectedSeries.competition.id,
      normalizedText(descriptor.name)
    ].join(':');
    const cached = verifiedLineupCache.get(key);
    if (cached && cached.expiresAt > now().getTime()) {
      return { gameId: cached.gameId, players: cached.players };
    }
    const pending = verifiedLineupInFlight.get(key);
    if (pending) return pending;

    const request = (async (): Promise<VerifiedLineupResult> => {
      const selectedStart = Date.parse(selectedSeries.scheduledStart);
      const candidateGames = [...recentSeries.values()]
        .filter(series => (
          !Number.isFinite(selectedStart)
          || !Number.isFinite(Date.parse(series.scheduledStart))
          || Date.parse(series.scheduledStart) <= selectedStart + EVENT_TIME_TOLERANCE_MS
        ))
        .filter(series => series.teams.some(team => seriesTeamMatchesDescriptor(team, descriptor)))
        .flatMap(series => series.games.map(game => ({ game, series })))
        .sort((left, right) => (
          Number(right.game.state === 'completed') - Number(left.game.state === 'completed')
          || Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart)
          || right.game.number - left.game.number
        ));

      const seen = new Set<string>();
      for (const { game } of candidateGames) {
        if (seen.has(game.id)) continue;
        seen.add(game.id);
        if (seen.size > MAX_LINEUP_CANDIDATE_GAMES) break;
        const payload = await loadGameWindow(game.id);
        const players = verifiedPlayersFromWindow(payload, descriptor, normalizedTeam, pool);
        if (players) return { gameId: game.id, players };
      }
      return { gameId: null, players: [] };
    })()
      .then(result => {
        verifiedLineupCache.set(key, {
          ...result,
          expiresAt: now().getTime()
            + (result.players.length === 5 ? VERIFIED_LINEUP_TTL_MS : FAILED_LINEUP_TTL_MS)
        });
        return result;
      })
      .finally(() => {
        if (verifiedLineupInFlight.get(key) === request) verifiedLineupInFlight.delete(key);
      });
    verifiedLineupInFlight.set(key, request);
    return request;
  };
"""
if return_marker not in provider:
    raise SystemExit('provider return marker not found')
provider = provider.replace(return_marker, loaders + return_marker, 1)

old_resolution = """          const roster = rosterFromCatalog(match.team, descriptor);
          if (roster.players.length < 5) {
            reasons.push({
              code: 'roster_player_count_low',
              message: `${roster.team.name} has fewer than five players in Riot's current team catalog.`
            });
          }
          resolved.push(roster);
"""
new_resolution = """          const normalizedTeam = teamRef(match.team, descriptor);
          const pool = catalogPlayers(match.team, normalizedTeam.id);
          let players = exactFivePlayerLineup(pool) ?? [];
          if (players.length !== 5) {
            const verified = await loadVerifiedLineup(descriptor, normalizedTeam, pool, normalized);
            players = verified.players;
            if (players.length === 5) {
              reasons.push({
                code: 'roster_from_recent_verified_lineup',
                message: `${normalizedTeam.name} uses the last five-player lineup verified from Riot gameplay${verified.gameId ? ` (${verified.gameId})` : ''}; it is not a confirmed starting lineup for this match.`
              });
            } else {
              reasons.push({
                code: 'roster_pool_ambiguous',
                message: `${normalizedTeam.name}'s Riot team record combines substitutes or multiple squads, and no exact five-player gameplay lineup could be verified.`
              });
            }
          }
          resolved.push({ team: normalizedTeam, players });
"""
provider = replace_once(provider, old_resolution, new_resolution, 'provider roster resolution')
provider = replace_once(
    provider,
    "      const rostersComplete = rosters.length >= 2\n"
    "        && rosters.every(roster => roster.players.length >= 5);\n",
    "      const rostersComplete = rosters.length >= 2\n"
    "        && rosters.every(roster => exactFivePlayerLineup(roster.players) !== null);\n",
    'provider completeness rule'
)
PROVIDER.write_text(provider)


tests = TESTS.read_text()
tests = tests.replace(
    "catalogTeam('new-bfx-id', 'bnk-fearx', 'BFX', 'BNK FEARX', 6)",
    "catalogTeam('new-bfx-id', 'bnk-fearx', 'BFX', 'BNK FEARX', 5)"
)
tests = tests.replace(
    "catalogTeam('dns-current-id', 'kwangdong-freecs', 'DNS', 'DN SOOPers', 12)",
    "catalogTeam('dns-current-id', 'kwangdong-freecs', 'DNS', 'DN SOOPers', 5)"
)
tests = tests.replace(
    "assert.deepEqual(first.rosters.map(roster => roster.players.length), [6, 12]);",
    "assert.deepEqual(first.rosters.map(roster => roster.players.length), [5, 5]);"
)
tests = tests.replace(
    "developmentLeague,\n              7\n",
    "developmentLeague,\n              5\n"
)
tests = tests.replace(
    "developmentLeague,\n              8\n",
    "developmentLeague,\n              5\n"
)
tests = tests.replace(
    "assert.deepEqual(context.rosters.map(roster => roster.players.length), [7, 8]);",
    "assert.deepEqual(context.rosters.map(roster => roster.players.length), [5, 5]);"
)

if "resolves mixed organization pools from a verified five-player game lineup" not in tests:
    tests += r'''

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
'''
TESTS.write_text(tests)


prematch = PREMATCH.read_text()
prematch = replace_once(
    prematch,
    "      <span class=\"prematch-section-title\">Roster</span>",
    "      <span class=\"prematch-section-title\">Available five-player lineup</span>",
    'prematch roster label'
)
prematch = replace_once(
    prematch,
    "  const reason = context.reasons[0]?.message;\n\n"
    "  return `\n"
    "    <section class=\"prematch-context\">\n"
    "      <div class=\"prematch-rosters\">\n"
    "        ${rosterMarkup(leftRoster, left)}\n"
    "        ${rosterMarkup(rightRoster, right)}\n"
    "      </div>\n"
    "      <section class=\"prematch-standings\">",
    "  const reason = context.reasons[0]?.message;\n"
    "  const verifiedHistoricalLineup = context.reasons.some(item => (\n"
    "    item.code === 'roster_from_recent_verified_lineup'\n"
    "  ));\n\n"
    "  return `\n"
    "    <section class=\"prematch-context\">\n"
    "      <div class=\"prematch-rosters\">\n"
    "        ${rosterMarkup(leftRoster, left)}\n"
    "        ${rosterMarkup(rightRoster, right)}\n"
    "      </div>\n"
    "      ${verifiedHistoricalLineup ? `\n"
    "        <div class=\"prematch-notice warning\">\n"
    "          <strong>Last verified gameplay lineup</strong>\n"
    "          <p>These five-player lineups come from each team's most recent available Riot gameplay frame. They are not confirmed starters for this match.</p>\n"
    "        </div>` : ''}\n"
    "      <section class=\"prematch-standings\">",
    'prematch verified lineup notice'
)
PREMATCH.write_text(prematch)
