const DEFAULT_TIMEOUT_MS = 10_000;
const LIVE_SNAPSHOT_TIMEOUT_MS = 25_000;

interface ApiRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function apiTimeoutForPath(path: string): number {
  const pathname = path.split('?', 1)[0] ?? path;
  return /^\/v1\/lol\/games\/[^/]+\/live$/.test(pathname)
    ? LIVE_SNAPSHOT_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
}

export async function apiJson<T>(
  baseUrl: string,
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Request timed out.')),
    options.timeoutMs ?? apiTimeoutForPath(path)
  );
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(body?.message ?? `API returned ${response.status}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new Error('The data request took too long. Try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
