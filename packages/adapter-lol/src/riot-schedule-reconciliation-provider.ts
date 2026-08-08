import type { GameState, SeriesState } from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderGame,
  LolProviderScheduleEntry,
  LolProviderSeries
} from './provider.ts';
import { normalizeRiotSeries } from './riot-provider.ts';

export interface RiotScheduleReconciliationProviderOptions {
  apiKey: string;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  locale?: string;
  now?: () => Date;
}

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const REQUEST_TIMEOUT_MS = 5_000;

type Json = Record<string, unknown>;

const object = (value: unknown): Json => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
);
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

function schedulePayload(payload: unknown): Json {
  const root = object(payload);
  return object(object(root.data).schedule ?? root.schedule);
}

function scheduleEvents(payload: unknown): readonly Json[] {
  return array(schedulePayload(payload).events).map(object);
}

function olderScheduleToken(payload: unknown): string | null {
  const value = object(schedulePayload(payload).pages).older;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const SERIES_STATE_RANK: Record<SeriesState, number> = {
  unknown: 0,
  scheduled: 1,
  live: 2,
  paused: 2,
  cancelled: 3,
  completed: 4
};

const GAME_STATE_RANK: Record<GameState, number> = {
  unknown: 0,
  unstarted: 1,
  draft: 2,
  live: 3,
  paused: 3,
  completed: 4
};

function strongerSeriesState(current: SeriesState, incoming: SeriesState): SeriesState {
  return SERIES_STATE_RANK[incoming] > SERIES_STATE_RANK[current] ? incoming : current;
}

function strongerGameState(current: GameState, incoming: GameState): GameState {
  return GAME_STATE_RANK[incoming] > GAME_STATE_RANK[current] ? incoming : current;
}

function mergeGames(
  current: readonly LolProviderGame[],
  incoming: readonly LolProviderGame[]
): readonly LolProviderGame[] {
  const merged = current.map(game => ({ ...game }));
  for (const next of incoming) {
    const index = merged.findIndex(game => game.id === next.id || game.number === next.number);
    if (index < 0) {
      merged.push({ ...next });
      continue;
    }
    const previous = merged[index]!;
    merged[index] = {
      ...previous,
      state: strongerGameState(previous.state, next.state)
    };
  }
  return merged.sort((left, right) => left.number - right.number);
}

function mergeSeries(current: LolProviderSeries, incoming: LolProviderSeries): LolProviderSeries {
  return {
    ...current,
    state: strongerSeriesState(current.state, incoming.state),
    games: mergeGames(current.games, incoming.games)
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
    if (!response.ok) throw new Error(`Riot schedule reconciliation returned HTTP ${response.status}.`);
    return body.trim() ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timer);
  }
}

export function createRiotScheduleReconciliationProvider(
  base: LolProviderClient,
  options: RiotScheduleReconciliationProviderOptions
): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());

  const loadSchedule = async (pageToken?: string): Promise<unknown> => {
    const url = new URL(`${PERSISTED_BASE}/getSchedule`);
    url.searchParams.set('hl', locale);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    return requestJson(fetcher, url, apiKey);
  };

  return {
    id: base.id,
    name: base.name,
    ...(base.sourceUrl ? { sourceUrl: base.sourceUrl } : {}),
    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const entries = await base.getSchedule();
      const observedAt = now().toISOString();
      let current: unknown;
      try {
        current = await loadSchedule();
      } catch {
        return entries;
      }
      const olderToken = olderScheduleToken(current);
      const older = olderToken
        ? await loadSchedule(olderToken).catch(() => null)
        : null;

      const merged = new Map(entries.map(entry => [entry.series.id, entry] as const));
      for (const event of [...scheduleEvents(current), ...scheduleEvents(older)]) {
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
