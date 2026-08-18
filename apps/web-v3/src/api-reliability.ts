import {
  readLastGoodApiResponse,
  rememberLastGoodApiResponse
} from './api-last-good.ts';

const CONFIGURED_PRIMARY = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const CONFIGURED_FALLBACK = String(
  import.meta.env.VITE_API_FALLBACK_BASE_URL
    ?? 'https://mobile-v3-fallback-esports-live-api.acchtt.workers.dev'
).replace(/\/$/, '');

let installed = false;

function inputUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return new URL(input.href);
    return new URL(String(input), window.location.href);
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

function isApiPath(pathname: string): boolean {
  return pathname === '/health' || pathname.startsWith('/v1/');
}

function isSchedulePath(pathname: string): boolean {
  return pathname === '/v1/lol/schedule';
}

function rewrittenInput(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  source: URL,
  base: string
): RequestInfo | URL {
  const target = new URL(`${source.pathname}${source.search}${source.hash}`, `${base}/`);
  if (input instanceof Request) return new Request(target.toString(), input);
  if (input instanceof URL) return target;
  return target.toString();
}

function markDataSource(source: 'live' | 'cache'): void {
  const root = document.documentElement;
  root.dataset.v3DataSource = source;
  const pill = document.querySelector<HTMLElement>('.connection-pill');
  if (!pill) return;
  if (source === 'cache') {
    pill.setAttribute('aria-label', 'Cached data; reconnecting');
  } else if (pill.getAttribute('aria-label') === 'Cached data; reconnecting') {
    pill.removeAttribute('aria-label');
  }
}

function markApiEndpoint(endpoint: 'primary' | 'fallback'): void {
  document.documentElement.dataset.v3ApiEndpoint = endpoint;
}

async function cachedOrThrow(source: URL, error: unknown): Promise<Response> {
  const cached = await readLastGoodApiResponse(source);
  if (cached) {
    markDataSource('cache');
    return cached;
  }
  throw error;
}

function remember(source: URL, response: Response): void {
  if (!response.ok) return;
  markDataSource('live');
  void rememberLastGoodApiResponse(source, response);
}

/**
 * V3 is deployed against Cloudflare Worker version-preview URLs so API changes
 * can be validated without touching the current build. Both the primary and
 * fallback endpoints are uploaded from the exact V3 commit being deployed.
 *
 * A preview route can occasionally become unreachable from a browser even when
 * a recent health probe succeeded. Every request therefore retries the primary
 * first and uses the same-commit fallback only for a genuine network failure.
 * The next request immediately gets another chance to recover to primary rather
 * than pinning the page to fallback for the rest of the session.
 *
 * If both network endpoints are unavailable, recent schedule/context responses
 * can be recovered from CacheStorage. Live snapshots keep using the dedicated
 * snapshot cache so the 2-second telemetry loop does not add extra CacheStorage
 * writes.
 *
 * The catalogue asks for active and completed schedules together. Those are
 * comparatively expensive provider calls, so serialize schedule requests to
 * avoid doubling the Worker/provider load during initial page entry/refocus.
 */
export function installApiReliability(): void {
  if (installed) return;
  installed = true;

  const rawFetch = window.fetch.bind(window);
  const primaryBase = CONFIGURED_PRIMARY || window.location.origin;
  const fallbackBase = CONFIGURED_FALLBACK;
  const primaryOrigin = new URL(`${primaryBase}/`, window.location.href).origin;
  const fallbackOrigin = fallbackBase
    ? new URL(`${fallbackBase}/`, window.location.href).origin
    : primaryOrigin;
  let scheduleTail: Promise<void> = Promise.resolve();

  const fetchApi = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const source = inputUrl(input);
    if (
      !source
      || requestMethod(input, init) !== 'GET'
      || source.origin !== primaryOrigin
      || !isApiPath(source.pathname)
    ) {
      return rawFetch(input, init);
    }

    const signal = requestSignal(input, init);

    try {
      const response = await rawFetch(input, init);
      markApiEndpoint('primary');
      remember(source, response);
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;

      if (fallbackBase && fallbackOrigin !== primaryOrigin) {
        const fallbackInput = rewrittenInput(input, init, source, fallbackBase);
        try {
          const response = await rawFetch(fallbackInput, init);
          markApiEndpoint('fallback');
          remember(source, response);
          return response;
        } catch (fallbackError) {
          if (signal?.aborted) throw fallbackError;
          return cachedOrThrow(source, fallbackError);
        }
      }

      return cachedOrThrow(source, error);
    }
  };

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = inputUrl(input);
    if (
      requestMethod(input, init) !== 'GET'
      || !url
      || url.origin !== primaryOrigin
      || !isSchedulePath(url.pathname)
    ) {
      return fetchApi(input, init);
    }

    const run = scheduleTail.then(
      () => fetchApi(input, init),
      () => fetchApi(input, init)
    );
    scheduleTail = run.then(() => undefined, () => undefined);
    return run;
  };

  markApiEndpoint('primary');
  document.documentElement.dataset.v3DataSource = 'live';
}
