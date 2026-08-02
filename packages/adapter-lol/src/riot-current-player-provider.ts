import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';
import type { LolPlayerState, LolSide, LolStats, LolTeamState } from './types.ts';

const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const REQUEST_TIMEOUT_MS = 5_000;
const FRAME_ALIGNMENT_MS = 1_500;
const DETAIL_CEILING_MS = 10_000;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiotCurrentPlayerProviderOptions {
  fetcher?: FetchLike;
}

interface TimedFrame {
  frame: Json;
  timestampMs: number;
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

function freshestDetailFrame(payloads: readonly unknown[], sourceMs: number): Json | null {
  let selected: TimedFrame | null = null;
  for (const payload of payloads) {
    for (const frame of frames(payload)) {
      const timestampMs = frameTime(frame);
      if (timestampMs === null || timestampMs > sourceMs + DETAIL_CEILING_MS) continue;
      if (!array(frame.participants).length) continue;
      if (!selected || timestampMs > selected.timestampMs) selected = { frame, timestampMs };
    }
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
  return value.map(entry => {
    const item = object(entry);
    return stringValue(entry) ?? firstString(item, ['itemID', 'itemId', 'id']) ?? 'unknown';
  });
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

function mergeInventoryPlayer(player: LolPlayerState, rawValue: Json | undefined): LolPlayerState {
  if (!rawValue) return player;
  const incoming = itemIds(rawValue.items);
  return incoming === null ? player : { ...player, items: incoming };
}

function mergeInventoryTeam(team: LolTeamState, participants: ReadonlyMap<string, Json>): LolTeamState {
  return {
    ...team,
    players: team.players.map(player => mergeInventoryPlayer(player, participants.get(player.id)))
  };
}

function mergeInventories(stats: LolStats, frame: Json): LolStats {
  const participants = new Map(
    array(frame.participants).map((entry, index) => {
      const participant = object(entry);
      return [participantId(participant, index + 1), participant] as const;
    })
  );
  return {
    ...stats,
    blue: mergeInventoryTeam(stats.blue, participants),
    red: mergeInventoryTeam(stats.red, participants)
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

function freshDetailRequests(
  fetcher: FetchLike,
  gameId: string,
  windowRequest: Promise<unknown>
): Promise<readonly unknown[]> {
  return windowRequest.then(async payload => {
    const latest = newestFrame(payload);
    if (!latest) return [];
    const anchors = [...new Set([
      roundedIso(latest.timestampMs),
      roundedIso(latest.timestampMs - 20_000)
    ])];
    return Promise.all(anchors.map(startingTime => (
      requestLive(fetcher, 'details', gameId, startingTime)
    )));
  });
}

export function createRiotCurrentPlayerProvider(
  base: LolProviderClient,
  options: RiotCurrentPlayerProviderOptions = {}
): LolProviderClient {
  const fetcher = options.fetcher ?? fetch;

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const latestWindowRequest = requestLive(fetcher, 'window', gameId);
      const latestDetailsRequest = freshDetailRequests(fetcher, gameId, latestWindowRequest);
      const snapshot = await base.getSnapshot(gameId, after);
      if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;

      const sourceMs = parseTime(snapshot.sourceTimestamp);
      if (sourceMs === null) return snapshot;

      const latestWindow = await latestWindowRequest;
      let frame = alignedFrame(latestWindow, sourceMs);
      if (!frame) {
        const targeted = await requestLive(fetcher, 'window', gameId, roundedIso(sourceMs - 30_000));
        frame = alignedFrame(targeted, sourceMs);
      }

      let stats = frame ? mergeStats(snapshot.stats, frame) : snapshot.stats;
      const detailFrame = freshestDetailFrame(await latestDetailsRequest, sourceMs);
      if (detailFrame) stats = mergeInventories(stats, detailFrame);

      return {
        ...snapshot,
        stats
      };
    }
  };
}
