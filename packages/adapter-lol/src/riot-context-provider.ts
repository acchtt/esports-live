import type {
  GameState,
  PlayerRef,
  QualityReason,
  SeriesState,
  StandingRef,
  TeamRef,
  TeamRosterRef
} from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderGame,
  LolProviderScheduleEntry,
  LolProviderSeriesContext
} from './provider.ts';
import {
  createRiotLolProvider,
  normalizeRiotSeries,
  type RiotLolProviderOptions
} from './riot-provider.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const REQUEST_TIMEOUT_MS = 8_000;
const LIVE_RECOVERY_LOOKBACK_MS = 6 * 60 * 60 * 1_000;
const LIVE_RECOVERY_LOOKAHEAD_MS = 5 * 60 * 1_000;
const LIVE_RECOVERY_CACHE_MS = 30_000;
const MAX_LIVE_RECOVERY_CANDIDATES = 8;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface TeamDescriptor {
  id: string;
  slug: string | null;
  name: string;
  code: string | null;
  imageUrl: string | null;
}

interface LiveRecoveryCacheEntry {
  expiresAt: number;
  event: Json | null;
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

function rawSeriesState(value: unknown): SeriesState {
  switch (String(value ?? '').toLowerCase()) {
    case 'inprogress':
    case 'live': return 'live';
    case 'paused': return 'paused';
    case 'completed': return 'completed';
    case 'unstarted':
    case 'scheduled': return 'scheduled';
    case 'cancelled': return 'cancelled';
    default: return 'unknown';
  }
}

function rawGameState(value: unknown): GameState {
  switch (String(value ?? '').toLowerCase()) {
    case 'inprogress':
    case 'live': return 'live';
    case 'championselect':
    case 'draft': return 'draft';
    case 'paused': return 'paused';
    case 'completed': return 'completed';
    case 'unstarted': return 'unstarted';
    default: return 'unknown';
  }
}

function scheduleEvents(payload: unknown): readonly Json[] {
  const root = object(payload);
  const data = object(root.data);
  const schedule = object(data.schedule ?? root.schedule);
  return array(schedule.events).map(object);
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

function eventMatches(event: Json, seriesId: string): boolean {
  return eventIds(event).includes(seriesId);
}

function eventGames(event: Json): readonly LolProviderGame[] {
  const games = array(object(event.match).games);
  return games.flatMap((value, index) => {
    const game = object(value);
    const id = firstString(game, ['id', 'gameId']);
    if (!id) return [];
    return [{
      id,
      number: firstNumber(game, ['number', 'gameNumber']) ?? index + 1,
      state: rawGameState(game.state)
    }];
  });
}

function detailedLiveState(event: Json): 'live' | 'paused' | null {
  const games = eventGames(event);
  if (games.some(game => game.state === 'paused')) return 'paused';
  if (games.some(game => game.state === 'live' || game.state === 'draft')) return 'live';

  const match = object(event.match);
  const reported = rawSeriesState(event.state ?? match.state);
  if (reported === 'live' || reported === 'paused') return reported;

  const bestOf = firstNumber(object(match.strategy), ['count']) ?? 1;
  const winsRequired = Math.floor(bestOf / 2) + 1;
  const results = array(match.teams).map(team => object(object(team).result));
  const wins = results.map(result => firstNumber(result, ['gameWins', 'wins']) ?? 0);
  const hasFinalOutcome = results.some(result => stringValue(result.outcome) !== null);
  return wins.some(value => value > 0)
    && wins.every(value => value < winsRequired)
    && !hasFinalOutcome
    ? 'live'
    : null;
}

function mergeDetailedLiveSignal(
  entry: LolProviderScheduleEntry,
  detailsEvent: Json
): LolProviderScheduleEntry {
  const state = detailedLiveState(detailsEvent);
  if (!state) return entry;

  const gamesById = new Map(entry.series.games.map(game => [game.id, game] as const));
  for (const signal of eventGames(detailsEvent)) {
    const existing = gamesById.get(signal.id);
    gamesById.set(signal.id, existing
      ? { ...existing, state: signal.state !== 'unknown' ? signal.state : existing.state }
      : signal);
  }
  return {
    ...entry,
    series: {
      ...entry.series,
      state,
      games: [...gamesById.values()].sort((left, right) => left.number - right.number)
    }
  };
}

function mergeLiveSignals(
  schedule: readonly LolProviderScheduleEntry[],
  livePayload: unknown,
  observedAt: string
): readonly LolProviderScheduleEntry[] {
  const byId = new Map<string, Json>();
  for (const event of scheduleEvents(livePayload)) {
    for (const id of eventIds(event)) byId.set(id, event);
  }
  if (byId.size === 0) return schedule;

  const merged = schedule.map(entry => {
    const liveEvent = byId.get(entry.series.id);
    if (!liveEvent || entry.series.state === 'completed' || entry.series.state === 'cancelled') return entry;

    const signaledState = rawSeriesState(liveEvent.state ?? object(liveEvent.match).state);
    if (signaledState !== 'live' && signaledState !== 'paused') return entry;

    const gamesById = new Map(entry.series.games.map(game => [game.id, game] as const));
    for (const signal of eventGames(liveEvent)) {
      const existing = gamesById.get(signal.id);
      gamesById.set(signal.id, existing
        ? { ...existing, state: signal.state !== 'unknown' ? signal.state : existing.state }
        : signal);
    }
    const games = [...gamesById.values()].sort((left, right) => left.number - right.number);

    return {
      ...entry,
      series: {
        ...entry.series,
        state: signaledState,
        games
      }
    };
  });

  const knownSeries = new Set(schedule.map(entry => entry.series.id));
  const liveOnly = scheduleEvents(livePayload).flatMap(event => {
    const state = rawSeriesState(event.state ?? object(event.match).state);
    const series = normalizeRiotSeries(event, observedAt);
    return (state === 'live' || state === 'paused') && !knownSeries.has(series.id)
      ? [{ series, observedAt }]
      : [];
  });
  return [...merged, ...liveOnly];
}

function teamDescriptor(value: unknown, fallbackIndex: number): TeamDescriptor {
  const team = object(value);
  return {
    id: firstString(team, ['id', 'teamId']) ?? `unknown-team-${fallbackIndex}`,
    slug: firstString(team, ['slug']),
    name: firstString(team, ['name', 'code', 'slug']) ?? `Team ${fallbackIndex}`,
    code: firstString(team, ['code', 'acronym']),
    imageUrl: firstString(team, ['image', 'imageUrl', 'alternativeImage', 'logo'])
  };
}

function eventTeams(event: Json): readonly TeamDescriptor[] {
  return array(object(event.match).teams).map((team, index) => teamDescriptor(team, index + 1));
}

function mergeTeamDescriptors(...sources: readonly (readonly TeamDescriptor[])[]): readonly TeamDescriptor[] {
  const merged = new Map<string, TeamDescriptor>();
  for (const source of sources) {
    for (const team of source) {
      const key = team.id.startsWith('unknown-team-') ? team.slug ?? team.name : team.id;
      const current = merged.get(key);
      merged.set(key, {
        id: current?.id && !current.id.startsWith('unknown-team-') ? current.id : team.id,
        slug: current?.slug ?? team.slug,
        name: current?.name && !current.name.startsWith('Team ') ? current.name : team.name,
        code: current?.code ?? team.code,
        imageUrl: current?.imageUrl ?? team.imageUrl
      });
    }
  }
  return [...merged.values()];
}

function teamRef(value: Json, fallback?: TeamDescriptor): TeamRef {
  const id = firstString(value, ['id', 'teamId']) ?? fallback?.id ?? 'unknown-team';
  const name = firstString(value, ['name', 'code', 'slug']) ?? fallback?.name ?? 'Unknown team';
  const code = firstString(value, ['code', 'acronym']) ?? fallback?.code ?? null;
  const slug = firstString(value, ['slug']) ?? fallback?.slug ?? null;
  const imageUrl = firstString(value, ['image', 'imageUrl', 'alternativeImage', 'logo'])
    ?? fallback?.imageUrl
    ?? null;
  return {
    id,
    name,
    ...(code ? { code } : {}),
    ...(slug ? { slug } : {}),
    ...(imageUrl ? { imageUrl } : {})
  };
}

function playerRef(value: unknown, teamId: string, fallbackIndex: number): PlayerRef | null {
  const player = object(value);
  const id = firstString(player, ['id', 'playerId']);
  const handle = firstString(player, ['summonerName', 'name', 'slug']);
  if (!id || !handle) return null;
  const firstName = firstString(player, ['firstName']);
  const lastName = firstString(player, ['lastName']);
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || null;
  const role = firstString(player, ['role', 'roleSlug']);
  const imageUrl = firstString(player, ['image', 'imageUrl', 'photoUrl']);
  return {
    id: id || `unknown-player-${fallbackIndex}`,
    handle,
    teamId,
    ...(role ? { role } : {}),
    ...(displayName ? { displayName } : {}),
    ...(imageUrl ? { imageUrl } : {})
  };
}

function parseRosters(payload: unknown, descriptors: readonly TeamDescriptor[]): readonly TeamRosterRef[] {
  const root = object(payload);
  const teams = array(object(root.data).teams ?? root.teams).map(object);
  return teams.map((team, index) => {
    const id = firstString(team, ['id', 'teamId']);
    const slug = firstString(team, ['slug']);
    const fallback = descriptors.find(item => item.id === id || (slug && item.slug === slug))
      ?? descriptors[index];
    const normalizedTeam = teamRef(team, fallback);
    const players = array(team.players)
      .map((player, playerIndex) => playerRef(player, normalizedTeam.id, playerIndex + 1))
      .filter((player): player is PlayerRef => player !== null);
    return { team: normalizedTeam, players };
  });
}

function tournamentList(payload: unknown): readonly Json[] {
  const root = object(payload);
  const data = object(root.data);
  const leagues = array(data.leagues ?? root.leagues).map(object);
  return leagues.flatMap(league => array(league.tournaments).map(object));
}

function selectTournament(payload: unknown, scheduledStart: string | null): Json | null {
  const tournaments = tournamentList(payload);
  if (tournaments.length === 0) return null;
  const day = scheduledStart && Number.isFinite(Date.parse(scheduledStart))
    ? new Date(scheduledStart).toISOString().slice(0, 10)
    : null;
  if (day) {
    const active = tournaments.filter(tournament => {
      const start = firstString(tournament, ['startDate']);
      const end = firstString(tournament, ['endDate']);
      return (!start || start <= day) && (!end || end >= day);
    });
    if (active.length) {
      return [...active].sort((left, right) => (
        String(right.startDate ?? '').localeCompare(String(left.startDate ?? ''))
      ))[0] ?? null;
    }
  }
  return tournaments[0] ?? null;
}

function parseStandings(payload: unknown): readonly StandingRef[] {
  const root = object(payload);
  const standings = array(object(root.data).standings ?? root.standings).map(object);
  const entries: StandingRef[] = [];

  for (const standing of standings) {
    for (const stageValue of array(standing.stages)) {
      const stage = object(stageValue);
      const stageName = firstString(stage, ['name', 'slug']);
      for (const sectionValue of array(stage.sections)) {
        const section = object(sectionValue);
        const sectionName = firstString(section, ['name', 'slug']);
        const group = [stageName, sectionName].filter(Boolean).join(' · ');
        for (const rankingValue of array(section.rankings)) {
          const ranking = object(rankingValue);
          const rank = firstNumber(ranking, ['ordinal', 'rank']);
          for (const teamValue of array(ranking.teams)) {
            const team = object(teamValue);
            const record = object(team.record);
            entries.push({
              rank,
              team: teamRef(team),
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
    || (left.group ?? '').localeCompare(right.group ?? '')
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

export function createRiotLolContextProvider(options: RiotLolProviderOptions): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const base = createRiotLolProvider({ ...options, fetcher });
  const liveRecoveryCache = new Map<string, LiveRecoveryCacheEntry>();

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

  const loadLiveRecoveryEvent = async (seriesId: string): Promise<Json | null> => {
    const currentTime = now().getTime();
    const cached = liveRecoveryCache.get(seriesId);
    if (cached && cached.expiresAt > currentTime) return cached.event;
    const event = await persisted('getEventDetails', { id: seriesId })
      .then(eventFromDetails)
      .catch(() => null);
    liveRecoveryCache.set(seriesId, {
      event,
      expiresAt: currentTime + LIVE_RECOVERY_CACHE_MS
    });
    return event;
  };

  const recoverRecentLiveSeries = async (
    schedule: readonly LolProviderScheduleEntry[]
  ): Promise<readonly LolProviderScheduleEntry[]> => {
    const currentTime = now().getTime();
    const candidates = schedule
      .filter(entry => entry.series.state !== 'live'
        && entry.series.state !== 'paused'
        && entry.series.state !== 'cancelled')
      .filter(entry => {
        const start = Date.parse(entry.series.scheduledStart);
        return Number.isFinite(start)
          && start >= currentTime - LIVE_RECOVERY_LOOKBACK_MS
          && start <= currentTime + LIVE_RECOVERY_LOOKAHEAD_MS;
      })
      .sort((left, right) => Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart))
      .slice(0, MAX_LIVE_RECOVERY_CANDIDATES);
    if (!candidates.length) return schedule;

    const recovered = new Map<string, LolProviderScheduleEntry>();
    await Promise.all(candidates.map(async entry => {
      const event = await loadLiveRecoveryEvent(entry.series.id);
      if (event) recovered.set(entry.series.id, mergeDetailedLiveSignal(entry, event));
    }));
    return schedule.map(entry => recovered.get(entry.series.id) ?? entry);
  };

  const context: LolProviderClient = {
    id: base.id,
    name: base.name,
    ...(base.sourceUrl ? { sourceUrl: base.sourceUrl } : {}),

    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const observedAt = now().toISOString();
      const [schedule, livePayload] = await Promise.all([
        base.getSchedule(),
        persisted('getLive', {}).catch(() => null)
      ]);
      return recoverRecentLiveSeries(mergeLiveSignals(schedule, livePayload, observedAt));
    },

    getSnapshot(gameId: string, after?: string) {
      return base.getSnapshot(gameId, after);
    },

    async getSeriesContext(seriesId: string): Promise<LolProviderSeriesContext> {
      const observedAt = now().toISOString();
      const reasons: QualityReason[] = [];

      const [schedulePayload, detailsPayload] = await Promise.all([
        persisted('getSchedule', {}).catch(error => {
          reasons.push({
            code: 'schedule_context_unavailable',
            message: error instanceof Error ? error.message : 'Riot schedule context is unavailable.'
          });
          return null;
        }),
        persisted('getEventDetails', { id: seriesId }).catch(error => {
          reasons.push({
            code: 'event_context_unavailable',
            message: error instanceof Error ? error.message : 'Riot event context is unavailable.'
          });
          return null;
        })
      ]);

      const scheduleEvent = scheduleEvents(schedulePayload).find(event => eventMatches(event, seriesId)) ?? {};
      const detailsEvent = eventFromDetails(detailsPayload);
      const descriptors = mergeTeamDescriptors(eventTeams(scheduleEvent), eventTeams(detailsEvent));
      const sourceEvent = Object.keys(scheduleEvent).length ? scheduleEvent : detailsEvent;
      const league = object(sourceEvent.league);
      const leagueId = firstString(league, ['id']);
      const scheduledStart = firstString(sourceEvent, ['startTime', 'scheduledStart']);
      const slugs = descriptors.map(team => team.slug).filter((slug): slug is string => slug !== null);

      let rosters: readonly TeamRosterRef[] = [];
      if (slugs.length) {
        rosters = await persisted('getTeams', { id: slugs })
          .then(payload => parseRosters(payload, descriptors))
          .catch(error => {
            reasons.push({
              code: 'rosters_unavailable',
              message: error instanceof Error ? error.message : 'Riot roster context is unavailable.'
            });
            return [];
          });
      } else {
        reasons.push({ code: 'team_slugs_missing', message: 'Team slugs are unavailable for roster lookup.' });
      }

      let standings: readonly StandingRef[] = [];
      if (leagueId) {
        const tournament = await persisted('getTournamentsForLeague', { leagueId })
          .then(payload => selectTournament(payload, scheduledStart))
          .catch(error => {
            reasons.push({
              code: 'tournament_context_unavailable',
              message: error instanceof Error ? error.message : 'Riot tournament context is unavailable.'
            });
            return null;
          });
        const tournamentId = tournament ? firstString(tournament, ['id']) : null;
        if (tournamentId) {
          standings = await persisted('getStandings', { tournamentId: [tournamentId] })
            .then(parseStandings)
            .catch(error => {
              reasons.push({
                code: 'standings_unavailable',
                message: error instanceof Error ? error.message : 'Riot standings context is unavailable.'
              });
              return [];
            });
        } else {
          reasons.push({ code: 'active_tournament_missing', message: 'No active tournament was found for standings lookup.' });
        }
      } else {
        reasons.push({ code: 'league_id_missing', message: 'League ID is unavailable for standings lookup.' });
      }

      if (rosters.length < 2 && !reasons.some(reason => reason.code === 'rosters_unavailable')) {
        reasons.push({ code: 'rosters_incomplete', message: 'Both team rosters were not available.' });
      }
      if (!standings.length && !reasons.some(reason => reason.code === 'standings_unavailable')) {
        reasons.push({ code: 'standings_empty', message: 'No standings rows were available.' });
      }

      return {
        seriesId,
        observedAt,
        rosters,
        standings,
        complete: rosters.length >= 2 && standings.length > 0,
        ...(reasons.length ? { reasons } : {})
      };
    }
  };

  return context;
}
