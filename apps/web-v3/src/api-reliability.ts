import {
  readLastGoodApiResponse,
  rememberLastGoodApiResponse
} from './api-last-good.ts';

const CONFIGURED_PRIMARY = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const CONFIGURED_FALLBACK = String(
  import.meta.env.VITE_API_FALLBACK_BASE_URL
    ?? 'https://mobile-demo-esports-live-api.acchtt.workers.dev'
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
 * V3 is deployed against a Cloudflare Worker version-preview URL so API changes
 * can be validated without touching the current build. Version-preview routes
 * can occasionally become unreachable from a browser even though a recent
 * health probe succeeded. Keep V3 usable by falling back to the current stable
 * mobile API after a genuine network failure.
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
  let activeBase = primaryBase;
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
    const targetInput = activeBase === primaryBase
      ? input
      : rewrittenInput(input, init, source, activeBase);

    try {
      const response = await rawFetch(targetInput, init);
      remember(source, response);
      return response;
    } catch (error) {
      if (signal?.aborted) throw error;

      if (
        activeBase === primaryBase
        && fallbackBase
        && fallbackOrigin !== primaryOrigin
      ) {
        const fallbackInput = rewrittenInput(input, init, source, fallbackBase);
        try {
          const response = await rawFetch(fallbackInput, init);
          activeBase = fallbackBase;
          document.documentElement.dataset.v3ApiEndpoint = 'fallback';
          remember(source, response);
          return response;
        } catch (fallbackError) {
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

  document.documentElement.dataset.v3ApiEndpoint = 'primary';
  document.documentElement.dataset.v3DataSource = 'live';
}
