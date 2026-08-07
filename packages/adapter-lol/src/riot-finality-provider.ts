import type { GameState } from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderGame,
  LolProviderScheduleEntry,
  LolProviderSnapshot
} from './provider.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const REQUEST_TIMEOUT_MS = 2_500;
const DEFAULT_FINALITY_PROBE_MS = 5_000;
const DEFAULT_SCHEDULE_FINALITY_LOOKBACK_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_SCHEDULE_FINALITY_LOOKAHEAD_MS = 5 * 60 * 1_000;
const DEFAULT_SCHEDULE_FINALITY_LIMIT = 16;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiotFinalityProviderOptions {
  apiKey: string;
  fetcher?: FetchLike;
  now?: () => Date;
  finalityProbeMs?: number;
  scheduleFinalityLookbackMs?: number;
  scheduleFinalityLookaheadMs?: number;
  scheduleFinalityLimit?: number;
}

interface GameSignal {
  id: string | null;
  number: number;
  state: GameState;
}

interface FinalitySignal {
  games: readonly GameSignal[];
  seriesCompleted: boolean;
}

interface CachedFinalitySignal {
  expiresAt: number;
  value: FinalitySignal;
}

const object = (value: unknown): Json => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
);
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gameState(value: unknown): GameState {
  switch (String(value ?? '').toLowerCase()) {
    case 'completed':
    case 'finished': return 'completed';
    case 'inprogress':
    case 'in_progress':
    case 'live': return 'live';
    case 'championselect':
    case 'champion_select':
    case 'draft': return 'draft';
    case 'paused': return 'paused';
    case 'unstarted':
    case 'scheduled': return 'unstarted';
    default: return 'unknown';
  }
}

const GAME_STATE_RANK: Record<GameState, number> = {
  unknown: 0,
  unstarted: 1,
  draft: 2,
  live: 3,
  paused: 3,
  completed: 4
};

function strongerGameState(current: GameState, incoming: GameState): GameState {
  if (GAME_STATE_RANK[incoming] > GAME_STATE_RANK[current]) return incoming;
  if (GAME_STATE_RANK[incoming] === GAME_STATE_RANK[current] && incoming !== 'unknown') return incoming;
  return current;
}

function activeGameState(state: GameState): boolean {
  return state === 'draft' || state === 'live' || state === 'paused';
}

function eventFromPayload(value: unknown): Json {
  const root = object(value);
  const data = object(root.data);
  return object(data.event ?? root.event ?? data);
}

function finalOutcome(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'win' || normalized === 'loss';
}

function parseFinality(value: unknown): FinalitySignal {
  const event = eventFromPayload(value);
  const match = object(event.match);
  const games = array(match.games).map((entry, index): GameSignal => {
    const game = object(entry);
    return {
      id: stringValue(game.id ?? game.gameId),
      number: numberValue(game.number ?? game.gameNumber) ?? index + 1,
      state: gameState(game.state)
    };
  });

  const reportedState = String(event.state ?? match.state ?? '').toLowerCase();
  const strategy = object(match.strategy);
  const bestOf = Math.max(
    1,
    Math.round(numberValue(strategy.count ?? strategy.bestOf) ?? (games.length || 1))
  );
  const winsRequired = Math.floor(bestOf / 2) + 1;
  const teamResults = array(match.teams).map(team => object(object(team).result));
  const wins = teamResults.map(result => (
    Math.max(0, Math.round(numberValue(result.gameWins ?? result.wins) ?? 0))
  ));
  const hasClinchedScore = wins.some(value => value >= winsRequired);
  const hasPartialScore = wins.some(value => value > 0)
    && wins.every(value => value < winsRequired);
  const hasFinalOutcome = teamResults.some(result => finalOutcome(result.outcome));
  const reportedCompleted = reportedState === 'completed' || reportedState === 'finished';

  // Riot can briefly mark the whole series completed between games. A
  // non-clinching score without a match outcome is not series finality.
  const seriesCompleted = hasClinchedScore
    || hasFinalOutcome
    || (reportedCompleted && !hasPartialScore);

  return { games, seriesCompleted };
}

function signalForGame(signal: FinalitySignal, game: LolProviderGame): GameSignal | null {
  return signal.games.find(candidate => candidate.id === game.id)
    ?? signal.games.find(candidate => candidate.number === game.number)
    ?? null;
}

