import type { LolProviderClient, LolProviderSnapshot } from '@esports-live/adapter-lol';

export type GrubsCvMode = 'vision' | 'simulated';

export interface GrubsCvProviderOptions {
  baseUrl: string;
  token?: string;
  minConfidence?: number;
  timeoutMs?: number;
  cacheTtlMs?: number;
  maxLiveAgeMs?: number;
  allowSimulated?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface GrubsCvPayload {
  schemaVersion?: string;
  gameId?: string;
  blue?: number;
  red?: number;
  confidence?: number;
  observedAt?: string;
  source?: string;
  mode?: GrubsCvMode;
}

interface CachedCvResult {
  expiresAt: number;
  value: GrubsCvPayload | null;
}

const DEFAULT_MIN_CONFIDENCE = 0.9;
const DEFAULT_TIMEOUT_MS = 800;
const DEFAULT_CACHE_TTL_MS = 1_500;
const DEFAULT_MAX_LIVE_AGE_MS = 15_000;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function payload(value: unknown): GrubsCvPayload | null {
  const raw = object(value);
  const blue = count(raw.blue);
  const red = count(raw.red);
  const confidence = number(raw.confidence);
  if (typeof raw.gameId !== 'string' || blue === null || red === null || confidence === null) {
    return null;
  }
  return {
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : undefined,
    gameId: raw.gameId,
    blue,
    red,
    confidence,
    observedAt: typeof raw.observedAt === 'string' ? raw.observedAt : undefined,
    source: typeof raw.source === 'string' ? raw.source : undefined,
    mode: raw.mode === 'vision' || raw.mode === 'simulated' ? raw.mode : undefined
  };
}

function shouldQuery(snapshot: LolProviderSnapshot): boolean {
  if (!snapshot.stats) return false;
  if (snapshot.stats.blue.objectives.grubs !== null && snapshot.stats.red.objectives.grubs !== null) {
    return false;
  }
  return snapshot.game.state === 'live' || snapshot.game.state === 'paused' || snapshot.game.state === 'completed';
}

function trusted(
  result: GrubsCvPayload,
  snapshot: LolProviderSnapshot,
  options: Required<Pick<GrubsCvProviderOptions, 'minConfidence' | 'maxLiveAgeMs' | 'allowSimulated'>>,
  now: number
): boolean {
  if (result.gameId !== snapshot.game.id || result.source !== 'broadcast-cv') return false;
  if ((result.confidence ?? 0) < options.minConfidence) return false;
  if (result.mode === 'simulated' && !options.allowSimulated) return false;
  if (result.mode !== 'vision' && result.mode !== 'simulated') return false;

  if (snapshot.game.state === 'live' || snapshot.game.state === 'paused') {
    const observedAt = Date.parse(result.observedAt ?? '');
    if (!Number.isFinite(observedAt)) return false;
    const ageMs = Math.max(0, now - observedAt);
    if (ageMs > options.maxLiveAgeMs) return false;
  }
  return true;
}

function mergeGrubs(snapshot: LolProviderSnapshot, result: GrubsCvPayload): LolProviderSnapshot {
  if (!snapshot.stats) return snapshot;
  const blue = count(result.blue);
  const red = count(result.red);
  if (blue === null || red === null) return snapshot;

  return {
    ...snapshot,
    stats: {
      ...snapshot.stats,
      blue: {
        ...snapshot.stats.blue,
        objectives: {
          ...snapshot.stats.blue.objectives,
          grubs: snapshot.stats.blue.objectives.grubs ?? blue
        }
      },
      red: {
        ...snapshot.stats.red,
        objectives: {
          ...snapshot.stats.red.objectives,
          grubs: snapshot.stats.red.objectives.grubs ?? red
        }
      }
    }
  };
}

export function createGrubsCvProvider(
  base: LolProviderClient,
  options: GrubsCvProviderOptions
): LolProviderClient {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return base;

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxLiveAgeMs = options.maxLiveAgeMs ?? DEFAULT_MAX_LIVE_AGE_MS;
  const allowSimulated = options.allowSimulated ?? false;
  const cache = new Map<string, CachedCvResult>();
  const inflight = new Map<string, Promise<GrubsCvPayload | null>>();

  async function fetchResult(gameId: string): Promise<GrubsCvPayload | null> {
    const timestamp = now();
    const cached = cache.get(gameId);
    if (cached && cached.expiresAt > timestamp) return cached.value;
    const pending = inflight.get(gameId);
    if (pending) return pending;

    const request = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers = new Headers({ accept: 'application/json' });
        if (options.token?.trim()) headers.set('authorization', `Bearer ${options.token.trim()}`);
        const response = await fetchImpl(`${baseUrl}/v1/grubs/${encodeURIComponent(gameId)}`, {
          headers,
          signal: controller.signal
        });
        if (!response.ok) return null;
        return payload(await response.json());
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    })();

    inflight.set(gameId, request);
    const result = await request;
    inflight.delete(gameId);
    cache.set(gameId, { expiresAt: now() + cacheTtlMs, value: result });
    return result;
  }

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      const snapshot = await base.getSnapshot(gameId, after);
      if (!shouldQuery(snapshot)) return snapshot;

      const result = await fetchResult(gameId);
      if (!result || !trusted(result, snapshot, { minConfidence, maxLiveAgeMs, allowSimulated }, now())) {
        return snapshot;
      }
      return mergeGrubs(snapshot, result);
    }
  };
}
