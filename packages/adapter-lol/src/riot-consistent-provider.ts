import type {
  QualityReason,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderSeriesContext,
  LolProviderSnapshot
} from './provider.ts';
import { createRiotLolHistoryProvider } from './riot-history-provider.ts';
import type { RiotLolProviderOptions } from './riot-provider.ts';
import type { LolPlayerState, LolStats, LolTeamState } from './types.ts';

const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const REQUEST_TIMEOUT_MS = 6_000;
const DETAIL_CACHE_MS = 12_000;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface DetailItemsCacheEntry {
  expiresAt: number;
  sourceMs: number;
  items: ReadonlyMap<string, readonly string[]>;
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

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(source: Json, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = stringValue(source[key]);
    if (value) return value;
  }
  return null;
}

function parseTime(value: unknown): number | null {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundedIso(value: number): string {
  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();
}

function sourceMs(snapshot: LolProviderSnapshot): number | null {
  return parseTime(snapshot.sourceTimestamp);
}

function mergePlayer(previous: LolPlayerState | undefined, incoming: LolPlayerState): LolPlayerState {
  if (!previous) return incoming;
  return {
    id: incoming.id || previous.id,
    handle: incoming.handle ?? previous.handle,
    championId: incoming.championId ?? previous.championId,
    role: incoming.role ?? previous.role,
    level: incoming.level ?? previous.level,
    kills: incoming.kills ?? previous.kills,
    deaths: incoming.deaths ?? previous.deaths,
    assists: incoming.assists ?? previous.assists,
    creepScore: incoming.creepScore ?? previous.creepScore,
    totalGold: incoming.totalGold ?? previous.totalGold,
    items: incoming.items ?? previous.items
  };
}

function mergeTeam(previous: LolTeamState, incoming: LolTeamState): LolTeamState {
  const previousPlayers = new Map(previous.players.map(player => [player.id, player]));
  const incomingPlayers = incoming.players.length ? incoming.players : previous.players;
  return {
    id: incoming.id || previous.id,
    name: incoming.name || previous.name,
    side: incoming.side,
    gold: incoming.gold ?? previous.gold,
    kills: incoming.kills ?? previous.kills,
    objectives: {
      towers: incoming.objectives.towers ?? previous.objectives.towers,
      inhibitors: incoming.objectives.inhibitors ?? previous.objectives.inhibitors,
      dragons: incoming.objectives.dragons ?? previous.objectives.dragons,
      barons: incoming.objectives.barons ?? previous.objectives.barons,
      heralds: incoming.objectives.heralds ?? previous.objectives.heralds
    },
    players: incomingPlayers.map(player => mergePlayer(previousPlayers.get(player.id), player))
  };
}

function mergeStats(previous: LolStats, incoming: LolStats): LolStats {
  return {
    gameClockSeconds: incoming.gameClockSeconds ?? previous.gameClockSeconds,
    patch: incoming.patch ?? previous.patch,
    blue: mergeTeam(previous.blue, incoming.blue),
    red: mergeTeam(previous.red, incoming.red)
  };
}

function isRegression(previous: LolProviderSnapshot, incoming: LolProviderSnapshot): boolean {
  if (previous.stats && !incoming.stats) return true;
  const previousSource = sourceMs(previous);
  const incomingSource = sourceMs(incoming);
  if (previousSource !== null && incomingSource !== null && incomingSource < previousSource) return true;

  const previousClock = previous.stats?.gameClockSeconds ?? null;
  const incomingClock = incoming.stats?.gameClockSeconds ?? null;
  return previousClock !== null
    && incomingClock !== null
    && incomingClock + 2 < previousClock;
}

export function mergeMonotonicSnapshot(
  previous: LolProviderSnapshot | undefined,
  incoming: LolProviderSnapshot
): LolProviderSnapshot {
  if (!previous) return incoming;
  if (isRegression(previous, incoming)) {
    return {
      ...previous,
      observedAt: incoming.observedAt,
      advancing: false
    };
  }
  if (!previous.stats || !incoming.stats) return incoming;

  const stats = mergeStats(previous.stats, incoming.stats);
  const reasons = incoming.reasons ?? [];
  return {
    ...incoming,
    stats,
    complete: incoming.complete && reasons.length === 0,
    ...(reasons.length ? { reasons } : {})
  };
}

function participantIds(stats: LolStats): string | null {
  const ids = [...stats.blue.players, ...stats.red.players]
    .map(player => player.id)
    .filter(id => /^\d{1,2}$/.test(id))
    .sort((left, right) => Number(left) - Number(right));
  return ids.length === 10 ? ids.join('_') : null;
}

function itemIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(entry => {
    const item = object(entry);
    return stringValue(entry) ?? firstString(item, ['itemID', 'itemId', 'id']) ?? 'unknown';
  });
}