function applyGameSignals(
  games: readonly LolProviderGame[],
  signal: FinalitySignal
): readonly LolProviderGame[] {
  return games.map(game => {
    const gameSignal = signalForGame(signal, game);
    let state = gameSignal
      ? strongerGameState(game.state, gameSignal.state)
      : game.state;
    if (signal.seriesCompleted && activeGameState(state)) state = 'completed';
    return state === game.state ? game : { ...game, state };
  });
}

function applyFinality(
  snapshot: LolProviderSnapshot,
  signal: FinalitySignal
): LolProviderSnapshot {
  const selectedSignal = signalForGame(signal, snapshot.game);
  let selectedState = selectedSignal
    ? strongerGameState(snapshot.game.state, selectedSignal.state)
    : snapshot.game.state;
  if (signal.seriesCompleted && activeGameState(selectedState)) selectedState = 'completed';

  const games = applyGameSignals(snapshot.series.games, signal);
  const selectedCompleted = selectedState === 'completed';
  const seriesState = signal.seriesCompleted ? 'completed' : snapshot.series.state;
  if (
    selectedState === snapshot.game.state
    && seriesState === snapshot.series.state
    && games.every((game, index) => game === snapshot.series.games[index])
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    series: {
      ...snapshot.series,
      state: seriesState,
      games
    },
    game: selectedState === snapshot.game.state
      ? snapshot.game
      : { ...snapshot.game, state: selectedState },
    advancing: selectedCompleted ? false : snapshot.advancing
  };
}

function applyScheduleFinality(
  entry: LolProviderScheduleEntry,
  signal: FinalitySignal
): LolProviderScheduleEntry {
  const games = applyGameSignals(entry.series.games, signal);
  const state = signal.seriesCompleted ? 'completed' : entry.series.state;
  if (
    state === entry.series.state
    && games.every((game, index) => game === entry.series.games[index])
  ) {
    return entry;
  }
  return {
    ...entry,
    series: {
      ...entry.series,
      state,
      games
    }
  };
}

function stabilizeCompletedEntry(entry: LolProviderScheduleEntry): LolProviderScheduleEntry {
  const games = entry.series.games.map(game => (
    activeGameState(game.state) ? { ...game, state: 'completed' as const } : game
  ));
  if (
    entry.series.state === 'completed'
    && games.every((game, index) => game === entry.series.games[index])
  ) {
    return entry;
  }
  return {
    ...entry,
    series: {
      ...entry.series,
      state: 'completed',
      games
    }
  };
}

function scheduleCandidatePriority(
  entry: LolProviderScheduleEntry,
  currentTime: number
): number {
  const scheduled = Date.parse(entry.series.scheduledStart);
  const overdue = Number.isFinite(scheduled) && scheduled <= currentTime;
  if (
    overdue
    && (entry.series.state === 'scheduled' || entry.series.state === 'unknown')
  ) {
    return 0;
  }
  if (entry.series.state === 'live' || entry.series.state === 'paused') return 1;
  return 2;
}

function scheduleFinalityCandidates(
  entries: readonly LolProviderScheduleEntry[],
  currentTime: number,
  lookbackMs: number,
  lookaheadMs: number
): readonly LolProviderScheduleEntry[] {
  return entries
    .filter(entry => entry.series.state !== 'completed' && entry.series.state !== 'cancelled')
    .filter(entry => {
      const scheduled = Date.parse(entry.series.scheduledStart);
      return Number.isFinite(scheduled)
        && scheduled >= currentTime - lookbackMs
        && scheduled <= currentTime + lookaheadMs;
    })
    .sort((left, right) => {
      const priority = scheduleCandidatePriority(left, currentTime)
        - scheduleCandidatePriority(right, currentTime);
      if (priority) return priority;
      return Date.parse(left.series.scheduledStart) - Date.parse(right.series.scheduledStart);
    });
}

function circularTake<T>(
  entries: readonly T[],
  offset: number,
  limit: number
): { values: readonly T[]; nextOffset: number } {
  if (!entries.length || limit <= 0) return { values: [], nextOffset: 0 };
  const count = Math.min(entries.length, Math.max(0, limit));
  const start = ((offset % entries.length) + entries.length) % entries.length;
  const values = Array.from({ length: count }, (_, index) => entries[(start + index) % entries.length]!);
  return {
    values,
    nextOffset: (start + count) % entries.length
  };
}

