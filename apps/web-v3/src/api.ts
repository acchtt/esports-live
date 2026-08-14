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
const LAZY_LIVE_GAME_PREFIX = 'series-live:';
const RECOVERED_SNAPSHOT_EVENT = 'esports-live:v2-recovered-snapshot';
const RECENT_LPL_RECOVERY_WINDOW_MS = 12 * 60 * 60 * 1_000;
const RECENT_LPL_RECOVERY_LIMIT = 1;
const RECENT_LPL_GAME_PROBE_LIMIT = 2;
const LAZY_LIVE_GAME_PROBE_LIMIT = 3;
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

function contextGameInventory(context: SeriesContext): readonly SeriesGameRef[] {
  return (context.history?.games ?? [])
    .map(game => ({ id: game.id, number: game.number, state: game.state }))
    .sort((left, right) => left.number - right.number);
}

function snapshotWithContextInventory(
  snapshot: LiveSnapshot<LolStats>,
  context: SeriesContext,
  gameState: 'live' | 'draft' | 'paused'
): LiveSnapshot<LolStats> {
  const sourceGames = contextGameInventory(context);
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
      state: seriesState,
      games: updatedGames
    },
    game: {
      ...snapshot.game,
      state: gameState
    }
  };
}

function recoveredLiveSnapshot(
  event: ScheduleEvent,
  context: SeriesContext,
  snapshot: LiveSnapshot<LolStats>,
  gameState: 'live' | 'draft' | 'paused'
): LiveSnapshot<LolStats> {
  const recovered = snapshotWithContextInventory(snapshot, context, gameState);
  return {
    ...recovered,
    series: {
      ...recovered.series,
      ...event.series,
      state: recovered.series.state,
      games: recovered.series.games
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

function lazyLiveGameId(seriesId: string): string {
  return `${LAZY_LIVE_GAME_PREFIX}${encodeURIComponent(seriesId)}`;
}

function lazyLiveSeriesId(gameId: string): string | null {
  if (!gameId.startsWith(LAZY_LIVE_GAME_PREFIX)) return null;
  try {
    return decodeURIComponent(gameId.slice(LAZY_LIVE_GAME_PREFIX.length));
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

function ensureSelectableLiveEvent(
  event: ScheduleEvent,
  now = Date.now()
): ScheduleEvent {
  if (event.series.games.length || event.series.state === 'completed') return event;
  const scheduledStart = Date.parse(event.series.scheduledStart);
  const started = Number.isFinite(scheduledStart)
    && scheduledStart <= now + FUTURE_COMPLETION_TOLERANCE_MS;
  const shouldHydrate = event.series.state === 'live'
    || event.series.state === 'paused'
    || (isLplEvent(event) && started
      && (event.series.state === 'scheduled' || event.series.state === 'unknown'));
  if (!shouldHydrate) return event;

  const state = event.series.state === 'paused'
    ? 'paused'
    : event.series.state === 'live'
      ? 'live'
      : 'unknown';
  return {
    ...event,
    series: {
      ...event.series,
      games: [{
        id: lazyLiveGameId(event.series.id),
        number: 1,
        state
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

async function loadLazyLiveSnapshot(
  seriesId: string,
  signal?: AbortSignal
): Promise<LiveSnapshot<LolStats>> {
  const context = await loadSeriesContext(seriesId, signal);
  const games = [...(context.history?.games ?? [])];
  const stateRank = (state: SeriesGameRef['state']): number => {
    if (state === 'live' || state === 'draft' || state === 'paused') return 0;
    if (state === 'unstarted' || state === 'unknown') return 1;
    return 2;
  };
  const candidates = games
    .sort((left, right) => {
      const rankDifference = stateRank(left.state) - stateRank(right.state);
      if (rankDifference) return rankDifference;
      return right.number - left.number;
    })
    .slice(0, LAZY_LIVE_GAME_PROBE_LIMIT);
  if (!candidates.length) {
    throw new Error('The provider has not published a game ID for this live match yet.');
  }

  let fallback: LiveSnapshot<LolStats> | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    if (signal?.aborted) throw signal.reason;
    const candidate = candidates[index]!;
    try {
      const snapshot = await requestJson<LiveSnapshot<LolStats>>(
        snapshotPath(candidate.id, null, `live-hydrate-${Date.now()}-${index}`),
        signal,
        SNAPSHOT_TIMEOUT_MS
      );
      fallback = snapshot;
      const gameState = recoveredGameState(snapshot);
      if (gameState) return snapshotWithContextInventory(snapshot, context, gameState);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }

  if (fallback) return fallback;
  throw new Error('Live game telemetry is not available for this match yet.');
}

export function loadHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', signal);
}

export async function loadSeriesContext(
  seriesId: string,
  signal?: AbortSignal,
  maxAgeMs = CONTEXT_CACHE_MS
): Promise<SeriesContext> {
  const cached = contextCache.get(seriesId);
  const now = Date.now();
  const cachedAt = cached ? cached.expiresAt - CONTEXT_CACHE_MS : 0;
  if (cached && cached.expiresAt > now && now - cachedAt < maxAgeMs) return cached.value;
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
    : events.map(event => ensureSelectableLiveEvent(event));
  if (view === 'history') scheduleRecentLplRecovery(normalized, signal);
  return normalized;
}

export async function loadSnapshot(
  gameId: string,
  after: string | null,
  signal?: AbortSignal
): Promise<LiveSnapshot<LolStats>> {
  const lazyHistoryId = lazyHistorySeriesId(gameId);
  if (lazyHistoryId) return loadLazyHistorySnapshot(lazyHistoryId, signal);
  const lazyLiveId = lazyLiveSeriesId(gameId);
  if (lazyLiveId) return loadLazyLiveSnapshot(lazyLiveId, signal);

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
