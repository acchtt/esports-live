import type { ScheduleEvent, SeriesContext } from '@esports-live/core';
import { loadSeriesContext } from './api.ts';

const MATCH_PREFETCH_LIMIT = 8;
const HISTORY_PREFETCH_LIMIT = 4;
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_RECHECK_MS = 2 * 60 * 1_000;
const CONTEXT_TIMEOUT_MS = 8_000;
const CATALOGUE_REFRESH_DELAY_MS = 150;

interface ScheduleResponse {
  events?: readonly ScheduleEvent[];
}

type FetchInput = RequestInfo | URL;

function requestUrl(input: FetchInput): URL | null {
  try {
    const value = input instanceof Request ? input.url : String(input);
    return new URL(value, window.location.href);
  } catch {
    return null;
  }
}

function isSchedule(url: URL): boolean {
  return url.pathname.endsWith('/v1/lol/schedule');
}

function isHistorySchedule(url: URL): boolean {
  const states = url.searchParams.get('states') ?? '';
  return states.split(',').includes('completed');
}

function stateRank(event: ScheduleEvent): number {
  if (event.series.state === 'live' || event.series.state === 'paused') return 0;
  if (event.series.state === 'scheduled' || event.series.state === 'unknown') return 1;
  return 2;
}

function scheduledMs(event: ScheduleEvent): number {
  const value = Date.parse(event.series.scheduledStart);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function candidates(
  events: readonly ScheduleEvent[],
  history: boolean,
  prefetchedAt: ReadonlyMap<string, number>,
  now: number
): readonly ScheduleEvent[] {
  const eligible = events.filter(event => (
    now - (prefetchedAt.get(event.series.id) ?? 0) >= PREFETCH_RECHECK_MS
  ));

  if (history) {
    return eligible
      .filter(event => event.series.state === 'completed')
      .sort((left, right) => scheduledMs(right) - scheduledMs(left))
      .slice(0, HISTORY_PREFETCH_LIMIT);
  }

  return eligible
    .filter(event => event.series.state !== 'completed')
    .sort((left, right) => {
      const rank = stateRank(left) - stateRank(right);
      if (rank) return rank;
      if (stateRank(left) === 0) return scheduledMs(left) - scheduledMs(right);
      return scheduledMs(left) - scheduledMs(right);
    })
    .slice(0, MATCH_PREFETCH_LIMIT);
}

async function prefetchContext(event: ScheduleEvent): Promise<SeriesContext | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);
  try {
    return await loadSeriesContext(event.series.id, controller.signal, 0);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function runPrefetch(
  events: readonly ScheduleEvent[],
  history: boolean,
  prefetchedAt: Map<string, number>
): Promise<boolean> {
  const now = Date.now();
  const queue = [...candidates(events, history, prefetchedAt, now)];
  queue.forEach(event => prefetchedAt.set(event.series.id, now));
  let refreshed = false;

  const workers = Array.from(
    { length: Math.min(PREFETCH_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const event = queue.shift();
        if (!event) return;
        if (await prefetchContext(event)) refreshed = true;
      }
    }
  );
  await Promise.all(workers);
  return refreshed;
}

export function installCatalogueContextPrefetch(): void {
  const nativeFetch = window.fetch.bind(window);
  const prefetchedAt = new Map<string, number>();
  let refreshTimer: number | null = null;

  const queueCatalogueRefresh = (): void => {
    if (document.hidden) return;
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      document.querySelector<HTMLButtonElement>('#refresh-data')?.click();
    }, CATALOGUE_REFRESH_DELAY_MS);
  };

  window.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const url = requestUrl(input);
    if (!url || !response.ok || !isSchedule(url)) return response;

    const copy = response.clone();
    window.setTimeout(() => {
      void copy.json()
        .then(async (payload: ScheduleResponse) => {
          if (!Array.isArray(payload.events) || !payload.events.length) return;
          const history = isHistorySchedule(url);
          const refreshed = await runPrefetch(payload.events, history, prefetchedAt);
          if (refreshed && !history) queueCatalogueRefresh();
        })
        .catch(() => undefined);
    }, 0);

    return response;
  };
}
