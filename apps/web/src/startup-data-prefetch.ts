const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const HEALTH_PATH = '/health';
const SCHEDULE_PATH = '/v1/lol/schedule?states=live,paused,scheduled';
const CACHE_PREFIX = 'esports-live:startup-cache:v1:';
const HEALTH_CACHE_MAX_AGE_MS = 10 * 60 * 1_000;
const SCHEDULE_CACHE_MAX_AGE_MS = 10 * 60 * 1_000;

interface StoredResponse {
  storedAt: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

type StartupResource = 'health' | 'schedule';

const nativeFetch = window.fetch.bind(window);
const targetUrls: Record<StartupResource, string> = {
  health: new URL(`${API_BASE}${HEALTH_PATH}`, window.location.href).toString(),
  schedule: new URL(`${API_BASE}${SCHEDULE_PATH}`, window.location.href).toString()
};
const cacheMaxAge: Record<StartupResource, number> = {
  health: HEALTH_CACHE_MAX_AGE_MS,
  schedule: SCHEDULE_CACHE_MAX_AGE_MS
};

function cacheKey(resource: StartupResource): string {
  return `${CACHE_PREFIX}${resource}`;
}

function readCached(resource: StartupResource): StoredResponse | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(resource));
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredResponse;
    if (
      !Number.isFinite(value.storedAt)
      || Date.now() - value.storedAt > cacheMaxAge[resource]
      || typeof value.body !== 'string'
      || !Array.isArray(value.headers)
    ) {
      window.localStorage.removeItem(cacheKey(resource));
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function writeCached(resource: StartupResource, value: StoredResponse): void {
  try {
    window.localStorage.setItem(cacheKey(resource), JSON.stringify(value));
  } catch {
    // Storage may be disabled or full. Startup still uses the in-flight prefetch.
  }
}

function responseFromStored(value: StoredResponse): Response {
  return new Response(value.body, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers
  });
}

async function fetchStored(resource: StartupResource): Promise<StoredResponse | null> {
  try {
    const response = await nativeFetch(targetUrls[resource], { cache: 'no-store' });
    if (!response.ok) return null;
    const value: StoredResponse = {
      storedAt: Date.now(),
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: await response.text()
    };
    writeCached(resource, value);
    return value;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): string | null {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    return new URL(raw, window.location.href).toString();
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function resourceFor(input: RequestInfo | URL): StartupResource | null {
  const url = requestUrl(input);
  if (url === targetUrls.health) return 'health';
  if (url === targetUrls.schedule) return 'schedule';
  return null;
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

const prefetched: Record<StartupResource, Promise<StoredResponse | null>> = {
  health: fetchStored('health'),
  schedule: fetchStored('schedule')
};
const firstRequestPending: Record<StartupResource, boolean> = {
  health: true,
  schedule: true
};

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const resource = resourceFor(input);
  if (!resource || requestMethod(input, init) !== 'GET' || !firstRequestPending[resource]) {
    return nativeFetch(input, init);
  }

  firstRequestPending[resource] = false;
  const signal = requestSignal(input, init);
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

  const cached = readCached(resource);
  if (cached) return responseFromStored(cached);

  const value = await waitWithSignal(prefetched[resource], signal);
  if (value) return responseFromStored(value);

  return nativeFetch(input, init);
};
