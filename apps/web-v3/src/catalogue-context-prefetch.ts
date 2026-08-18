import type { ScheduleEvent, SeriesContext } from '@esports-live/core';

const MATCH_PREFETCH_LIMIT = 8;
const HISTORY_PREFETCH_LIMIT = 4;
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_RECHECK_MS = 2 * 60 * 1_000;
const CONTEXT_TIMEOUT_MS = 8_000;

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

async function prefetchContext(
  nativeFetch: typeof window.fetch,
  event: ScheduleEvent
): Promise<SeriesContext | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);
  try {
    const response = await nativeFetch(
      `/v1/lol/series/${encodeURIComponent(event.series.id)}/context?prefetch=${Date.now()}`,
      { cache: 'no-store', signal: controller.signal }
    );
    if (!response.ok) return null;
    return await response.json() as SeriesContext;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function runPrefetch(
  nativeFetch: typeof window.fetch,
  events: readonly ScheduleEvent[],
  history: boolean,
  prefetchedAt: Map<string, number>
): Promise<void> {
  const now = Date.now();
  const queue = [...candidates(events, history, prefetchedAt, now)];
  queue.forEach(event => prefetchedAt.set(event.series.id, now));

  const workers = Array.from(
    { length: Math.min(PREFETCH_CONCURRENCY, queue.length) },
    async () => {
      while (queue.length) {
        const event = queue.shift();
        if (!event) return;
        await prefetchContext(nativeFetch, event);
      }
    }
  );
  await Promise.all(workers);
}

export function installCatalogueContextPrefetch(): void {
  const nativeFetch = window.fetch.bind(window);
  const prefetchedAt = new Map<string, number>();

  window.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const url = requestUrl(input);
    if (!url || !response.ok || !isSchedule(url)) return response;

    const copy = response.clone();
    window.setTimeout(() => {
      void copy.json()
        .then((payload: ScheduleResponse) => {
          if (!Array.isArray(payload.events) || !payload.events.length) return;
          return runPrefetch(
            nativeFetch,
            payload.events,
            isHistorySchedule(url),
            prefetchedAt
          );
        })
        .catch(() => undefined);
    }, 0);

    return response;
  };
}