async function requestFinality(
  fetcher: FetchLike,
  apiKey: string,
  seriesId: string
): Promise<FinalitySignal> {
  const url = new URL(`${PERSISTED_BASE}/getEventDetails`);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('id', seriesId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Riot finality probe returned HTTP ${response.status}.`);
    return parseFinality(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export function createRiotFinalityProvider(
  base: LolProviderClient,
  options: RiotFinalityProviderOptions
): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required for finality probes.');
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const finalityProbeMs = options.finalityProbeMs ?? DEFAULT_FINALITY_PROBE_MS;
  const scheduleFinalityLookbackMs = options.scheduleFinalityLookbackMs
    ?? DEFAULT_SCHEDULE_FINALITY_LOOKBACK_MS;
  const scheduleFinalityLookaheadMs = options.scheduleFinalityLookaheadMs
    ?? DEFAULT_SCHEDULE_FINALITY_LOOKAHEAD_MS;
  const scheduleFinalityLimit = options.scheduleFinalityLimit ?? DEFAULT_SCHEDULE_FINALITY_LIMIT;
  const cache = new Map<string, CachedFinalitySignal>();
  const inFlight = new Map<string, Promise<FinalitySignal>>();
  const completedSeries = new Set<string>();
  let overdueScheduleProbeOffset = 0;
  let generalScheduleProbeOffset = 0;

  const finalityFor = async (seriesId: string): Promise<FinalitySignal> => {
    const currentTime = now().getTime();
    const cached = cache.get(seriesId);
    if (cached && cached.expiresAt > currentTime) return cached.value;
    const pending = inFlight.get(seriesId);
    if (pending) return pending;

    const request = requestFinality(fetcher, apiKey, seriesId)
      .then(value => {
        cache.set(seriesId, {
          value,
          expiresAt: now().getTime() + Math.max(0, finalityProbeMs)
        });
        if (value.seriesCompleted) completedSeries.add(seriesId);
        return value;
      })
      .finally(() => {
        if (inFlight.get(seriesId) === request) inFlight.delete(seriesId);
      });
    inFlight.set(seriesId, request);
    return request;
  };

  return {
    id: base.id,
    name: base.name,
    ...(base.sourceUrl ? { sourceUrl: base.sourceUrl } : {}),
    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const entries = await base.getSchedule();
      for (const entry of entries) {
        if (entry.series.state === 'completed') completedSeries.add(entry.series.id);
      }

      const currentTime = now().getTime();
      const pool = scheduleFinalityCandidates(
        entries.filter(entry => !completedSeries.has(entry.series.id)),
        currentTime,
        Math.max(0, scheduleFinalityLookbackMs),
        Math.max(0, scheduleFinalityLookaheadMs)
      );
      const limit = Math.max(0, scheduleFinalityLimit);
      const overdue = pool.filter(entry => scheduleCandidatePriority(entry, currentTime) === 0);
      const general = pool.filter(entry => scheduleCandidatePriority(entry, currentTime) !== 0);
      const overdueSelection = circularTake(overdue, overdueScheduleProbeOffset, limit);
      overdueScheduleProbeOffset = overdueSelection.nextOffset;
      const generalSelection = circularTake(
        general,
        generalScheduleProbeOffset,
        limit - overdueSelection.values.length
      );
      generalScheduleProbeOffset = generalSelection.nextOffset;
      const candidates = [...overdueSelection.values, ...generalSelection.values];

      const signals = new Map<string, FinalitySignal>();
      await Promise.all(candidates.map(async entry => {
        try {
          signals.set(entry.series.id, await finalityFor(entry.series.id));
        } catch {
          // Keep the upstream schedule visible when a bounded finality probe misses.
        }
      }));

      return entries.map(entry => {
        const signal = signals.get(entry.series.id);
        const reconciled = signal ? applyScheduleFinality(entry, signal) : entry;
        if (reconciled.series.state === 'completed') completedSeries.add(entry.series.id);
        return completedSeries.has(entry.series.id)
          ? stabilizeCompletedEntry(reconciled)
          : reconciled;
      });
    },
    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const snapshot = await base.getSnapshot(gameId, after);
      const seriesId = snapshot.series.id;
      if (!seriesId) return snapshot;

      if (snapshot.series.state === 'completed') completedSeries.add(seriesId);
      if (completedSeries.has(seriesId)) {
        return applyFinality(snapshot, { games: [], seriesCompleted: true });
      }
      if (snapshot.game.state === 'completed' || snapshot.advancing === true) return snapshot;

      try {
        return applyFinality(snapshot, await finalityFor(seriesId));
      } catch {
        return snapshot;
      }
    },
    ...(base.getSeriesContext
      ? { getSeriesContext: (seriesId: string) => base.getSeriesContext!(seriesId) }
      : {})
  };
}
