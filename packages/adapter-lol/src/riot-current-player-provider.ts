import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';
import type { LolPlayerState, LolSide, LolStats, LolTeamState } from './types.ts';

const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const REQUEST_TIMEOUT_MS = 5_000;
const FRAME_ALIGNMENT_MS = 1_500;
const DETAIL_CEILING_MS = 10_000;
const DETAIL_INITIAL_DELAY_MS = 60_000;
const DETAIL_MIN_DELAY_MS = 20_000;
const DETAIL_MAX_DELAY_MS = 180_000;
const DETAIL_STEP_MS = 10_000;
const DETAIL_FALLBACK_GAP_MS = 30_000;
const DETAIL_SUCCESS_STREAK = 6;
const MIN_USABLE_INVENTORY_PLAYERS = 5;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiotCurrentPlayerProviderOptions {
  fetcher?: FetchLike;
}

interface TimedFrame {
  frame: Json;
  timestampMs: number;
}

interface InventoryObservation {
  timestampMs: number;
  items: readonly string[];
}

interface DetailProbeState {
  delayMs: number;
  successStreak: number;
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

function parseTime(value: unknown): number | null {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundedIso(value: number): string {
  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();
}

function frames(value: unknown): readonly Json[] {
  const payload = object(value);
  return array(payload.frames ?? object(payload.window).frames ?? object(payload.data).frames).map(object);
}

function frameTime(frame: Json): number | null {
  return parseTime(firstString(frame, ['rfc460Timestamp', 'timestamp']));
}

function newestFrame(value: unknown): TimedFrame | null {
  let selected: TimedFrame | null = null;
  for (const frame of frames(value)) {
    const timestampMs = frameTime(frame);
    if (timestampMs === null) continue;
    if (!selected || timestampMs > selected.timestampMs) selected = { frame, timestampMs };
  }
  return selected;
}

function alignedFrame(value: unknown, sourceMs: number): Json | null {
  let selected: TimedFrame | null = null;
  for (const frame of frames(value)) {
    const timestampMs = frameTime(frame);
    if (timestampMs === null || Math.abs(timestampMs - sourceMs) > FRAME_ALIGNMENT_MS) continue;
    if (!selected || timestampMs > selected.timestampMs) selected = { frame, timestampMs };
  }
  return selected?.frame ?? null;
}

function frameTeam(frame: Json, side: LolSide): Json {
  const direct = object(frame[side === 'blue' ? 'blueTeam' : 'redTeam']);
  if (Object.keys(direct).length) return direct;
  const expected = side === 'blue' ? '100' : '200';
  return object(array(frame.teams).find(entry => {
    const team = object(entry);
    return String(team.teamID ?? team.teamId ?? team.id ?? '') === expected;
  }));
}

function participantId(value: Json, fallback: number): string {
  return firstString(value, ['participantId', 'participantID', 'id']) ?? String(fallback);
}

function itemIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map(entry => {
      const item = object(entry);
      return stringValue(entry) ?? firstString(item, ['itemID', 'itemId', 'id']) ?? 'unknown';
    })
    .filter(item => item !== '0' && item !== 'unknown');
}

function mergePlayer(player: LolPlayerState, rawValue: unknown): LolPlayerState {
  const raw = object(rawValue);
  return {
    ...player,
    level: firstNumber(raw, ['level']) ?? player.level,
    kills: firstNumber(raw, ['kills']) ?? player.kills,
    deaths: firstNumber(raw, ['deaths']) ?? player.deaths,
    assists: firstNumber(raw, ['assists']) ?? player.assists,
    creepScore: firstNumber(raw, ['creepScore', 'cs', 'minionsKilled']) ?? player.creepScore,
    totalGold: firstNumber(raw, ['totalGold', 'totalGoldEarned', 'gold']) ?? player.totalGold,
    items: itemIds(raw.items) ?? player.items
  };
}

function mergeTeam(team: LolTeamState, frame: Json): LolTeamState {
  const rawPlayers = array(frameTeam(frame, team.side).participants).map(object);
  const byId = new Map(rawPlayers.map((player, index) => [participantId(player, index + 1), player] as const));
  return {
    ...team,
    players: team.players.map((player, index) => mergePlayer(player, byId.get(player.id) ?? rawPlayers[index]))
  };
}

function mergeStats(stats: LolStats, frame: Json): LolStats {
  return {
    ...stats,
    blue: mergeTeam(stats.blue, frame),
    red: mergeTeam(stats.red, frame)
  };
}

function inventoryObservations(value: unknown, ceilingMs: number): Map<string, InventoryObservation> {
  const observations = new Map<string, InventoryObservation>();
  for (const frame of frames(value)) {
    const timestampMs = frameTime(frame);
    if (timestampMs === null || timestampMs > ceilingMs) continue;
    array(frame.participants).forEach((entry, index) => {
      const participant = object(entry);
      const items = itemIds(participant.items);
      if (items === null) return;
      const id = participantId(participant, index + 1);
      const previous = observations.get(id);
      if (!previous || timestampMs >= previous.timestampMs) {
        observations.set(id, { timestampMs, items });
      }
    });
  }
  return observations;
}

function mergeObservationMaps(
  target: Map<string, InventoryObservation>,
  incoming: ReadonlyMap<string, InventoryObservation>
): void {
  for (const [id, observation] of incoming) {
    const previous = target.get(id);
    if (!previous || observation.timestampMs >= previous.timestampMs) target.set(id, observation);
  }
}

function mergeInventoryPlayer(
  player: LolPlayerState,
  observation: InventoryObservation | undefined,
  ceilingMs: number
): LolPlayerState {
  if (!observation || observation.timestampMs > ceilingMs) return player;
  if (!observation.items.length && player.items?.length) return player;
  return { ...player, items: observation.items };
}

function mergeInventoryTeam(
  team: LolTeamState,
  observations: ReadonlyMap<string, InventoryObservation>,
  ceilingMs: number
): LolTeamState {
  return {
    ...team,
    players: team.players.map(player => (
      mergeInventoryPlayer(player, observations.get(player.id), ceilingMs)
    ))
  };
}

function mergeInventories(
  stats: LolStats,
  observations: ReadonlyMap<string, InventoryObservation>,
  ceilingMs: number
): LolStats {
  return {
    ...stats,
    blue: mergeInventoryTeam(stats.blue, observations, ceilingMs),
    red: mergeInventoryTeam(stats.red, observations, ceilingMs)
  };
}

async function requestLive(
  fetcher: FetchLike,
  path: 'window' | 'details',
  gameId: string,
  startingTime?: string
): Promise<unknown> {
  const url = new URL(`${LIVE_BASE}/${path}/${encodeURIComponent(gameId)}`);
  if (startingTime) url.searchParams.set('startingTime', startingTime);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) return null;
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeInventories(
  fetcher: FetchLike,
  gameId: string,
  targetMs: number,
  state: DetailProbeState
): Promise<Map<string, InventoryObservation>> {
  const primaryDelay = state.delayMs;
  const fallbackDelay = Math.min(DETAIL_MAX_DELAY_MS, primaryDelay + DETAIL_FALLBACK_GAP_MS);
  const anchors = [...new Set([
    roundedIso(targetMs - primaryDelay),
    roundedIso(targetMs - fallbackDelay)
  ])];
  const payloads = await Promise.all(anchors.map(startingTime => (
    requestLive(fetcher, 'details', gameId, startingTime)
  )));
  const ceilingMs = targetMs + DETAIL_CEILING_MS;
  const primary = inventoryObservations(payloads[0], ceilingMs);
  const primaryUsable = primary.size >= MIN_USABLE_INVENTORY_PLAYERS;

  if (primaryUsable) {
    state.successStreak += 1;
    if (state.successStreak >= DETAIL_SUCCESS_STREAK) {
      state.delayMs = Math.max(DETAIL_MIN_DELAY_MS, state.delayMs - DETAIL_STEP_MS);
      state.successStreak = 0;
    }
  } else {
    state.delayMs = Math.min(DETAIL_MAX_DELAY_MS, state.delayMs + DETAIL_STEP_MS);
    state.successStreak = 0;
  }

  const combined = new Map<string, InventoryObservation>();
  payloads.forEach(payload => mergeObservationMaps(combined, inventoryObservations(payload, ceilingMs)));
  return combined;
}

export function createRiotCurrentPlayerProvider(
  base: LolProviderClient,
  options: RiotCurrentPlayerProviderOptions = {}
): LolProviderClient {
  const fetcher = options.fetcher ?? fetch;
  const detailProbeStates = new Map<string, DetailProbeState>();
  const inventoryStates = new Map<string, Map<string, InventoryObservation>>();
  const inventoryProbes = new Map<string, Promise<ReadonlyMap<string, InventoryObservation>>>();

  const loadInventories = (
    gameId: string,
    targetMs: number
  ): Promise<ReadonlyMap<string, InventoryObservation>> => {
    const pending = inventoryProbes.get(gameId);
    if (pending) return pending;
    const state = detailProbeStates.get(gameId) ?? {
      delayMs: DETAIL_INITIAL_DELAY_MS,
      successStreak: 0
    };
    detailProbeStates.set(gameId, state);
    const request = probeInventories(fetcher, gameId, targetMs, state)
      .then(incoming => {
        const stored = inventoryStates.get(gameId) ?? new Map<string, InventoryObservation>();
        mergeObservationMaps(stored, incoming);
        inventoryStates.set(gameId, stored);
        return stored;
      })
      .finally(() => {
        if (inventoryProbes.get(gameId) === request) inventoryProbes.delete(gameId);
      });
    inventoryProbes.set(gameId, request);
    return request;
  };

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const latestWindowRequest = requestLive(fetcher, 'window', gameId);
      const latestInventoryRequest = latestWindowRequest.then(payload => {
        const latest = newestFrame(payload);
        return latest ? loadInventories(gameId, latest.timestampMs) : null;
      });
      const snapshot = await base.getSnapshot(gameId, after);
      if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;

      const sourceMs = parseTime(snapshot.sourceTimestamp);
      if (sourceMs === null) return snapshot;

      const latestWindow = await latestWindowRequest;
      const latest = newestFrame(latestWindow);
      let frame = alignedFrame(latestWindow, sourceMs);
      if (!frame) {
        const targeted = await requestLive(fetcher, 'window', gameId, roundedIso(sourceMs - 30_000));
        frame = alignedFrame(targeted, sourceMs);
      }

      let stats = frame ? mergeStats(snapshot.stats, frame) : snapshot.stats;
      const observations = await latestInventoryRequest;
      if (observations && latest) {
        stats = mergeInventories(stats, observations, latest.timestampMs + DETAIL_CEILING_MS);
      }

      return {
        ...snapshot,
        stats
      };
    }
  };
}
