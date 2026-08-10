import type {
  GameState,
  QualityReason,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSeries,
  LolProviderSeriesContext,
  LolProviderSnapshot
} from './provider.ts';
import { createRiotLolResolvedProvider } from './riot-resolved-provider.ts';
import type { RiotLolProviderOptions } from './riot-provider.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RECENT_SERIES = 500;
const BASE_CONTEXT_TTL_MS = 5 * 60 * 1_000;
const DETAILS_RETRY_ATTEMPTS = 3;
const DETAILS_RETRY_DELAY_MS = 250;
const GRUB_PHASE_START_SECONDS = 6 * 60;
const GRUB_PHASE_FINAL_SECONDS = 14 * 60 + 30;
const GRUB_REPROBE_SECONDS = 30;
const GRUB_PROBE_SECONDS = [7 * 60, 10 * 60 + 30, 13 * 60 + 30] as const;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Side = 'blue' | 'red';

interface BaseContextCacheEntry {
  expiresAt: number;
  value: LolProviderSeriesContext;
}

interface GrubCounts {
  blue: number | null;
  red: number | null;
}

interface GrubCacheEntry {
  counts: GrubCounts;
  lastProbeClock: number;
  final: boolean;
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

function firstNumber(source: Json, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = numericValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function roundedIso(value: number): string {
  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();
}

function frameTeam(frame: Json, side: Side): Json {
  const direct = object(frame[side === 'blue' ? 'blueTeam' : 'redTeam']);
  if (Object.keys(direct).length) return direct;
  const expected = side === 'blue' ? '100' : '200';
  return object(array(frame.teams).find(value => {
    const team = object(value);
    return String(team.teamID ?? team.teamId ?? team.id ?? '') === expected;
  }));
}

function grubCount(container: Json): number | null {
  const direct = firstNumber(container, ['voidGrubs', 'voidGrubKills', 'grubs', 'hordes', 'hordeKills']);
  if (direct !== null) return direct;

  for (const key of ['horde', 'hordes', 'voidGrub', 'voidGrubs', 'grubs'] as const) {
    const value = container[key];
    if (Array.isArray(value)) return value.length;
    const nested = firstNumber(object(value), ['kills', 'count', 'captures']);
    if (nested !== null) return nested;
  }
  return null;
}

function teamGrubCount(team: Json): number | null {
  const direct = grubCount(team);
  if (direct !== null) return direct;
  for (const key of ['objectives', 'objectiveCounts', 'epicMonsters', 'monsters'] as const) {
    const nested = grubCount(object(team[key]));
    if (nested !== null) return nested;
  }
  return null;
}

function maxCount(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function mergeGrubCounts(left: GrubCounts, right: GrubCounts): GrubCounts {
  return {
    blue: maxCount(left.blue, right.blue),
    red: maxCount(left.red, right.red)
  };
}

function payloadGrubCounts(payload: unknown): GrubCounts {
  let counts: GrubCounts = { blue: null, red: null };
  for (const value of array(object(payload).frames)) {
    const frame = object(value);
    counts = mergeGrubCounts(counts, {
      blue: teamGrubCount(frameTeam(frame, 'blue')),
      red: teamGrubCount(frameTeam(frame, 'red'))
    });
  }
  return counts;
}

function snapshotGrubCounts(snapshot: LolProviderSnapshot): GrubCounts {
  return {
    blue: snapshot.stats?.blue.objectives.grubs ?? null,
    red: snapshot.stats?.red.objectives.grubs ?? null
  };
}

function completeGrubCounts(counts: GrubCounts): boolean {
  return counts.blue !== null && counts.red !== null;
}

function anyGrubCount(counts: GrubCounts): boolean {
  return counts.blue !== null || counts.red !== null;
}

function applyGrubCounts(snapshot: LolProviderSnapshot, counts: GrubCounts): LolProviderSnapshot {
  if (!snapshot.stats) return snapshot;
  const merged = mergeGrubCounts(snapshotGrubCounts(snapshot), counts);
  if (
    merged.blue === snapshot.stats.blue.objectives.grubs
    && merged.red === snapshot.stats.red.objectives.grubs
  ) {
    return snapshot;
  }
  return {
    ...snapshot,
    stats: {
      ...snapshot.stats,
      blue: {
        ...snapshot.stats.blue,
        objectives: { ...snapshot.stats.blue.objectives, grubs: merged.blue }
      },
      red: {
        ...snapshot.stats.red,
        objectives: { ...snapshot.stats.red.objectives, grubs: merged.red }
      }
    }
  };
}

function rawGameState(value: unknown): GameState {
  switch (String(value ?? '').toLowerCase()) {
    case 'inprogress':
    case 'in_progress':
    case 'live': return 'live';
    case 'championselect':
    case 'champion_select':
    case 'draft': return 'draft';
    case 'paused': return 'paused';
    case 'completed':
    case 'finished': return 'completed';
    case 'unstarted':
    case 'scheduled': return 'unstarted';
    default: return 'unknown';
  }
}

function eventFromDetails(payload: unknown): Json {
  const root = object(payload);
  const data = object(root.data);
  return object(data.event ?? root.event ?? data);
}

function durationSeconds(value: unknown): number | null {
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(part => Number(part));
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      const seconds = parts.reduce((total, part) => total * 60 + part, 0);
      return seconds > 0 ? Math.round(seconds) : null;
    }
  }

  const numeric = numericValue(value);
  if (numeric === null || numeric <= 0) return null;
  return Math.round(numeric > 10_000 ? numeric / 1_000 : numeric);
}

function gameDuration(game: Json): number | null {
  const result = object(game.result);
  const metadata = object(game.metadata);
  return durationSeconds(
    game.durationSeconds
      ?? game.gameDurationSeconds
      ?? game.gameDuration
      ?? game.duration
      ?? result.durationSeconds
      ?? result.duration
      ?? metadata.durationSeconds
      ?? metadata.duration
  );
}

function outcomeIsWin(value: unknown): boolean {
  return value === true || String(value ?? '').toLowerCase() === 'win';
}

function gameWinnerId(game: Json): string | null {
  const result = object(game.result);
  const winner = object(game.winner);
  const direct = firstString(game, ['winnerTeamId', 'winningTeamId', 'winnerId'])
    ?? firstString(result, ['winnerTeamId', 'winningTeamId', 'winnerId'])
    ?? firstString(winner, ['id', 'teamId']);
  if (direct) return direct;

  for (const value of array(game.teams)) {
    const team = object(value);
    const teamResult = object(team.result);
    if (
      outcomeIsWin(team.outcome)
      || outcomeIsWin(teamResult.outcome)
      || team.win === true
      || team.winner === true
      || teamResult.win === true
      || teamResult.winner === true
    ) {
      const id = firstString(team, ['id', 'teamId']);
      if (id) return id;
    }
  }
  return null;
}

function matchTeamResolver(series: LolProviderSeries, match: Json) {
  const byRawId = new Map<string, TeamRef>();
  array(match.teams).forEach((value, index) => {
    const id = firstString(object(value), ['id', 'teamId']);
    const normalized = series.teams[index];
    if (id && normalized) byRawId.set(id, normalized);
  });
  for (const team of series.teams) byRawId.set(team.id, team);

  return (rawId: string | null, fallbackIndex?: number): TeamRef | null => {
    if (rawId) {
      const resolved = byRawId.get(rawId);
      if (resolved) return resolved;
    }
    return fallbackIndex === undefined ? null : series.teams[fallbackIndex] ?? null;
  };
}

function gameHistory(
  series: LolProviderSeries,
  match: Json,
  rawGame: Json,
  fallbackIndex: number
): SeriesGameHistoryRef {
  const number = firstNumber(rawGame, ['number', 'gameNumber']) ?? fallbackIndex + 1;
  const rawId = firstString(rawGame, ['id', 'gameId']);
  const normalizedGame = series.games.find(game => game.id === rawId || game.number === number);
  const resolveTeam = matchTeamResolver(series, match);
  const rawTeams = array(rawGame.teams).map(object);
  let blueTeam: TeamRef | null = null;
  let redTeam: TeamRef | null = null;

  rawTeams.forEach((team, index) => {
    const side = String(team.side ?? '').toLowerCase();
    const resolved = resolveTeam(firstString(team, ['id', 'teamId']), index);
    if (side === 'blue') blueTeam = resolved;
    if (side === 'red') redTeam = resolved;
  });

  const parsedState = rawGameState(rawGame.state);
  const state = parsedState === 'unknown' ? normalizedGame?.state ?? 'unknown' : parsedState;
  const winnerId = gameWinnerId(rawGame);

  return {
    id: rawId ?? normalizedGame?.id ?? `game-${fallbackIndex + 1}`,
    number: normalizedGame?.number ?? number,
    state,
    blueTeam,
    redTeam,
    winner: resolveTeam(winnerId),
    durationSeconds: gameDuration(rawGame)
  };
}

function fallbackGameHistory(series: LolProviderSeries): readonly SeriesGameHistoryRef[] {
  return series.games.map(game => ({
    ...game,
    blueTeam: null,
    redTeam: null,
    winner: null,
    durationSeconds: null
  }));
}

function scoreWins(matchTeam: Json): number | null {
  return firstNumber(object(matchTeam.result), ['gameWins', 'wins']);
}

export function parseRiotSeriesHistory(
  series: LolProviderSeries,
  detailsPayload: unknown
): SeriesHistoryRef {
  const event = eventFromDetails(detailsPayload);
  const match = object(event.match);
  const rawGames = array(match.games).map(object);
  const games = (rawGames.length
    ? rawGames.map((game, index) => gameHistory(series, match, game, index))
    : fallbackGameHistory(series))
    .slice()
    .sort((left, right) => left.number - right.number);

  const rawBestOf = firstNumber(object(match.strategy), ['count', 'bestOf']);
  const bestOf = rawBestOf && rawBestOf > 0 ? Math.round(rawBestOf) : Math.max(1, series.bestOf);
  const rawMatchTeams = array(match.teams).map(object);
  const countedWins = series.teams.map(team => games.filter(game => game.winner?.id === team.id).length);
  const leftWins = scoreWins(rawMatchTeams[0] ?? {}) ?? countedWins[0] ?? 0;
  const rightWins = scoreWins(rawMatchTeams[1] ?? {}) ?? countedWins[1] ?? 0;

  return {
    bestOf,
    winsRequired: Math.floor(bestOf / 2) + 1,
    drawPossible: bestOf % 2 === 0,
    score: [
      { team: series.teams[0], wins: Math.max(0, leftWins) },
      { team: series.teams[1], wins: Math.max(0, rightWins) }
    ],
    games
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestJson(fetcher: FetchLike, url: URL, apiKey: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      cache: 'no-store',
      signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Riot upstream returned HTTP ${response.status}.`);
    return body.trim() ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timer);
  }
}

export function createRiotGrubsRecovery(fetcher: FetchLike, apiKey: string) {
  const cache = new Map<string, GrubCacheEntry>();

  return async (gameId: string, snapshot: LolProviderSnapshot): Promise<LolProviderSnapshot> => {
    if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;

    const direct = snapshotGrubCounts(snapshot);
    const clock = snapshot.stats.gameClockSeconds;
    const source = Date.parse(snapshot.sourceTimestamp);
    if (completeGrubCounts(direct)) {
      cache.set(gameId, {
        counts: direct,
        lastProbeClock: clock ?? 0,
        final: (clock ?? 0) >= GRUB_PHASE_FINAL_SECONDS
      });
      return snapshot;
    }
    if (clock === null || !Number.isFinite(source) || clock < GRUB_PHASE_START_SECONDS) return snapshot;

    const cached = cache.get(gameId);
    if (cached?.final) return applyGrubCounts(snapshot, cached.counts);
    if (cached && clock - cached.lastProbeClock < GRUB_REPROBE_SECONDS) {
      return applyGrubCounts(snapshot, cached.counts);
    }

    const gameStart = source - clock * 1_000;
    const latestProbe = Math.min(clock - 10, GRUB_PHASE_FINAL_SECONDS);
    const probeSeconds = [...new Set(
      [...GRUB_PROBE_SECONDS, latestProbe]
        .filter(seconds => seconds >= GRUB_PHASE_START_SECONDS && seconds <= latestProbe)
        .map(seconds => Math.floor(seconds / 10) * 10)
    )];

    const payloads = await Promise.all(probeSeconds.map(async seconds => {
      const url = new URL(`${LIVE_BASE}/window/${encodeURIComponent(gameId)}`);
      url.searchParams.set('startingTime', roundedIso(gameStart + seconds * 1_000));
      return requestJson(fetcher, url, apiKey).catch(() => null);
    }));

    let recovered = cached?.counts ?? { blue: null, red: null };
    recovered = mergeGrubCounts(recovered, direct);
    for (const payload of payloads) recovered = mergeGrubCounts(recovered, payloadGrubCounts(payload));

    cache.set(gameId, {
      counts: recovered,
      lastProbeClock: clock,
      final: clock >= GRUB_PHASE_FINAL_SECONDS && anyGrubCount(recovered)
    });
    return applyGrubCounts(snapshot, recovered);
  };
}

export function createRiotLolHistoryProvider(options: RiotLolProviderOptions): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const resolved = createRiotLolResolvedProvider({ ...options, fetcher });
  const recoverGrubs = createRiotGrubsRecovery(fetcher, apiKey);
  const recentSeries = new Map<string, LolProviderSeries>();
  const baseContextCache = new Map<string, BaseContextCacheEntry>();
  const baseContextInFlight = new Map<string, Promise<LolProviderSeriesContext>>();

  const remember = (entries: readonly LolProviderScheduleEntry[]): void => {
    if (recentSeries.size + entries.length > MAX_RECENT_SERIES) recentSeries.clear();
    for (const entry of entries) recentSeries.set(entry.series.id, entry.series);
  };

  const getSchedule = async (): Promise<readonly LolProviderScheduleEntry[]> => {
    const entries = await resolved.getSchedule();
    remember(entries);
    return entries;
  };

  const loadBaseContext = async (seriesId: string): Promise<LolProviderSeriesContext> => {
    const cached = baseContextCache.get(seriesId);
    if (cached && cached.expiresAt > now().getTime()) return cached.value;
    const pending = baseContextInFlight.get(seriesId);
    if (pending) return pending;

    const request = resolved.getSeriesContext!(seriesId)
      .then(value => {
        baseContextCache.set(seriesId, {
          value,
          expiresAt: now().getTime() + BASE_CONTEXT_TTL_MS
        });
        return value;
      })
      .finally(() => {
        if (baseContextInFlight.get(seriesId) === request) baseContextInFlight.delete(seriesId);
      });
    baseContextInFlight.set(seriesId, request);
    return request;
  };

  const details = async (seriesId: string): Promise<unknown> => {
    const url = new URL(`${PERSISTED_BASE}/getEventDetails`);
    url.searchParams.set('hl', locale);
    url.searchParams.set('id', seriesId);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= DETAILS_RETRY_ATTEMPTS; attempt += 1) {
      try {
        return await requestJson(fetcher, url, apiKey);
      } catch (error) {
        lastError = error;
        if (attempt < DETAILS_RETRY_ATTEMPTS) {
          await delay(DETAILS_RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Riot event details are unavailable.');
  };

  return {
    id: resolved.id,
    name: resolved.name,
    ...(resolved.sourceUrl ? { sourceUrl: resolved.sourceUrl } : {}),
    getSchedule,
    getSnapshot: async (gameId: string, after?: string) => (
      recoverGrubs(gameId, await resolved.getSnapshot(gameId, after))
    ),

    async getSeriesContext(seriesId: string): Promise<LolProviderSeriesContext> {
      let series = recentSeries.get(seriesId);
      if (!series) {
        await getSchedule();
        series = recentSeries.get(seriesId);
      }

      const context = await loadBaseContext(seriesId);
      const observedAt = now().toISOString();
      if (!series) return { ...context, observedAt };

      try {
        const detailsPayload = await details(seriesId);
        return {
          ...context,
          observedAt,
          history: parseRiotSeriesHistory(series, detailsPayload)
        };
      } catch (error) {
        const reason: QualityReason = {
          code: 'game_history_unavailable',
          message: error instanceof Error ? error.message : 'Riot game history is unavailable.'
        };
        return {
          ...context,
          observedAt,
          reasons: [...(context.reasons ?? []), reason]
        };
      }
    }
  };
}
