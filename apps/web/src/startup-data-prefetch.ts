const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const HEALTH_PATH = '/health';
const SCHEDULE_PATH = '/v1/lol/schedule?states=live,paused,scheduled';
const CACHE_PREFIX = 'esports-live:startup-cache:v2:';
const HEALTH_CACHE_MAX_AGE_MS = 10 * 60 * 1_000;
const SCHEDULE_CACHE_MAX_AGE_MS = 30 * 60 * 1_000;
const CONTEXT_CACHE_MAX_AGE_MS = 30 * 60 * 1_000;
const CONTEXT_WAIT_BUDGET_MS = 750;

interface StoredResponse {
  storedAt: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

interface ScheduleEnvelope {
  events?: Array<{
    series?: {
      id?: unknown;
      state?: unknown;
      games?: unknown[];
    };
  }>;
}

type StartupResource = 'health' | 'schedule';

const nativeFetch = window.fetch.bind(window);
const apiOrigin = new URL(API_BASE || window.location.origin, window.location.href).origin;
const targetUrls: Record<StartupResource, string> = {
  health: new URL(`${API_BASE}${HEALTH_PATH}`, window.location.href).toString(),
  schedule: new URL(`${API_BASE}${SCHEDULE_PATH}`, window.location.href).toString()
};
const cacheMaxAge: Record<StartupResource, number> = {
  health: HEALTH_CACHE_MAX_AGE_MS,
  schedule: SCHEDULE_CACHE_MAX_AGE_MS
};
const contextPrefetches = new Map<string, Promise<StoredResponse | null>>();

function cacheKey(resource: StartupResource): string {
  return `${CACHE_PREFIX}${resource}`;
}

function contextCacheKey(seriesId: string): string {
  return `${CACHE_PREFIX}context:${seriesId}`;
}

function readStored(key: string, maxAgeMs: number): StoredResponse | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredResponse;
    if (
      !Number.isFinite(value.storedAt)
      || Date.now() - value.storedAt > maxAgeMs
      || typeof value.body !== 'string'
      || !Array.isArray(value.headers)
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: StoredResponse): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be disabled or full. Startup still uses the in-flight request.
  }
}

function readCached(resource: StartupResource): StoredResponse | null {
  return readStored(cacheKey(resource), cacheMaxAge[resource]);
}

function responseFromStored(value: StoredResponse): Response {
  return new Response(value.body, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers
  });
}

async function fetchUrlStored(url: string, key: string): Promise<StoredResponse | null> {
  try {
    const response = await nativeFetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const value: StoredResponse = {
      storedAt: Date.now(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: await response.text()
    };
    writeStored(key, value);
    return value;
  } catch {
    return null;
  }
}

function contextUrl(seriesId: string): string {
  return new URL(
    `${API_BASE}/v1/lol/series/${encodeURIComponent(seriesId)}/context?live=${Date.now()}`,
    window.location.href
  ).toString();
}

function startContextPrefetch(seriesId: string): Promise<StoredResponse | null> {
  const pending = contextPrefetches.get(seriesId);
  if (pending) return pending;
  const request = fetchUrlStored(contextUrl(seriesId), contextCacheKey(seriesId))
    .finally(() => contextPrefetches.delete(seriesId));
  contextPrefetches.set(seriesId, request);
  return request;
}

function warmMissingContexts(scheduleBody: string): void {
  try {
    const payload = JSON.parse(scheduleBody) as ScheduleEnvelope;
    for (const entry of payload.events ?? []) {
      const series = entry.series;
      const id = typeof series?.id === 'string' ? series.id : '';
      const state = String(series?.state ?? '');
      const games = Array.isArray(series?.games) ? series.games : [];
      if (id && (state === 'live' || state === 'paused') && games.length === 0) {
        void startContextPrefetch(id);
      }
    }
  } catch {
    // Invalid cached data is ignored; the normal application request will recover.
  }
}

async function fetchStartupStored(resource: StartupResource): Promise<StoredResponse | null> {
  const value = await fetchUrlStored(targetUrls[resource], cacheKey(resource));
  if (resource === 'schedule' && value) warmMissingContexts(value.body);
  return value;
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    return new URL(raw, window.location.href);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function resourceFor(input: RequestInfo | URL): StartupResource | null {
  const url = requestUrl(input)?.toString() ?? null;
  if (url === targetUrls.health) return 'health';
  if (url === targetUrls.schedule) return 'schedule';
  return null;
}

function contextSeriesIdFor(input: RequestInfo | URL): string | null {
  const url = requestUrl(input);
  if (!url || url.origin !== apiOrigin) return null;
  const match = url.pathname.match(/^\/v1\/lol\/series\/([^/]+)\/context$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  return init?.signal ?? (input instanceof Request ? input.signal : null);
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function waitWithinBudget<T>(
  promise: Promise<T>,
  budgetMs: number,
  signal: AbortSignal | null
): Promise<T | null> {
  let timer: number | null = null;
  try {
    return await waitWithSignal(Promise.race([
      promise,
      new Promise<null>(resolve => {
        timer = window.setTimeout(() => resolve(null), budgetMs);
      })
    ]), signal);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

const cachedSchedule = readCached('schedule');
if (cachedSchedule) warmMissingContexts(cachedSchedule.body);

const prefetched: Record<StartupResource, Promise<StoredResponse | null>> = {
  health: fetchStartupStored('health'),
  schedule: fetchStartupStored('schedule')
};
const firstRequestPending: Record<StartupResource, boolean> = {
  health: true,
  schedule: true
};

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (requestMethod(input, init) !== 'GET') return nativeFetch(input, init);

  const signal = requestSignal(input, init);
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const contextSeriesId = contextSeriesIdFor(input);
  if (contextSeriesId) {
    const cached = readStored(contextCacheKey(contextSeriesId), CONTEXT_CACHE_MAX_AGE_MS);
    if (cached) return responseFromStored(cached);

    const value = await waitWithinBudget(
      startContextPrefetch(contextSeriesId),
      CONTEXT_WAIT_BUDGET_MS,
      signal
    );
    if (value) return responseFromStored(value);

    // Missing-game context is optional enrichment. Fail it quickly so the base
    // schedule can render while the shared background request continues.
    throw new Error('Series context enrichment is still loading.');
  }

  const resource = resourceFor(input);
  if (!resource || !firstRequestPending[resource]) return nativeFetch(input, init);

  firstRequestPending[resource] = false;
  const cached = readCached(resource);
  if (cached) return responseFromStored(cached);

  const value = await waitWithSignal(prefetched[resource], signal);
  if (value) return responseFromStored(value);

  return nativeFetch(input, init);
};
