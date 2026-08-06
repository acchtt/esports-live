import type {
  LiveSnapshot,
  ScheduleEvent,
  SeriesContext
} from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import type { DataView } from './state.ts';

export interface HealthResponse {
  ok: boolean;
  service: string;
  schemaVersion: string;
  adapters: readonly string[];
}

interface ScheduleResponse {
  esport: string;
  events: readonly ScheduleEvent[];
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 25_000;
const COMPLETED_SNAPSHOT_ATTEMPTS = 2;

async function requestJson<T>(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Request timed out.')),
    timeoutMs
  );
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) {
      const value = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(value?.message ?? `API returned ${response.status}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error('The data request took too long. Try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function snapshotPath(
  gameId: string,
  after: string | null,
  finalToken: string | null = null
): string {
  const query = new URLSearchParams();
  if (after) query.set('after', after);
  if (finalToken) query.set('final', finalToken);
  const suffix = query.size ? `?${query.toString()}` : '';
  return `/v1/lol/games/${encodeURIComponent(gameId)}/live${suffix}`;
}

function aliasCompletedSnapshot(
  snapshot: LiveSnapshot<LolStats>,
  requestedGameId: string,
  requestedGameNumber: number
): LiveSnapshot<LolStats> {
  if (snapshot.game.id === requestedGameId) return snapshot;
  const sourceGameId = snapshot.game.id;
  return {
    ...snapshot,
    game: {
      ...snapshot.game,
      id: requestedGameId,
      number: requestedGameNumber,
      state: 'completed'
    },
    series: {
      ...snapshot.series,
      games: snapshot.series.games.map(game => game.id === sourceGameId
        ? {
            ...game,
            id: requestedGameId,
            number: requestedGameNumber,
            state: 'completed'
          }
        : game)
    }
  };
}

async function loadCompletedSnapshot(
  initial: LiveSnapshot<LolStats>,
  requestedGameId: string,
  signal?: AbortSignal
): Promise<LiveSnapshot<LolStats>> {
  let context: SeriesContext | null = null;
  try {
    context = await requestJson<SeriesContext>(
      `/v1/lol/series/${encodeURIComponent(initial.series.id)}/context?final=${Date.now()}`,
      signal
    );
  } catch (error) {
    if (signal?.aborted) throw error;
  }

  const canonicalGame = context?.history?.games.find(game => game.id === requestedGameId)
    ?? context?.history?.games.find(game => (
      game.number === initial.game.number && game.state === 'completed'
    ));
  const candidateIds = [...new Set(
    [canonicalGame?.id, requestedGameId]
      .filter((value): value is string => Boolean(value))
  )];
  let fallback = initial;

  for (let attempt = 0; attempt < COMPLETED_SNAPSHOT_ATTEMPTS; attempt += 1) {
    for (let index = 0; index < candidateIds.length; index += 1) {
      const candidateId = candidateIds[index]!;
      try {
        const snapshot = await requestJson<LiveSnapshot<LolStats>>(
          snapshotPath(candidateId, null, `${Date.now()}-${attempt}-${index}`),
          signal,
          SNAPSHOT_TIMEOUT_MS
        );
        fallback = snapshot;
        if (snapshot.stats) {
          return aliasCompletedSnapshot(
            snapshot,
            requestedGameId,
            initial.game.number
          );
        }
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
  }

  return aliasCompletedSnapshot(
    fallback,
    requestedGameId,
    initial.game.number
  );
}

export function loadHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', signal);
}

export async function loadSchedule(
  view: DataView,
  signal?: AbortSignal
): Promise<readonly ScheduleEvent[]> {
  const states = view === 'matches' ? 'live,paused,scheduled' : 'completed';
  const payload = await requestJson<ScheduleResponse>(
    `/v1/lol/schedule?states=${states}`,
    signal
  );
  return payload.events;
}

export async function loadSnapshot(
  gameId: string,
  after: string | null,
  signal?: AbortSignal
): Promise<LiveSnapshot<LolStats>> {
  const snapshot = await requestJson<LiveSnapshot<LolStats>>(
    snapshotPath(gameId, after, after ? null : String(Date.now())),
    signal,
    SNAPSHOT_TIMEOUT_MS
  );
  if (snapshot.stats) return snapshot;
  if (snapshot.game.state !== 'completed' && snapshot.series.state !== 'completed') {
    return snapshot;
  }
  return loadCompletedSnapshot(snapshot, gameId, signal);
}
