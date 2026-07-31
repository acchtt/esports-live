import type {
  PlayerRef,
  QualityReason,
  StandingRef,
  TeamRef,
  TeamRosterRef
} from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderSeries,
  LolProviderSeriesContext
} from './provider.ts';
import { createRiotLolContextProvider } from './riot-context-provider.ts';
import { createRiotLolProvider, type RiotLolProviderOptions } from './riot-provider.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const REQUEST_TIMEOUT_MS = 8_000;
const EVENT_TIME_TOLERANCE_MS = 12 * 60 * 60 * 1_000;
const MAX_RECENT_SERIES = 500;
const TEAM_CATALOG_TTL_MS = 15 * 60 * 1_000;
const VERIFIED_LINEUP_TTL_MS = 15 * 60 * 1_000;
const FAILED_LINEUP_TTL_MS = 2 * 60 * 1_000;
const MAX_LINEUP_CANDIDATE_GAMES = 10;
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type TeamMatchMethod = 'id' | 'slug' | 'code' | 'name';

interface TeamDescriptor {
  id: string;
  name: string;
  code: string | null;
  slug: string | null;
  imageUrl: string | null;
}

interface TeamCatalogMatch {
  team: Json;
  method: TeamMatchMethod;
}

interface TeamCatalogCache {
  expiresAt: number;
  teams: readonly Json[];
}

type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

interface VerifiedLineupResult {
  gameId: string | null;
  players: readonly PlayerRef[];
}

interface VerifiedLineupCacheEntry extends VerifiedLineupResult {
  expiresAt: number;
}

interface GameWindowCacheEntry {
  expiresAt: number;
  payload: unknown;
}

