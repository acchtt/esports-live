import type { LolProviderClient, LolProviderScheduleEntry, LolProviderSeries } from './provider.ts';
import { normalizeRiotSeries } from './riot-provider.ts';

export interface RiotSupplementalLeagueProviderOptions {
  apiKey: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  locale?: string;
  now?: () => Date;
  leagueIds?: readonly string[];
}

export const RIOT_LPL_LEAGUE_ID = '98767991314006698';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_LEAGUE_IDS = [RIOT_LPL_LEAGUE_ID] as const;

type Json = Record<string, unknown>;

const object = (value: unknown): Json => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
);
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

function schedulePayload(payload: unknown): Json {
  const root = object(payload);
  const data = object(root.data);
  return object(data.schedule ?? root.schedule);
}

function scheduleEvents(payload: unknown): readonly Json[] {
  return array(schedulePayload(payload).events).map(object);
}

function olderScheduleToken(payload: unknown): string | null {
  const value = object(schedulePayload(payload).pages).older;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hasPlaceholderTeams(series: LolProviderSeries): boolean {
  return series.teams.some((team, index) => team.name === `Team ${index + 1}`);
}

function mergeSeries(existing: LolProviderSeries, supplemental: LolProviderSeries): LolProviderSeries {
  const games = new Map(existing.games.map(game => [game.id, game] as const));
  for (const game of supplemental.games) {
    const previous = games.get(game.id);
    games.set(game.id, previous
      ? {
        ...previous,
        ...game,
        state: game.state === 'unknown' ? previous.state : game.state
      }
      : game);
  }

  return {
    ...existing,
    competition: supplemental.competition.id === 'unknown-competition'
      ? existing.competition
      : supplemental.competition,
    teams: hasPlaceholderTeams(supplemental) ? existing.teams : supplemental.teams,
    bestOf: Math.max(existing.bestOf, supplemental.bestOf),
    state: supplemental.state === 'unknown' ? existing.state : supplemental.state,
    scheduledStart: supplemental.scheduledStart || existing.scheduledStart,
    games: [...games.values()].sort((left, right) => left.number - right.number)
  };
}

async function requestJson(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: URL,
  apiKey: string
): Promise<unknown> {
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

export function createRiotSupplementalLeagueProvider(
  base: LolProviderClient,
  options: RiotSupplementalLeagueProviderOptions
): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const leagueIds = [...new Set(options.leagueIds ?? DEFAULT_LEAGUE_IDS)];

  const loadLeagueSchedule = async (leagueId: string, pageToken?: string): Promise<unknown> => {
    const url = new URL(`${PERSISTED_BASE}/getSchedule`);
    url.searchParams.set('hl', locale);
    url.searchParams.set('leagueId', leagueId);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    return requestJson(fetcher, url, apiKey);
  };

  const loadLeagueSchedulePages = async (leagueId: string): Promise<readonly unknown[]> => {
    const current = await loadLeagueSchedule(leagueId);
    const olderToken = olderScheduleToken(current);
    if (!olderToken) return [current];
    const older = await loadLeagueSchedule(leagueId, olderToken).catch(() => null);
    return older ? [current, older] : [current];
  };

  return {
    id: base.id,
    name: base.name,
    ...(base.sourceUrl ? { sourceUrl: base.sourceUrl } : {}),
    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const entries = await base.getSchedule();
      const observedAt = now().toISOString();
      const payloadGroups = await Promise.all(leagueIds.map(leagueId => (
        loadLeagueSchedulePages(leagueId).catch(() => [])
      )));
      const merged = new Map(entries.map(entry => [entry.series.id, entry] as const));

      for (const event of payloadGroups.flat().flatMap(scheduleEvents)) {
        const series = normalizeRiotSeries(event, observedAt);
        const existing = merged.get(series.id);
        merged.set(series.id, existing
          ? { ...existing, series: mergeSeries(existing.series, series) }
          : { series, observedAt });
      }

      return [...merged.values()];
    },
    getSnapshot: (gameId, after) => base.getSnapshot(gameId, after),
    ...(base.getSeriesContext
      ? { getSeriesContext: (seriesId: string) => base.getSeriesContext!(seriesId) }
      : {})
  };
}
