import type {
  LiveSnapshot,
  ScheduleEvent,
  SeriesContext,
  SeriesGameRef
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

interface CachedContext {
  expiresAt: number;
  value: SeriesContext;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 25_000;
const COMPLETED_SNAPSHOT_ATTEMPTS = 2;
const CONTEXT_CACHE_MS = 5 * 60 * 1_000;
const FUTURE_COMPLETION_TOLERANCE_MS = 5 * 60 * 1_000;
const LAZY_HISTORY_GAME_PREFIX = 'series-history:';
const RECOVERED_SNAPSHOT_EVENT = 'esports-live:v2-recovered-snapshot';
const RECENT_LPL_RECOVERY_WINDOW_MS = 12 * 60 * 60 * 1_000;
const RECENT_LPL_RECOVERY_LIMIT = 1;
const RECENT_LPL_GAME_PROBE_LIMIT = 2;
const contextCache = new Map<string, CachedContext>();
const lplRecoveryInFlight = new Set<string>();

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

function activeGameState(event: ScheduleEvent): 'live' | 'paused' | null {
  const active = event.series.games.find(game => (
    game.state === 'live' || game.state === 'draft' || game.state === 'paused'
  ));
  if (!active) return null;
  return active.state === 'paused' ? 'paused' : 'live';
}

function normalizeScheduleEvent(
  event: ScheduleEvent,
  now = Date.now()
): ScheduleEvent {
  const activeState = activeGameState(event);
  if (activeState && event.series.state !== activeState) {
    return {
      ...event,
      series: {
        ...event.series,
        state: activeState
      }
    };
  }

  if (event.series.state !== 'completed') return event;
  const scheduledStart = Date.parse(event.series.scheduledStart);
  if (!Number.isFinite(scheduledStart)) return event;
  if (scheduledStart <= now + FUTURE_COMPLETION_TOLERANCE_MS) return event;

  return {
    ...event,
    series: {
      ...event.series,
      state: 'scheduled',
      games: event.series.games.map(game => ({
        ...game,
        state: 'unstarted'
      }))
    }
  };
}

function isLplEvent(event: ScheduleEvent): boolean {
  const id = event.series.competition.id.trim().toLowerCase();
  const name = event.series.competition.name.trim().toLowerCase();
  return id === '98767991314006698'
    || name === 'lpl'
    || name.includes('league of legends pro league');
}

function suspiciousCompletedLplEvent(
  event: ScheduleEvent,
  now = Date.now()
): boolean {
  if (event.series.state !== 'completed' || !isLplEvent(event)) return false;
  const start = Date.parse(event.series.scheduledStart);
  if (!Number.isFinite(start)) return false;
  const elapsed = now - start;
  if (elapsed < 0 || elapsed > RECENT_LPL_RECOVERY_WINDOW_MS) return false;

  const winsRequired = Math.floor(Math.max(1, event.series.bestOf) / 2) + 1;
  const completedGames = event.series.games.filter(game => game.state === 'completed').length;
  return event.series.games.length < winsRequired
    || completedGames < winsRequired
    || event.series.games.some(game => game.state !== 'completed');
}

function recoveredGameState(
  snapshot: LiveSnapshot<LolStats>
): 'live' | 'draft' | 'paused' | null {
  if (snapshot.game.state === 'live'
    || snapshot.game.state === 'draft'
    || snapshot.game.state === 'paused') {
    return snapshot.game.state;
  }
  if (snapshot.game.state !== 'completed' && snapshot.stats) return 'live';
  return null;
}

function recoveredLiveSnapshot(
  event: ScheduleEvent,
  context: SeriesContext,
  snapshot: LiveSnapshot<LolStats>,
  gameState: 'live' | 'draft' | 'paused'
): LiveSnapshot<LolStats> {
  const historyGames: readonly SeriesGameRef[] = (context.history?.games ?? []).map(game => ({
    id: game.id,
    number: game.number,
    state: game.state
  }));
  const sourceGames = historyGames.length ? historyGames : event.series.games;
  const updatedGames = sourceGames.some(game => game.id === snapshot.game.id)
    ? sourceGames.map(game => game.id === snapshot.game.id
        ? { ...game, state: gameState }
        : game)
    : [
        ...sourceGames,
        {
          id: snapshot.game.id,
          number: snapshot.game.number,
          state: gameState
        }
      ];
  const seriesState = gameState === 'paused' ? 'paused' : 'live';

  return {
    ...snapshot,
    series: {
      ...snapshot.series,
      ...event.series,
      state: seriesState,
      games: updatedGames
    },
    game: {
      ...snapshot.game,
      state: gameState
    }
  };
}

async function recoverCompletedLplEvent(
  event: ScheduleEvent,
  signal?: AbortSignal
): Promise<void> {
  if (lplRecoveryInFlight.has(event.series.id) || signal?.aborted) return;
  lplRecoveryInFlight.add(event.series.id);

  try {
    const context = await loadSeriesContext(event.series.id, signal);
    const candidates = [...(context.history?.games ?? [])]
      .filter(game => game.state !== 'completed')
      .sort((left, right) => left.number - right.number)
      .slice(0, RECENT_LPL_GAME_PROBE_LIMIT);

    for (let index = 0; index < candidates.length; index += 1) {
      if (signal?.aborted) return;
      const candidate = candidates[index]!;
      try {
        const snapshot = await requestJson<LiveSnapshot<LolStats>>(
          snapshotPath(candidate.id, null, `lpl-probe-${Date.now()}-${index}`),
          signal,
          SNAPSHOT_TIMEOUT_MS
        );
        const gameState = recoveredGameState(snapshot);
        if (!gameState) continue;
        window.dispatchEvent(new CustomEvent<LiveSnapshot<LolStats>>(
          RECOVERED_SNAPSHOT_EVENT,
          { detail: recoveredLiveSnapshot(event, context, snapshot, gameState) }
        ));
        return;
      } catch (error) {
        if (signal?.aborted) return;
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
  } finally {
    lplRecoveryInFlight.delete(event.series.id);
  }
}

function scheduleRecentLplRecovery(
  events: readonly ScheduleEvent[],
  signal?: AbortSignal
): void {
  const candidates = events
    .filter(event => suspiciousCompletedLplEvent(event))
    .sort((left, right) => (
      Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart)
    ))
    .slice(0, RECENT_LPL_RECOVERY_LIMIT);
  if (!candidates.length) return;

  window.setTimeout(() => {
    if (signal?.aborted) return;
    candidates.forEach(event => void recoverCompletedLplEvent(event, signal));
  }, 0);
}

function lazyHistoryGameId(seriesId: string): string {
  return `${LAZY_HISTORY_GAME_PREFIX}${encodeURIComponent(seriesId)}`;
}

function lazyHistorySeriesId(gameId: string): string | null {
  if (!gameId.startsWith(LAZY_HISTORY_GAME_PREFIX)) return null;
  try {
    return decodeURIComponent(gameId.slice(LAZY_HISTORY_GAME_PREFIX.length));
  } catch {
    return null;
  }
}

function ensureSelectableCompletedEvent(event: ScheduleEvent): ScheduleEvent {
  if (event.series.state !== 'completed' || event.series.games.length) return event;
  return {
    ...event,
    series: {
      ...event.series,
      games: [{
        id: lazyHistoryGameId(event.series.id),
        number: 1,
        state: 'completed'
      }]
    }
  };
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
    context = await loadSeriesContext(initial.series.id, signal);
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

async function loadLazyHistorySnapshot(
  seriesId: string,
  signal?: AbortSignal
): Promise<LiveSnapshot<LolStats>> {
  const context = await loadSeriesContext(seriesId, signal);
  const canonicalGame = [...(context.history?.games ?? [])]
    .reverse()
    .find(game => game.state === 'completed')
    ?? context.history?.games.at(-1)
    ?? null;
  if (!canonicalGame) {
    throw new Error('Completed game history is not available for this match yet.');
  }

  const snapshot = await requestJson<LiveSnapshot<LolStats>>(
    snapshotPath(canonicalGame.id, null, String(Date.now())),
    signal,
    SNAPSHOT_TIMEOUT_MS
  );
  if (snapshot.stats) return snapshot;
  return loadCompletedSnapshot(snapshot, canonicalGame.id, signal);
}

export function loadHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', signal);
}

export async function loadSeriesContext(
  seriesId: string,
  signal?: AbortSignal
): Promise<SeriesContext> {
  const cached = contextCache.get(seriesId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await requestJson<SeriesContext>(
    `/v1/lol/series/${encodeURIComponent(seriesId)}/context?final=${Date.now()}`,
    signal
  );
  contextCache.set(seriesId, {
    value,
    expiresAt: Date.now() + CONTEXT_CACHE_MS
  });
  return value;
}

export async function loadSchedule(
  view: DataView,
  signal?: AbortSignal
): Promise<readonly ScheduleEvent[]> {
  const states = view === 'matches'
    ? 'live,paused,scheduled,unknown'
    : 'completed';
  const payload = await requestJson<ScheduleResponse>(
    `/v1/lol/schedule?states=${states}`,
    signal
  );
  const events = payload.events.map(event => normalizeScheduleEvent(event));
  const normalized = view === 'history'
    ? events.map(event => ensureSelectableCompletedEvent(event))
    : events;
  if (view === 'history') scheduleRecentLplRecovery(normalized, signal);
  return normalized;
}

export async function loadSnapshot(
  gameId: string,
  after: string | null,
  signal?: AbortSignal
): Promise<LiveSnapshot<LolStats>> {
  const lazySeriesId = lazyHistorySeriesId(gameId);
  if (lazySeriesId) return loadLazyHistorySnapshot(lazySeriesId, signal);

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
