import type { GameState } from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderGame,
  LolProviderSnapshot
} from './provider.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const REQUEST_TIMEOUT_MS = 2_500;
const DEFAULT_FINALITY_PROBE_MS = 5_000;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiotFinalityProviderOptions {
  apiKey: string;
  fetcher?: FetchLike;
  now?: () => Date;
  finalityProbeMs?: number;
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
  return GAME_STATE_RANK[incoming] > GAME_STATE_RANK[current] ? incoming : current;
}

function eventFromPayload(value: unknown): Json {
  const root = object(value);
  const data = object(root.data);
  return object(data.event ?? root.event ?? data);
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
  const wins = array(match.teams).map(team => {
    const result = object(object(team).result);
    return Math.max(0, Math.round(numberValue(result.gameWins ?? result.wins) ?? 0));
  });
  const seriesCompleted = reportedState === 'completed'
    || reportedState === 'finished'
    || wins.some(value => value >= winsRequired);

  return { games, seriesCompleted };
}

function signalForGame(signal: FinalitySignal, game: LolProviderGame): GameSignal | null {
  return signal.games.find(candidate => candidate.id === game.id)
    ?? signal.games.find(candidate => candidate.number === game.number)
    ?? null;
}

function applyFinality(
  snapshot: LolProviderSnapshot,
  signal: FinalitySignal
): LolProviderSnapshot {
  const selectedSignal = signalForGame(signal, snapshot.game);
  const selectedState = selectedSignal
    ? strongerGameState(snapshot.game.state, selectedSignal.state)
    : snapshot.game.state;

  const games = snapshot.series.games.map(game => {
    const gameSignal = signalForGame(signal, game);
    if (!gameSignal) return game;
    const state = strongerGameState(game.state, gameSignal.state);
    return state === game.state ? game : { ...game, state };
  });

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
  const cache = new Map<string, CachedFinalitySignal>();
  const inFlight = new Map<string, Promise<FinalitySignal>>();

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
    getSchedule: () => base.getSchedule(),
    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const snapshot = await base.getSnapshot(gameId, after);
      if (
        snapshot.game.state === 'completed'
        || snapshot.advancing === true
        || !snapshot.series.id
      ) {
        return snapshot;
      }

      try {
        return applyFinality(snapshot, await finalityFor(snapshot.series.id));
      } catch {
        return snapshot;
      }
    },
    ...(base.getSeriesContext
      ? { getSeriesContext: (seriesId: string) => base.getSeriesContext!(seriesId) }
      : {})
  };
}
