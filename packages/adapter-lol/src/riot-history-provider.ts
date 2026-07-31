import type {
  GameState,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSeries,
  LolProviderSeriesContext
} from './provider.ts';
import { createRiotLolResolvedProvider } from './riot-resolved-provider.ts';
import type { RiotLolProviderOptions } from './riot-provider.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RECENT_SERIES = 500;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

function rawGameState(value: unknown): GameState {
  switch (String(value ?? '').toLowerCase()) {
    case 'inprogress':
    case 'in_progress':
    case 'live': return 'live';
    case 'championselect':
    case 'champion_select':
    case 'draft': return 'draft';
    case 'paused': return 'paused';
    case 'completed':
    case 'finished': return 'completed';
    case 'unstarted':
    case 'scheduled': return 'unstarted';
    default: return 'unknown';
  }
}

function eventFromDetails(payload: unknown): Json {
  const root = object(payload);
  const data = object(root.data);
  return object(data.event ?? root.event ?? data);
}

function durationSeconds(value: unknown): number | null {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(part => Number(part));
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      const seconds = parts.reduce((total, part) => total * 60 + part, 0);
      return seconds > 0 ? Math.round(seconds) : null;
    }
  }

  const numeric = numericValue(value);
  if (numeric === null || numeric <= 0) return null;
  return Math.round(numeric > 10_000 ? numeric / 1_000 : numeric);
}

function gameDuration(game: Json): number | null {
  const result = object(game.result);
  const metadata = object(game.metadata);
  return durationSeconds(
    game.durationSeconds
      ?? game.gameDurationSeconds
      ?? game.gameDuration
      ?? game.duration
      ?? result.durationSeconds
      ?? result.duration
      ?? metadata.durationSeconds
      ?? metadata.duration
  );
}

function outcomeIsWin(value: unknown): boolean {
  return value === true || String(value ?? '').toLowerCase() === 'win';
}

function gameWinnerId(game: Json): string | null {
  const result = object(game.result);
  const winner = object(game.winner);
  const direct = firstString(game, ['winnerTeamId', 'winningTeamId', 'winnerId'])
    ?? firstString(result, ['winnerTeamId', 'winningTeamId', 'winnerId'])
    ?? firstString(winner, ['id', 'teamId']);
  if (direct) return direct;

  for (const value of array(game.teams)) {
    const team = object(value);
    const teamResult = object(team.result);
    if (
      outcomeIsWin(team.outcome)
      || outcomeIsWin(teamResult.outcome)
      || team.win === true
      || team.winner === true
      || teamResult.win === true
      || teamResult.winner === true
    ) {
      const id = firstString(team, ['id', 'teamId']);
      if (id) return id;
    }
  }
  return null;
}

function matchTeamResolver(series: LolProviderSeries, match: Json) {
  const byRawId = new Map<string, TeamRef>();
  array(match.teams).forEach((value, index) => {
    const id = firstString(object(value), ['id', 'teamId']);
    const normalized = series.teams[index];
    if (id && normalized) byRawId.set(id, normalized);
  });
  for (const team of series.teams) byRawId.set(team.id, team);

  return (rawId: string | null, fallbackIndex?: number): TeamRef | null => {
    if (rawId) {
      const resolved = byRawId.get(rawId);
      if (resolved) return resolved;
    }
    return fallbackIndex === undefined ? null : series.teams[fallbackIndex] ?? null;
  };
}

function gameHistory(
  series: LolProviderSeries,
  match: Json,
  rawGame: Json,
  fallbackIndex: number
): SeriesGameHistoryRef {
  const normalizedGame = series.games.find(game => (
    game.id === firstString(rawGame, ['id', 'gameId'])
    || game.number === (firstNumber(rawGame, ['number', 'gameNumber']) ?? fallbackIndex + 1)
  ));
  const resolveTeam = matchTeamResolver(series, match);
  const rawTeams = array(rawGame.teams).map(object);
  let blueTeam: TeamRef | null = null;
  let redTeam: TeamRef | null = null;

  rawTeams.forEach((team, index) => {
    const side = String(team.side ?? '').toLowerCase();
    const resolved = resolveTeam(firstString(team, ['id', 'teamId']), index);
    if (side === 'blue') blueTeam = resolved;
    if (side === 'red') redTeam = resolved;
  });

  const state = rawGame.state === undefined
    ? normalizedGame?.state ?? 'unknown'
    : rawGameState(rawGame.state);
  const winnerId = gameWinnerId(rawGame);

  return {
    id: firstString(rawGame, ['id', 'gameId']) ?? normalizedGame?.id ?? `game-${fallbackIndex + 1}`,
    number: firstNumber(rawGame, ['number', 'gameNumber']) ?? normalizedGame?.number ?? fallbackIndex + 1,
    state,
    blueTeam,
    redTeam,
    winner: resolveTeam(winnerId),
    durationSeconds: gameDuration(rawGame)
  };
}

