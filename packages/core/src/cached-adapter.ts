import type { EsportAdapter, ScheduleQuery } from './adapter.ts';
import type { EsportId, LiveSnapshot, ScheduleEvent, SeriesContext } from './domain.ts';

export interface AdapterCachePolicy {
  scheduleTtlMs: number;
  liveSnapshotTtlMs: number;
  seriesContextTtlMs: number;
}

export const DEFAULT_ADAPTER_CACHE_POLICY: AdapterCachePolicy = {
  scheduleTtlMs: 10_000,
  liveSnapshotTtlMs: 1_500,
  seriesContextTtlMs: 300_000
};

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

function queryKey(query: ScheduleQuery): string {
  return JSON.stringify({
    from: query.from ?? null,
    to: query.to ?? null,
    competitionId: query.competitionId ?? null,
    competitionIds: query.competitionIds ? [...query.competitionIds].sort() : [],
    states: query.states ? [...query.states].sort() : []
  });
}

export class CachedAdapter<TStats = unknown> implements EsportAdapter<TStats> {
  readonly esport: EsportId;
  readonly providerId: string;
  readonly getSeriesContext?: (seriesId: string) => Promise<SeriesContext>;
  readonly #adapter: EsportAdapter<TStats>;
  readonly #policy: AdapterCachePolicy;
  readonly #now: () => number;
  readonly #cache = new Map<string, CacheEntry<unknown>>();
  readonly #inFlight = new Map<string, Promise<unknown>>();

  constructor(
    adapter: EsportAdapter<TStats>,
    policy: Partial<AdapterCachePolicy> = {},
    now: () => number = Date.now
  ) {
    this.#adapter = adapter;
    this.esport = adapter.esport;
    this.providerId = adapter.providerId;
    this.#policy = { ...DEFAULT_ADAPTER_CACHE_POLICY, ...policy };
    this.#now = now;

    if (adapter.getSeriesContext) {
      this.getSeriesContext = (seriesId: string) => this.#load(
        `context:${seriesId}`,
        this.#policy.seriesContextTtlMs,
        () => adapter.getSeriesContext!(seriesId)
      );
    }
  }

  async #load<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.#cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > this.#now()) return cached.value;

    const pending = this.#inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const promise = loader()
      .then(value => {
        this.#cache.set(key, { value, expiresAt: this.#now() + ttlMs });
        return value;
      })
      .finally(() => {
        if (this.#inFlight.get(key) === promise) this.#inFlight.delete(key);
      });

    this.#inFlight.set(key, promise);
    return promise;
  }

  getSchedule(query: ScheduleQuery = {}): Promise<readonly ScheduleEvent[]> {
    return this.#load(
      `schedule:${queryKey(query)}`,
      this.#policy.scheduleTtlMs,
      () => this.#adapter.getSchedule(query)
    );
  }

  getLiveSnapshot(gameId: string, after?: string): Promise<LiveSnapshot<TStats>> {
    const key = `snapshot:${gameId}:${after ?? 'latest'}`;
    return this.#load(
      key,
      this.#policy.liveSnapshotTtlMs,
      () => this.#adapter.getLiveSnapshot(gameId, after)
    );
  }
}
