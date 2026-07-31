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

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface TeamDescriptor {
  id: string;
  name: string;
  code: string | null;
  slug: string | null;
  imageUrl: string | null;
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

function scheduleEvents(payload: unknown): readonly Json[] {
  const root = object(payload);
  const data = object(root.data);
  return array(object(data.schedule ?? root.schedule).events).map(object);
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

function mergeDescriptors(
  normalized: readonly TeamDescriptor[],
  raw: readonly TeamDescriptor[]
): readonly TeamDescriptor[] {
  return normalized.map((team, index) => {
    const rawTeam = raw.find(candidate => candidate.id === team.id) ?? raw[index];
    return {
      id: team.id,
      name: team.name,
      code: team.code ?? rawTeam?.code ?? null,
      slug: team.slug ?? rawTeam?.slug ?? null,
      imageUrl: team.imageUrl ?? rawTeam?.imageUrl ?? null
    };
  });
}

function eventMatchesSeries(event: Json, series: LolProviderSeries): boolean {
  if (eventIds(event).includes(series.id)) return true;

  const eventTeams = eventTeamDescriptors(event)
    .map(team => team.id)
    .filter(id => !id.startsWith('unknown-team-'))
    .sort();
  const seriesTeams = series.teams.map(team => team.id).sort();
  if (eventTeams.length !== 2 || eventTeams.some((id, index) => id !== seriesTeams[index])) return false;

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

function parseRosters(payload: unknown, descriptors: readonly TeamDescriptor[]): readonly TeamRosterRef[] {
  const root = object(payload);
  const teams = array(object(root.data).teams ?? root.teams).map(object);
  return teams.map((team, index) => {
    const id = firstString(team, ['id', 'teamId']);
    const slug = firstString(team, ['slug']);
    const fallback = descriptors.find(candidate => candidate.id === id || (slug && candidate.slug === slug))
      ?? descriptors[index]
      ?? { id: `unknown-team-${index + 1}`, name: `Team ${index + 1}`, code: null, slug: null, imageUrl: null };
    const normalizedTeam = teamRef(team, fallback);
    const players = array(team.players)
      .map(player => playerRef(player, normalizedTeam.id))
      .filter((player): player is PlayerRef => player !== null);
    return { team: normalizedTeam, players };
  });
}

function scheduleRecordStandings(event: Json, descriptors: readonly TeamDescriptor[]): readonly StandingRef[] {
  const stage = firstString(event, ['blockName', 'stage']);
  return array(object(event.match).teams).flatMap((value, index) => {
    const team = object(value);
    const record = object(team.record);
    const wins = firstNumber(record, ['wins']);
    const losses = firstNumber(record, ['losses']);
    if (wins === null && losses === null) return [];
    const fallback = descriptors.find(candidate => candidate.id === firstString(team, ['id', 'teamId']))
      ?? descriptors[index]
      ?? { id: `unknown-team-${index + 1}`, name: `Team ${index + 1}`, code: null, slug: null, imageUrl: null };
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

export function createRiotLolResolvedProvider(options: RiotLolProviderOptions): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const primary = createRiotLolContextProvider({ ...options, fetcher });
  const base = createRiotLolProvider({ ...options, fetcher });
  const recentSeries = new Map<string, LolProviderSeries>();

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

      let normalized = recentSeries.get(seriesId);
      if (!normalized) {
        const normalizedSchedule = await base.getSchedule();
        remember(normalizedSchedule.map(entry => entry.series));
        normalized = recentSeries.get(seriesId);
      }
      const rawSchedule = await rawSchedulePromise;

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
      const descriptors = mergeDescriptors(
        seriesTeamDescriptors(normalized),
        eventTeamDescriptors(rawEvent)
      );
      const identifiers = descriptors
        .map(team => team.slug ?? team.code ?? null)
        .filter((value): value is string => value !== null);

      let rosters: readonly TeamRosterRef[] = [];
      if (identifiers.length) {
        rosters = await persisted('getTeams', { id: identifiers })
          .then(payload => parseRosters(payload, descriptors))
          .catch(error => {
            reasons.push({
              code: 'rosters_unavailable',
              message: error instanceof Error ? error.message : 'Riot roster context is unavailable.'
            });
            return [];
          });
      } else {
        reasons.push({ code: 'team_identifiers_missing', message: 'Team identifiers are unavailable for roster lookup.' });
      }

      let standings = scheduleRecordStandings(rawEvent, descriptors);
      const competitionId = normalized.competition.id;
      if (competitionId) {
        const tournament = await persisted('getTournamentsForLeague', { leagueId: competitionId })
          .then(payload => selectTournament(payload, normalized.scheduledStart))
          .catch(() => null);
        const tournamentId = tournament ? firstString(tournament, ['id']) : null;
        if (tournamentId) {
          const fullStandings = await persisted('getStandings', { tournamentId: [tournamentId] })
            .then(parseStandings)
            .catch(() => []);
          if (fullStandings.length) standings = fullStandings;
        }
      }

      if (!rosters.length) reasons.push({ code: 'rosters_empty', message: 'No roster rows were returned for the selected teams.' });
      if (!standings.length) reasons.push({ code: 'standings_empty', message: 'No standings or schedule records were returned.' });
      if (standings.length && standings.every(row => row.rank === null)) {
        reasons.push({
          code: 'standings_from_schedule_record',
          message: 'Full tournament rankings were unavailable; current team win-loss records are shown instead.'
        });
      }

      return {
        seriesId,
        observedAt: now().toISOString(),
        rosters,
        standings,
        complete: rosters.length >= 2 && standings.length > 0,
        ...(reasons.length ? { reasons } : {})
      };
    }
  };
}
