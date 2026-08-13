const CACHE_NAME = 'arena-v3-api-last-good-v1';
const CACHE_KEY_PREFIX = '/__arena-v3-api-last-good__';
const SCHEDULE_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
const CONTEXT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DOTA_LIVE_MAX_AGE_MS = 10 * 60 * 1_000;

function isCacheablePath(pathname: string): boolean {
  return pathname === '/v1/lol/schedule'
    || pathname === '/v1/dota2/live'
    || (/^\/v1\/lol\/series\/[^/]+\/context$/.test(pathname));
}

function maxAgeMs(pathname: string): number {
  if (pathname === '/v1/dota2/live') return DOTA_LIVE_MAX_AGE_MS;
  return pathname === '/v1/lol/schedule'
    ? SCHEDULE_MAX_AGE_MS
    : CONTEXT_MAX_AGE_MS;
}

function cacheKey(source: URL): Request {
  const key = new URL(`${CACHE_KEY_PREFIX}${source.pathname}`, window.location.origin);
  const query = new URLSearchParams(source.search);
  query.delete('after');
  query.delete('final');
  query.delete('commit');
  query.delete('cb');
  query.delete('_');
  query.sort();
  const serialized = query.toString();
  key.search = serialized ? `?${serialized}` : '';
  return new Request(key.toString(), { method: 'GET' });
}

export async function rememberLastGoodApiResponse(
  source: URL,
  response: Response
): Promise<void> {
  if (!('caches' in window) || !isCacheablePath(source.pathname) || !response.ok) return;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return;

  try {
    const body = await response.clone().text();
    if (!body) return;
    const cache = await window.caches.open(CACHE_NAME);
    await cache.put(cacheKey(source), new Response(body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'x-arena-cached-at': String(Date.now())
      }
    }));
  } catch {
    // CacheStorage is an optional resilience layer. Network data remains authoritative.
  }
}

export async function readLastGoodApiResponse(source: URL): Promise<Response | null> {
  if (!('caches' in window) || !isCacheablePath(source.pathname)) return null;

  try {
    const cache = await window.caches.open(CACHE_NAME);
    const key = cacheKey(source);
    const stored = await cache.match(key);
    if (!stored) return null;

    const cachedAt = Number(stored.headers.get('x-arena-cached-at'));
    const age = Number.isFinite(cachedAt) ? Math.max(0, Date.now() - cachedAt) : Number.POSITIVE_INFINITY;
    if (age > maxAgeMs(source.pathname)) {
      await cache.delete(key);
      return null;
    }

    const body = await stored.text();
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': stored.headers.get('content-type') ?? 'application/json',
        'x-arena-cached-at': String(cachedAt),
        'x-arena-data-source': 'cache'
      }
    });
  } catch {
    return null;
  }
}