function fallbackGameHistory(series: LolProviderSeries): readonly SeriesGameHistoryRef[] {
  return series.games.map(game => ({
    ...game,
    blueTeam: null,
    redTeam: null,
    winner: null,
    durationSeconds: null
  }));
}

function scoreWins(matchTeam: Json): number | null {
  return firstNumber(object(matchTeam.result), ['gameWins', 'wins']);
}

export function parseRiotSeriesHistory(
  series: LolProviderSeries,
  detailsPayload: unknown
): SeriesHistoryRef {
  const event = eventFromDetails(detailsPayload);
  const match = object(event.match);
  const rawGames = array(match.games).map(object);
  const games = (rawGames.length
    ? rawGames.map((game, index) => gameHistory(series, match, game, index))
    : fallbackGameHistory(series))
    .slice()
    .sort((left, right) => left.number - right.number);

  const rawBestOf = firstNumber(object(match.strategy), ['count', 'bestOf']);
  const bestOf = rawBestOf && rawBestOf > 0 ? Math.round(rawBestOf) : Math.max(1, series.bestOf);
  const rawMatchTeams = array(match.teams).map(object);
  const countedWins = series.teams.map(team => games.filter(game => game.winner?.id === team.id).length);
  const leftWins = scoreWins(rawMatchTeams[0] ?? {}) ?? countedWins[0] ?? 0;
  const rightWins = scoreWins(rawMatchTeams[1] ?? {}) ?? countedWins[1] ?? 0;

  return {
    bestOf,
    winsRequired: Math.floor(bestOf / 2) + 1,
    drawPossible: bestOf % 2 === 0,
    score: [
      { team: series.teams[0], wins: Math.max(0, leftWins) },
      { team: series.teams[1], wins: Math.max(0, rightWins) }
    ],
    games
  };
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

export function createRiotLolHistoryProvider(options: RiotLolProviderOptions): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const resolved = createRiotLolResolvedProvider({ ...options, fetcher });
  const recentSeries = new Map<string, LolProviderSeries>();

  const remember = (entries: readonly LolProviderScheduleEntry[]): void => {
    if (recentSeries.size + entries.length > MAX_RECENT_SERIES) recentSeries.clear();
    for (const entry of entries) recentSeries.set(entry.series.id, entry.series);
  };

  const getSchedule = async (): Promise<readonly LolProviderScheduleEntry[]> => {
    const entries = await resolved.getSchedule();
    remember(entries);
    return entries;
  };

  const details = async (seriesId: string): Promise<unknown> => {
    const url = new URL(`${PERSISTED_BASE}/getEventDetails`);
    url.searchParams.set('hl', locale);
    url.searchParams.set('id', seriesId);
    return requestJson(fetcher, url, apiKey);
  };

  return {
    id: resolved.id,
    name: resolved.name,
    ...(resolved.sourceUrl ? { sourceUrl: resolved.sourceUrl } : {}),
    getSchedule,
    getSnapshot: (gameId: string, after?: string) => resolved.getSnapshot(gameId, after),

    async getSeriesContext(seriesId: string): Promise<LolProviderSeriesContext> {
      let series = recentSeries.get(seriesId);
      if (!series) {
        await getSchedule();
        series = recentSeries.get(seriesId);
      }

      const [context, detailsPayload] = await Promise.all([
        resolved.getSeriesContext!(seriesId),
        details(seriesId).catch(() => null)
      ]);
      if (!series || !detailsPayload) return context;

      return {
        ...context,
        history: parseRiotSeriesHistory(series, detailsPayload)
      };
    }
  };
}