function frameItems(payload: unknown, ceilingMs: number): { sourceMs: number; items: ReadonlyMap<string, readonly string[]> } | null {
  let selected: { sourceMs: number; items: ReadonlyMap<string, readonly string[]> } | null = null;
  for (const rawFrame of array(object(payload).frames)) {
    const frame = object(rawFrame);
    const timestamp = parseTime(firstString(frame, ['rfc460Timestamp', 'timestamp']));
    if (timestamp === null || timestamp > ceilingMs) continue;
    const entries = new Map<string, readonly string[]>();
    array(frame.participants).forEach((rawParticipant, index) => {
      const participant = object(rawParticipant);
      const id = firstString(participant, ['participantId', 'participantID', 'id']) ?? String(index + 1);
      const items = itemIds(participant.items);
      if (items !== null) entries.set(id, items);
    });
    if (!entries.size) continue;
    if (!selected || timestamp > selected.sourceMs) selected = { sourceMs: timestamp, items: entries };
  }
  return selected;
}

async function requestJson(fetcher: FetchLike, url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (response.status === 204 || response.status === 404) return null;
    const body = await response.text();
    if (!response.ok) return null;
    return body.trim() ? JSON.parse(body) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mergeItems(stats: LolStats, items: ReadonlyMap<string, readonly string[]>): LolStats {
  const merge = (team: LolTeamState): LolTeamState => ({
    ...team,
    players: team.players.map(player => ({
      ...player,
      items: items.get(player.id) ?? player.items
    }))
  });
  return { ...stats, blue: merge(stats.blue), red: merge(stats.red) };
}

function unresolvedItemReasons(stats: LolStats): ReadonlySet<string> {
  const unresolved = new Set<string>();
  for (const team of [stats.blue, stats.red]) {
    team.players.forEach((player, index) => {
      if (player.items === null) unresolved.add(`${team.side}.players.${index}.items`);
    });
  }
  return unresolved;
}

function withResolvedReasons(snapshot: LolProviderSnapshot, stats: LolStats): LolProviderSnapshot {
  const unresolved = unresolvedItemReasons(stats);
  const reasons = (snapshot.reasons ?? []).filter(reason => (
    !reason.field?.endsWith('.items') || unresolved.has(reason.field)
  ));
  return {
    ...snapshot,
    stats,
    complete: reasons.length === 0,
    ...(reasons.length ? { reasons } : {})
  };
}

function winnerCounts(games: readonly SeriesGameHistoryRef[], teams: readonly TeamRef[]): [number, number] {
  return [
    games.filter(game => game.winner?.id === teams[0]?.id).length,
    games.filter(game => game.winner?.id === teams[1]?.id).length
  ];
}

export function reconcileSeriesHistory(history: SeriesHistoryRef): SeriesHistoryRef {
  const teams = [history.score[0].team, history.score[1].team] as const;
  const targetWins = [history.score[0].wins, history.score[1].wins] as const;
  let games = history.games.map(game => ({ ...game }));
  const completed = (): SeriesGameHistoryRef[] => games.filter(game => game.state === 'completed');

  const assign = (gameId: string, team: TeamRef): void => {
    games = games.map(game => game.id === gameId && !game.winner ? { ...game, winner: team } : game);
  };

  const completedGames = completed();
  if (completedGames.length === 1 && targetWins[0] + targetWins[1] === 1) {
    assign(completedGames[0]!.id, targetWins[0] === 1 ? teams[0] : teams[1]);
  }

  if (targetWins[0] === completedGames.length && targetWins[1] === 0) {
    completedGames.forEach(game => assign(game.id, teams[0]));
  }
  if (targetWins[1] === completedGames.length && targetWins[0] === 0) {
    completedGames.forEach(game => assign(game.id, teams[1]));
  }

  const seriesWinnerIndex = targetWins[0] >= history.winsRequired
    ? 0
    : targetWins[1] >= history.winsRequired ? 1 : null;
  if (seriesWinnerIndex !== null) {
    const clincher = [...completed()].sort((left, right) => right.number - left.number)[0];
    if (clincher) assign(clincher.id, teams[seriesWinnerIndex]);
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const unknown = completed().filter(game => !game.winner);
    if (!unknown.length) break;
    const known = winnerCounts(games, teams);
    const remaining = [Math.max(0, targetWins[0] - known[0]), Math.max(0, targetWins[1] - known[1])] as const;
    if (unknown.length === 1) {
      if (remaining[0] === 1 && remaining[1] === 0) assign(unknown[0]!.id, teams[0]);
      if (remaining[1] === 1 && remaining[0] === 0) assign(unknown[0]!.id, teams[1]);
    } else if (remaining[0] === unknown.length && remaining[1] === 0) {
      unknown.forEach(game => assign(game.id, teams[0]));
    } else if (remaining[1] === unknown.length && remaining[0] === 0) {
      unknown.forEach(game => assign(game.id, teams[1]));
    }
  }

  return { ...history, games };
}

export function createRiotLolConsistentProvider(options: RiotLolProviderOptions): LolProviderClient {
  const base = createRiotLolHistoryProvider(options);
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const latestSnapshots = new Map<string, LolProviderSnapshot>();
  const snapshotInFlight = new Map<string, Promise<LolProviderSnapshot>>();
  const detailCache = new Map<string, DetailItemsCacheEntry>();

  const loadItems = async (gameId: string, snapshot: LolProviderSnapshot): Promise<LolProviderSnapshot> => {
    if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;
    if (![...snapshot.stats.blue.players, ...snapshot.stats.red.players].some(player => player.items === null)) {
      return snapshot;
    }

    const ids = participantIds(snapshot.stats);
    const source = parseTime(snapshot.sourceTimestamp);
    if (!ids || source === null) return snapshot;

    const cached = detailCache.get(gameId);
    if (cached && cached.expiresAt > now().getTime() && cached.sourceMs >= source - 15_000) {
      return withResolvedReasons(snapshot, mergeItems(snapshot.stats, cached.items));
    }

    for (const offset of [10_000, 30_000, 60_000]) {
      const url = new URL(`${LIVE_BASE}/details/${encodeURIComponent(gameId)}`);
      url.searchParams.set('startingTime', roundedIso(source - offset));
      url.searchParams.set('participantIds', ids);
      const result = frameItems(await requestJson(fetcher, url), source + 10_000);
      if (!result) continue;
      detailCache.set(gameId, {
        expiresAt: now().getTime() + DETAIL_CACHE_MS,
        sourceMs: result.sourceMs,
        items: result.items
      });
      return withResolvedReasons(snapshot, mergeItems(snapshot.stats, result.items));
    }
    return snapshot;
  };

  const getSnapshot = async (gameId: string, after?: string): Promise<LolProviderSnapshot> => {
    const pending = snapshotInFlight.get(gameId);
    if (pending) return pending;
    const request = base.getSnapshot(gameId, after)
      .then(snapshot => loadItems(gameId, snapshot))
      .then(snapshot => {
        const merged = mergeMonotonicSnapshot(latestSnapshots.get(gameId), snapshot);
        latestSnapshots.set(gameId, merged);
        return merged;
      })
      .finally(() => {
        if (snapshotInFlight.get(gameId) === request) snapshotInFlight.delete(gameId);
      });
    snapshotInFlight.set(gameId, request);
    return request;
  };

  return {
    id: base.id,
    name: base.name,
    ...(base.sourceUrl ? { sourceUrl: base.sourceUrl } : {}),
    getSchedule: () => base.getSchedule(),
    getSnapshot,
    async getSeriesContext(seriesId: string): Promise<LolProviderSeriesContext> {
      const context = await base.getSeriesContext!(seriesId);
      return context.history
        ? { ...context, history: reconcileSeriesHistory(context.history) }
        : context;
    }
  };
}
