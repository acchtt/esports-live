import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';
import type { LolPlayerState, LolSide, LolStats, LolTeamState } from './types.ts';

const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const REQUEST_TIMEOUT_MS = 5_000;
const FRAME_ALIGNMENT_MS = 1_500;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiotCurrentPlayerProviderOptions {
  fetcher?: FetchLike;
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

function alignedFrame(value: unknown, sourceMs: number): Json | null {
  let selected: { frame: Json; timestampMs: number } | null = null;
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

function mergePlayer(player: LolPlayerState, rawValue: unknown): LolPlayerState {
  const raw = object(rawValue);
  return {
    ...player,
    level: firstNumber(raw, ['level']) ?? player.level,
    kills: firstNumber(raw, ['kills']) ?? player.kills,
    deaths: firstNumber(raw, ['deaths']) ?? player.deaths,
    assists: firstNumber(raw, ['assists']) ?? player.assists,
    creepScore: firstNumber(raw, ['creepScore', 'cs', 'minionsKilled']) ?? player.creepScore,
    totalGold: firstNumber(raw, ['totalGold', 'totalGoldEarned', 'gold']) ?? player.totalGold
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

async function requestWindow(
  fetcher: FetchLike,
  gameId: string,
  startingTime?: string
): Promise<unknown> {
  const url = new URL(`${LIVE_BASE}/window/${encodeURIComponent(gameId)}`);
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

export function createRiotCurrentPlayerProvider(
  base: LolProviderClient,
  options: RiotCurrentPlayerProviderOptions = {}
): LolProviderClient {
  const fetcher = options.fetcher ?? fetch;

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const latestWindow = requestWindow(fetcher, gameId);
      const snapshot = await base.getSnapshot(gameId, after);
      if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;

      const sourceMs = parseTime(snapshot.sourceTimestamp);
      if (sourceMs === null) return snapshot;

      let frame = alignedFrame(await latestWindow, sourceMs);
      if (!frame) {
        const targeted = await requestWindow(fetcher, gameId, roundedIso(sourceMs - 30_000));
        frame = alignedFrame(targeted, sourceMs);
      }
      if (!frame) return snapshot;

      return {
        ...snapshot,
        stats: mergeStats(snapshot.stats, frame)
      };
    }
  };
}