const object = (value: unknown): Json => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
);
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(source: Json, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = stringValue(source[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(source: Json, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = numericValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizedText(value: string | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type DevelopmentTier = 'academy' | 'challenger' | 'youth' | 'junior' | 'reserve';

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

function isPlaceholderTeamId(value: string | null): boolean {
  return value === null
    || /^team-\d+$/i.test(value)
    || /^unknown-team-/i.test(value);
}

function scheduleEvents(payload: unknown): readonly Json[] {
  const root = object(payload);
  const data = object(root.data);
  return array(object(data.schedule ?? root.schedule).events).map(object);
}

function eventFromDetails(payload: unknown): Json {
  const root = object(payload);
  const data = object(root.data);
  return object(data.event ?? root.event ?? data);
}

function eventIds(event: Json): readonly string[] {
  const match = object(event.match);
  return [firstString(event, ['id']), firstString(match, ['id'])]
    .filter((value): value is string => value !== null);
}

function eventTeamDescriptors(event: Json): readonly TeamDescriptor[] {
  return array(object(event.match).teams).map((value, index) => {
    const team = object(value);
    return {
      id: firstString(team, ['id', 'teamId']) ?? `unknown-team-${index + 1}`,
      name: firstString(team, ['name', 'code', 'slug']) ?? `Team ${index + 1}`,
      code: firstString(team, ['code', 'acronym']),
      slug: firstString(team, ['slug']),
      imageUrl: firstString(team, ['image', 'imageUrl', 'alternativeImage', 'logo'])
    };
  });
}

function seriesTeamDescriptors(series: LolProviderSeries): readonly TeamDescriptor[] {
  return series.teams.map(team => ({
    id: team.id,
    name: team.name,
    code: team.code ?? null,
    slug: team.slug ?? null,
    imageUrl: team.imageUrl ?? null
  }));
}

function descriptorMatch(
  source: readonly TeamDescriptor[],
  target: TeamDescriptor,
  index: number
): TeamDescriptor | undefined {
  if (!isPlaceholderTeamId(target.id)) {
    const byId = source.find(candidate => candidate.id === target.id);
    if (byId) return byId;
  }
  const code = normalizedText(target.code);
  if (code) {
    const byCode = source.find(candidate => normalizedText(candidate.code) === code);
    if (byCode) return byCode;
  }
  const name = normalizedText(target.name);
  if (name) {
    const byName = source.find(candidate => normalizedText(candidate.name) === name);
    if (byName) return byName;
  }
  return source[index];
}

function mergeDescriptorLayers(
  normalized: readonly TeamDescriptor[],
  schedule: readonly TeamDescriptor[],
  details: readonly TeamDescriptor[]
): readonly TeamDescriptor[] {
  return normalized.map((base, index) => {
    const scheduleTeam = descriptorMatch(schedule, base, index);
    const detailTeam = descriptorMatch(details, scheduleTeam ?? base, index)
      ?? descriptorMatch(details, base, index);
    const candidates = [detailTeam, scheduleTeam, base].filter(
      (candidate): candidate is TeamDescriptor => candidate !== undefined
    );
    const actualId = candidates
      .map(candidate => candidate.id)
      .find(id => !isPlaceholderTeamId(id));
    return {
      id: actualId ?? base.id,
      name: base.name || scheduleTeam?.name || detailTeam?.name || `Team ${index + 1}`,
      code: base.code ?? scheduleTeam?.code ?? detailTeam?.code ?? null,
      slug: base.slug ?? scheduleTeam?.slug ?? detailTeam?.slug ?? null,
      imageUrl: base.imageUrl ?? scheduleTeam?.imageUrl ?? detailTeam?.imageUrl ?? null
    };
  });
}

function descriptorIdentityMatches(left: TeamDescriptor, right: TeamDescriptor): boolean {
  if (!isPlaceholderTeamId(left.id) && !isPlaceholderTeamId(right.id) && left.id === right.id) return true;
  const leftCode = normalizedText(left.code);
  const rightCode = normalizedText(right.code);
  if (leftCode && rightCode && leftCode === rightCode) return true;
  const leftName = normalizedText(left.name);
  const rightName = normalizedText(right.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

function eventMatchesSeries(event: Json, series: LolProviderSeries): boolean {
  if (eventIds(event).includes(series.id)) return true;

  const eventTeams = eventTeamDescriptors(event);
  const seriesTeams = seriesTeamDescriptors(series);
  const teamsMatch = seriesTeams.length === 2
    && eventTeams.length === 2
    && seriesTeams.every(team => eventTeams.some(candidate => descriptorIdentityMatches(team, candidate)));
  if (!teamsMatch) return false;

  const eventStart = Date.parse(firstString(event, ['startTime', 'scheduledStart']) ?? '');
  const seriesStart = Date.parse(series.scheduledStart);
  return Number.isFinite(eventStart)
    && Number.isFinite(seriesStart)
    && Math.abs(eventStart - seriesStart) <= EVENT_TIME_TOLERANCE_MS;
}

function teamRef(value: Json, fallback: TeamDescriptor): TeamRef {
  const code = firstString(value, ['code', 'acronym']) ?? fallback.code;
  const slug = firstString(value, ['slug']) ?? fallback.slug;
  const imageUrl = firstString(value, ['image', 'imageUrl', 'alternativeImage', 'logo'])
    ?? fallback.imageUrl;
  return {
    id: firstString(value, ['id', 'teamId']) ?? fallback.id,
    name: firstString(value, ['name', 'code', 'slug']) ?? fallback.name,
    ...(code ? { code } : {}),
    ...(slug ? { slug } : {}),
    ...(imageUrl ? { imageUrl } : {})
  };
}

function playerRef(value: unknown, teamId: string): PlayerRef | null {
  const player = object(value);
  const id = firstString(player, ['id', 'playerId']);
  const handle = firstString(player, ['summonerName', 'name', 'slug']);
  if (!id || !handle) return null;
  const role = firstString(player, ['role', 'roleSlug']);
  const imageUrl = firstString(player, ['image', 'imageUrl', 'photoUrl']);
  const displayName = [
    firstString(player, ['firstName']),
    firstString(player, ['lastName'])
  ].filter(Boolean).join(' ') || null;
  return {
    id,
    handle,
    teamId,
    ...(role ? { role } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function catalogTeams(payload: unknown): readonly Json[] {
  const root = object(payload);
  return array(object(root.data).teams ?? root.teams).map(object);
}

function homeLeagueTokens(team: Json): readonly string[] {
  const league = object(team.homeLeague);
  return [
    firstString(league, ['id']),
    firstString(league, ['slug']),
    firstString(league, ['name'])
  ].map(normalizedText).filter(Boolean);
}

function teamCatalogScore(
  team: Json,
  descriptor: TeamDescriptor,
  leagueTokens: ReadonlySet<string>
): { score: number; method: TeamMatchMethod | null } {
  const id = firstString(team, ['id', 'teamId']);
  const slug = firstString(team, ['slug']);
  const code = firstString(team, ['code', 'acronym']);
  const name = firstString(team, ['name']);
  let score = 0;
  let method: TeamMatchMethod | null = null;
  const leagueMatches = homeLeagueTokens(team).some(token => leagueTokens.has(token));

  // Riot event details can point academy or challenger fixtures at the parent
  // organization's team ID. Never accept a cross-tier catalog entry, even by ID.
  if (!developmentTierCompatible(team, descriptor)) return { score: 0, method: null };

  if (!isPlaceholderTeamId(descriptor.id) && id === descriptor.id) {
    score = 10_000;
    method = 'id';
  } else if (descriptor.slug && normalizedText(slug) === normalizedText(descriptor.slug)) {
    score = 2_000;
    method = 'slug';
  } else if (descriptor.code && normalizedText(code) === normalizedText(descriptor.code)) {
    score = 1_000;
    method = 'code';
  } else if (normalizedText(name) && normalizedText(name) === normalizedText(descriptor.name)) {
    score = 800;
    method = 'name';
  }

  if (!method) return { score: 0, method: null };
  if (normalizedText(firstString(team, ['status'])) === 'active') score += 100;
  // League affinity must dominate ambiguous shared organization codes such as
  // DK, HLE, and BFX once the development tier has been validated.
  if (leagueMatches) score += method === 'id' ? 250 : 500;
  score += Math.min(array(team.players).length, 25);
  return { score, method };
}

function matchCatalogTeam(
  catalog: readonly Json[],
  descriptor: TeamDescriptor,
  leagueTokens: ReadonlySet<string>,
  usedIds: ReadonlySet<string>
): TeamCatalogMatch | null {
  let selected: { team: Json; score: number; method: TeamMatchMethod } | null = null;
  for (const team of catalog) {
    const id = firstString(team, ['id', 'teamId']);
    if (id && usedIds.has(id)) continue;
    const candidate = teamCatalogScore(team, descriptor, leagueTokens);
    if (!candidate.method || candidate.score <= 0) continue;
    if (!selected || candidate.score > selected.score) {
      selected = { team, score: candidate.score, method: candidate.method };
    }
  }
  return selected ? { team: selected.team, method: selected.method } : null;
}

const CANONICAL_ROLE_ORDER: readonly CanonicalRole[] = [
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

  const byId = new Map(pool.map(player => [player.id, player] as const));
  const byHandle = new Map<string, PlayerRef[]>();
  for (const player of pool) {
    const key = normalizedText(player.handle);
    byHandle.set(key, [...(byHandle.get(key) ?? []), player]);
  }

  const verified = array(selected.participantMetadata).flatMap(value => {
    const participant = object(value);
    const rawHandle = firstString(participant, ['summonerName', 'name']);
    const esportsPlayerId = firstString(participant, ['esportsPlayerId', 'playerId']);
    const role = canonicalRole(firstString(participant, ['role', 'roleSlug']));
    if (!rawHandle || !role) return [];
    const directMatch = esportsPlayerId ? byId.get(esportsPlayerId) : undefined;
    const handleMatches = byHandle.get(normalizedText(rawHandle)) ?? [];
    const catalogMatch = directMatch
      ?? handleMatches.find(player => canonicalRole(player.role ?? null) === role)
      ?? handleMatches[0]
      ?? null;
    const handle = catalogMatch?.handle ?? rawHandle;
    const syntheticHandle = normalizedText(handle).replaceAll(' ', '-');
    return [{
      ...(catalogMatch ?? {
        id: esportsPlayerId ?? `verified:${normalizedTeam.id}:${syntheticHandle}`,
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

function scheduleRecordStandings(event: Json, descriptors: readonly TeamDescriptor[]): readonly StandingRef[] {
  const stage = firstString(event, ['blockName', 'stage']);
  return array(object(event.match).teams).flatMap((value, index) => {
    const team = object(value);
    const record = object(team.record);
    const wins = firstNumber(record, ['wins']);
    const losses = firstNumber(record, ['losses']);
    if (wins === null && losses === null) return [];
    const rawDescriptor = eventTeamDescriptors(event)[index];
    const fallback = rawDescriptor
      ? descriptorMatch(descriptors, rawDescriptor, index) ?? descriptors[index] ?? rawDescriptor
      : descriptors[index] ?? {
        id: `unknown-team-${index + 1}`,
        name: `Team ${index + 1}`,
        code: null,
        slug: null,
        imageUrl: null
      };
    return [{
      rank: null,
      team: teamRef(team, fallback),
      wins,
      losses,
      ...(stage ? { group: stage } : {})
    }];
  });
}

function tournamentList(payload: unknown): readonly Json[] {
  const root = object(payload);
  return array(object(root.data).leagues ?? root.leagues)
    .map(object)
    .flatMap(league => array(league.tournaments).map(object));
}

function selectTournament(payload: unknown, scheduledStart: string): Json | null {
  const tournaments = tournamentList(payload);
  if (!tournaments.length) return null;
  const day = Number.isFinite(Date.parse(scheduledStart))
    ? new Date(scheduledStart).toISOString().slice(0, 10)
    : null;
  if (!day) return tournaments[0] ?? null;
  return tournaments.find(tournament => {
    const start = firstString(tournament, ['startDate']);
    const end = firstString(tournament, ['endDate']);
    return (!start || start <= day) && (!end || end >= day);
  }) ?? tournaments[0] ?? null;
}

function parseStandings(payload: unknown): readonly StandingRef[] {
  const root = object(payload);
  const standings = array(object(root.data).standings ?? root.standings).map(object);
  const entries: StandingRef[] = [];
  for (const standing of standings) {
    for (const stageValue of array(standing.stages)) {
      const stage = object(stageValue);
      for (const sectionValue of array(stage.sections)) {
        const section = object(sectionValue);
        const group = [
          firstString(stage, ['name', 'slug']),
          firstString(section, ['name', 'slug'])
        ].filter(Boolean).join(' · ');
        for (const rankingValue of array(section.rankings)) {
          const ranking = object(rankingValue);
          for (const teamValue of array(ranking.teams)) {
            const team = object(teamValue);
            const record = object(team.record);
            const fallback: TeamDescriptor = {
              id: firstString(team, ['id', 'teamId']) ?? 'unknown-team',
              name: firstString(team, ['name', 'code', 'slug']) ?? 'Unknown team',
              code: firstString(team, ['code', 'acronym']),
              slug: firstString(team, ['slug']),
              imageUrl: firstString(team, ['image', 'imageUrl', 'logo'])
            };
            entries.push({
              rank: firstNumber(ranking, ['ordinal', 'rank']),
              team: teamRef(team, fallback),
              wins: firstNumber(record, ['wins']),
              losses: firstNumber(record, ['losses']),
              ...(group ? { group } : {})
            });
          }
        }
      }
    }
  }
  return entries.sort((left, right) => (
    (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)
    || left.team.name.localeCompare(right.team.name)
  ));
}

async function requestJson(fetcher: FetchLike, url: URL, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      cache: 'no-store',
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Riot upstream returned HTTP ${response.status}.`);
    return body.trim() ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timer);
  }
}


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

export function createRiotLolResolvedProvider(options: RiotLolProviderOptions): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const primary = createRiotLolContextProvider({ ...options, fetcher });
  const base = createRiotLolProvider({ ...options, fetcher });
  const recentSeries = new Map<string, LolProviderSeries>();
  let teamCatalogCache: TeamCatalogCache | null = null;
  let teamCatalogInFlight: Promise<readonly Json[]> | null = null;
  const verifiedLineupCache = new Map<string, VerifiedLineupCacheEntry>();
  const verifiedLineupInFlight = new Map<string, Promise<VerifiedLineupResult>>();
  const gameWindowCache = new Map<string, GameWindowCacheEntry>();
  const gameWindowInFlight = new Map<string, Promise<unknown>>();

  const remember = (series: readonly LolProviderSeries[]): void => {
    if (recentSeries.size + series.length > MAX_RECENT_SERIES) recentSeries.clear();
    for (const item of series) recentSeries.set(item.id, item);
  };

  const persisted = async (
    path: string,
    params: Record<string, string | readonly string[] | undefined>
  ): Promise<unknown> => {
    const url = new URL(`${PERSISTED_BASE}/${path}`);
    url.searchParams.set('hl', locale);
    for (const [name, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(name, item));
      else if (typeof value === 'string' && value) url.searchParams.set(name, value);
    }
    return requestJson(fetcher, url, apiKey);
  };

  const loadTeamCatalog = async (): Promise<readonly Json[]> => {
    const currentTime = now().getTime();
    if (teamCatalogCache && teamCatalogCache.expiresAt > currentTime) return teamCatalogCache.teams;
    if (teamCatalogInFlight) return teamCatalogInFlight;

    const request = persisted('getTeams', {})
      .then(catalogTeams)
      .then(teams => {
        teamCatalogCache = { teams, expiresAt: now().getTime() + TEAM_CATALOG_TTL_MS };
        return teams;
      })
      .finally(() => {
        if (teamCatalogInFlight === request) teamCatalogInFlight = null;
      });
    teamCatalogInFlight = request;
    return request;
  };

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
      const selectedGames = selectedSeries.games
        .map(game => ({ game, series: selectedSeries }))
        .sort((left, right) => (
          Number(right.game.state === 'completed') - Number(left.game.state === 'completed')
          || right.game.number - left.game.number
        ));
      const historicalGames = [...recentSeries.values()]
        .filter(series => series.id !== selectedSeries.id)
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
      const candidateGames = [...selectedGames, ...historicalGames];

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


  return {
    id: primary.id,
    name: primary.name,
    ...(primary.sourceUrl ? { sourceUrl: primary.sourceUrl } : {}),

    async getSchedule() {
      const entries = await primary.getSchedule();
      remember(entries.map(entry => entry.series));
      return entries;
    },

    getSnapshot: (gameId: string, after?: string) => primary.getSnapshot(gameId, after),

    async getSeriesContext(seriesId: string): Promise<LolProviderSeriesContext> {
      const reasons: QualityReason[] = [];
      const rawSchedulePromise = persisted('getSchedule', {}).catch(error => {
        reasons.push({
          code: 'schedule_context_unavailable',
          message: error instanceof Error ? error.message : 'Riot schedule context is unavailable.'
        });
        return null;
      });
      const detailsPromise = persisted('getEventDetails', { id: seriesId }).catch(error => {
        reasons.push({
          code: 'event_details_unavailable',
          message: error instanceof Error ? error.message : 'Riot event details are unavailable.'
        });
        return null;
      });

      let normalized = recentSeries.get(seriesId);
      if (!normalized) {
        const normalizedSchedule = await base.getSchedule();
        remember(normalizedSchedule.map(entry => entry.series));
        normalized = recentSeries.get(seriesId);
      }
      const [rawSchedule, detailsPayload] = await Promise.all([rawSchedulePromise, detailsPromise]);

      if (!normalized) {
        return {
          seriesId,
          observedAt: now().toISOString(),
          rosters: [],
          standings: [],
          complete: false,
          reasons: [{ code: 'series_not_found', message: 'The selected series is no longer present in the active schedule.' }]
        };
      }

      const rawEvent = scheduleEvents(rawSchedule).find(event => eventMatchesSeries(event, normalized)) ?? {};
      const detailsEvent = eventFromDetails(detailsPayload);
      const descriptors = mergeDescriptorLayers(
        seriesTeamDescriptors(normalized),
        eventTeamDescriptors(rawEvent),
        eventTeamDescriptors(detailsEvent)
      );
      const detailsLeague = object(detailsEvent.league);
      const scheduleLeague = object(rawEvent.league);
      const leagueTokens = new Set([
        firstString(detailsLeague, ['id']),
        firstString(detailsLeague, ['slug']),
        firstString(detailsLeague, ['name']),
        firstString(scheduleLeague, ['id']),
        firstString(scheduleLeague, ['slug']),
        firstString(scheduleLeague, ['name']),
        normalized.competition.id,
        normalized.competition.name
      ].map(normalizedText).filter(Boolean));

      let rosters: readonly TeamRosterRef[] = [];
      try {
        const catalog = await loadTeamCatalog();
        const usedIds = new Set<string>();
        const resolved: TeamRosterRef[] = [];
        for (const descriptor of descriptors) {
          const match = matchCatalogTeam(catalog, descriptor, leagueTokens, usedIds);
          if (!match) {
            reasons.push({
              code: 'roster_team_not_found',
              message: `No current Riot team-catalog entry matched ${descriptor.name}.`
            });
            continue;
          }
          const matchedId = firstString(match.team, ['id', 'teamId']);
          if (matchedId) usedIds.add(matchedId);
          if (match.method !== 'id') {
            reasons.push({
              code: 'roster_team_fallback_match',
              message: `${descriptor.name} was matched to the Riot team catalog by ${match.method}.`
            });
          }
          const normalizedTeam = teamRef(match.team, descriptor);
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
        }
        rosters = resolved;
      } catch (error) {
        reasons.push({
          code: 'team_catalog_unavailable',
          message: error instanceof Error ? error.message : 'Riot team catalog is unavailable.'
        });
      }

      let standings = scheduleRecordStandings(rawEvent, descriptors);
      const leagueId = firstString(detailsLeague, ['id'])
        ?? firstString(scheduleLeague, ['id'])
        ?? null;
      if (leagueId) {
        try {
          const tournament = await persisted('getTournamentsForLeague', { leagueId })
            .then(payload => selectTournament(payload, normalized.scheduledStart));
          const tournamentId = tournament ? firstString(tournament, ['id']) : null;
          if (tournamentId) {
            const fullStandings = await persisted('getStandings', { tournamentId: [tournamentId] })
              .then(parseStandings);
            if (fullStandings.length) standings = fullStandings;
          } else {
            reasons.push({
              code: 'active_tournament_missing',
              message: 'No active tournament was found for the selected series date.'
            });
          }
        } catch (error) {
          reasons.push({
            code: 'standings_lookup_unavailable',
            message: error instanceof Error ? error.message : 'Riot tournament standings are unavailable.'
          });
        }
      } else {
        reasons.push({
          code: 'league_id_missing',
          message: 'A numeric Riot league ID was unavailable for standings lookup.'
        });
      }

      if (rosters.length < 2) {
        reasons.push({ code: 'rosters_incomplete', message: 'Both team rosters were not available.' });
      }
      if (!standings.length) {
        reasons.push({ code: 'standings_empty', message: 'No standings or schedule records were returned.' });
      } else if (standings.every(row => row.rank === null)) {
        reasons.push({
          code: 'standings_from_schedule_record',
          message: 'Full tournament rankings were unavailable; current team win-loss records are shown instead.'
        });
      }

      const rostersComplete = rosters.length >= 2
        && rosters.every(roster => exactFivePlayerLineup(roster.players) !== null);
      return {
        seriesId,
        observedAt: now().toISOString(),
        rosters,
        standings,
        complete: rostersComplete && standings.length > 0,
        ...(reasons.length ? { reasons } : {})
      };
    }
  };
}
