const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const HEALTH_PATH = '/health';
const ACTIVE_SCHEDULE_PATH = '/v1/lol/schedule?states=live,paused,scheduled';
const CACHE_PREFIX = 'esports-live:mobile-data:v3:';
const HEALTH_CACHE_MAX_AGE_MS = 10 * 60 * 1_000;
const ACTIVE_SCHEDULE_CACHE_MAX_AGE_MS = 2 * 60 * 1_000;
const HISTORY_SCHEDULE_CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const HISTORY_CONTEXT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const STARTUP_NETWORK_BUDGET_MS = 1_200;
const HISTORY_RETRY_DELAY_MS = 300;

type StartupResource = 'health' | 'schedule';
type JsonRecord = Record<string, unknown>;

interface StoredResponse {
  storedAt: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

class StoredHttpError extends Error {
  readonly response: StoredResponse;

  constructor(response: StoredResponse) {
    super(`API returned ${response.status}`);
    this.name = 'StoredHttpError';
    this.response = response;
  }
}

const nativeFetch = window.fetch.bind(window);
const apiOrigin = new URL(API_BASE || window.location.origin, window.location.href).origin;
const startupUrls: Record<StartupResource, string> = {
  health: new URL(`${API_BASE}${HEALTH_PATH}`, window.location.href).toString(),
  schedule: new URL(`${API_BASE}${ACTIVE_SCHEDULE_PATH}`, window.location.href).toString()
};
const startupCacheAge: Record<StartupResource, number> = {
  health: HEALTH_CACHE_MAX_AGE_MS,
  schedule: ACTIVE_SCHEDULE_CACHE_MAX_AGE_MS
};

function object(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function cacheKey(resource: StartupResource): string {
  return `${CACHE_PREFIX}${resource}`;
}

function historyContextCacheKey(seriesId: string): string {
  return `${CACHE_PREFIX}history-context:${seriesId}`;
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
    // Storage is an optional fallback. Network responses still remain usable.
  }
}

function responseFromStored(value: StoredResponse): Response {
  return new Response(value.body, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers
  });
}

async function fetchStored(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<StoredResponse> {
  const response = await nativeFetch(input, { ...init, cache: 'no-store' });
  const stored: StoredResponse = {
    storedAt: Date.now(),
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body: await response.text()
  };
  if (!response.ok) throw new StoredHttpError(stored);
  return stored;
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

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  return init?.signal ?? (input instanceof Request ? input.signal : null);
}

function startupResourceFor(input: RequestInfo | URL): StartupResource | null {
  const url = requestUrl(input)?.toString() ?? null;
  if (url === startupUrls.health) return 'health';
  if (url === startupUrls.schedule) return 'schedule';
  return null;
}

function isHistorySchedule(url: URL | null): boolean {
  return Boolean(
    url
    && url.origin === apiOrigin
    && url.pathname === '/v1/lol/schedule'
    && url.searchParams.get('limit') === '80'
    && !url.searchParams.has('states')
  );
}

function completedContextSeriesId(url: URL | null): string | null {
  if (!url || url.origin !== apiOrigin || !url.searchParams.has('completed')) return null;
  const match = url.pathname.match(/^\/v1\/lol\/series\/([^/]+)\/context$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
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

function delay(ms: number, signal: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = (): void => {
      window.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function normalizeHistorySchedule(value: StoredResponse): StoredResponse {
  try {
    const payload = object(JSON.parse(value.body));
    const source = Array.isArray(payload?.events) ? payload.events : null;
    if (!payload || !source) return value;

    const events = source
      .map((entry, index) => {
        const event = object(entry);
        const series = object(event?.series);
        const start = Date.parse(String(series?.scheduledStart ?? ''));
        return { entry, index, start: Number.isFinite(start) ? start : Number.NEGATIVE_INFINITY };
      })
      .sort((left, right) => right.start - left.start || left.index - right.index)
      .map(({ entry }) => {
        const event = object(entry);
        const series = object(event?.series);
        if (!event || !series) return entry;
        return {
          ...event,
          // History is verified from series context. Removing the schedule-state
          // priority prevents older "completed" flags from pushing a newly ended
          // but stale-state series outside the candidate window.
          series: { ...series, state: 'unknown' }
        };
      });

    return { ...value, body: JSON.stringify({ ...payload, events }) };
  } catch {
    return value;
  }
}

async function resilientResponse(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: {
    cacheKey: string;
    cacheMaxAgeMs: number;
    attempts: number;
    transform?: (value: StoredResponse) => StoredResponse;
  }
): Promise<Response> {
  const signal = requestSignal(input, init);
  let failure: unknown = null;

  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      const fetched = await fetchStored(input, init);
      const value = options.transform ? options.transform(fetched) : fetched;
      writeStored(options.cacheKey, value);
      return responseFromStored(value);
    } catch (error) {
      failure = error;
      if (signal?.aborted) throw signal.reason ?? error;
      if (error instanceof StoredHttpError && error.response.status < 500) break;
      if (attempt + 1 < options.attempts) await delay(HISTORY_RETRY_DELAY_MS, signal);
    }
  }

  const cached = readStored(options.cacheKey, options.cacheMaxAgeMs);
  if (cached) return responseFromStored(cached);
  if (failure instanceof StoredHttpError) return responseFromStored(failure.response);
  throw failure ?? new Error('The data request failed.');
}

async function prefetchStartup(resource: StartupResource): Promise<StoredResponse | null> {
  try {
    const value = await fetchStored(startupUrls[resource]);
    writeStored(cacheKey(resource), value);
    return value;
  } catch {
    return null;
  }
}

const prefetched: Record<StartupResource, Promise<StoredResponse | null>> = {
  health: prefetchStartup('health'),
  schedule: prefetchStartup('schedule')
};
const firstRequestPending: Record<StartupResource, boolean> = {
  health: true,
  schedule: true
};

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (requestMethod(input, init) !== 'GET') return nativeFetch(input, init);

  const url = requestUrl(input);
  if (isHistorySchedule(url)) {
    return resilientResponse(input, init, {
      cacheKey: `${CACHE_PREFIX}history-schedule`,
      cacheMaxAgeMs: HISTORY_SCHEDULE_CACHE_MAX_AGE_MS,
      attempts: 2,
      transform: normalizeHistorySchedule
    });
  }

  const completedSeriesId = completedContextSeriesId(url);
  if (completedSeriesId) {
    return resilientResponse(input, init, {
      cacheKey: historyContextCacheKey(completedSeriesId),
      cacheMaxAgeMs: HISTORY_CONTEXT_CACHE_MAX_AGE_MS,
      attempts: 2
    });
  }

  const resource = startupResourceFor(input);
  if (!resource || !firstRequestPending[resource]) return nativeFetch(input, init);

  firstRequestPending[resource] = false;
  const signal = requestSignal(input, init);
  const fresh = await waitWithinBudget(prefetched[resource], STARTUP_NETWORK_BUDGET_MS, signal);
  if (fresh) return responseFromStored(fresh);

  const cached = readStored(cacheKey(resource), startupCacheAge[resource]);
  if (cached) return responseFromStored(cached);

  const completed = await waitWithSignal(prefetched[resource], signal);
  if (completed) return responseFromStored(completed);
  return nativeFetch(input, init);
};

document.documentElement.dataset.mobileHistoryReliability = 'network-first-v26';

export {};
