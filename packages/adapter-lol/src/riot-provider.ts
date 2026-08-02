import type {
  CompetitionRef,
  GameState,
  QualityReason,
  SeriesState,
  TeamRef
} from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderGame,
  LolProviderScheduleEntry,
  LolProviderSeries,
  LolProviderSnapshot
} from './provider.ts';
import type { LolPlayerState, LolSide, LolStats, LolTeamState } from './types.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const REQUEST_TIMEOUT_MS = 8_000;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiotLolProviderOptions {
  apiKey: string;
  fetcher?: FetchLike;
  locale?: string;
  now?: () => Date;
  includeDetails?: boolean;
  useDetailItemFallback?: boolean;
}

interface Candidate {
  payload: Json;
  frame: Json;
  timestamp: string;
  timestampMs: number;
  gameplay: boolean;
}

interface TimedFrame {
  frame: Json;
  timestamp: string;
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

function objectiveCount(source: Json, keys: readonly string[], nestedKeys: readonly string[] = keys): number | null {
  const direct = firstNumber(source, keys);
  if (direct !== null) return direct;

  const objectives = object(source.objectives);
  const nested = firstNumber(objectives, nestedKeys);
  if (nested !== null) return nested;

  for (const key of nestedKeys) {
    const objective = objectives[key];
    if (Array.isArray(objective)) return objective.length;
    const count = firstNumber(object(objective), ['kills', 'count', 'captures']);
    if (count !== null) return count;
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

export function riotWindowProbeTimes(nowMs: number, after?: string): readonly (string | null)[] {
  const afterMs = parseTime(after);
  const candidates = afterMs === null
    ? [nowMs - 20_000, nowMs - 60_000, nowMs - 120_000, nowMs - 240_000, nowMs - 360_000]
    : [afterMs + 10_000, afterMs + 20_000, nowMs - 20_000, nowMs - 60_000, nowMs - 240_000];
  const anchors = candidates
    .filter(value => value <= nowMs + 15_000 && (afterMs === null || value > afterMs))
    .map(roundedIso);
  return [null, ...new Set(anchors)].slice(0, 6);
}

function seriesState(value: unknown): SeriesState {
  switch (String(value ?? '').toLowerCase()) {
    case 'unstarted':
    case 'scheduled': return 'scheduled';
    case 'inprogress':
    case 'live': return 'live';
    case 'paused': return 'paused';
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    default: return 'unknown';
  }
}

function inferredSeriesState(event: Json, match: Json): SeriesState {
  const reported = seriesState(event.state ?? match.state);
  if (reported !== 'scheduled' && reported !== 'completed') return reported;

  const strategy = object(match.strategy);
  const bestOf = firstNumber(strategy, ['count']) ?? 1;
  const winsRequired = Math.floor(bestOf / 2) + 1;
  const results = array(match.teams).map(team => object(object(team).result));
  const wins = results.map(result => firstNumber(result, ['gameWins', 'wins']) ?? 0);
  const hasFinalOutcome = results.some(result => stringValue(result.outcome) !== null);
  const hasPartialScore = wins.some(value => value > 0) && wins.every(value => value < winsRequired);

  // Riot can leave an active series marked unstarted (or briefly completed)
  // between games. A non-clinching score without a final outcome is the more
  // reliable live signal used by the public LoL Esports schedule clients.
  return hasPartialScore && !hasFinalOutcome ? 'live' : reported;
}

function gameState(value: unknown): GameState {
  switch (String(value ?? '').toLowerCase()) {
    case 'unstarted': return 'unstarted';
    case 'draft':
    case 'championselect': return 'draft';
    case 'inprogress':
    case 'live': return 'live';
    case 'paused': return 'paused';
    case 'completed': return 'completed';
    default: return 'unknown';
  }
}

function teamRef(value: unknown, fallbackId: string, fallbackName: string): TeamRef {
  const team = object(value);
  const code = firstString(team, ['code', 'acronym']);
  const imageUrl = firstString(team, ['image', 'imageUrl', 'logo']);
  return {
    id: firstString(team, ['id', 'teamId']) ?? fallbackId,
    name: firstString(team, ['name', 'code']) ?? fallbackName,
    ...(code ? { code } : {}),
    ...(imageUrl ? { imageUrl } : {})
  };
}

function competition(event: Json): CompetitionRef {
  const league = object(event.league);
  const tournament = object(event.tournament);
  const region = firstString(league, ['region']) ?? firstString(tournament, ['region']);
  const stage = firstString(event, ['blockName', 'stage']) ?? firstString(tournament, ['stage']);
  return {
    id: firstString(league, ['id', 'slug'])
      ?? firstString(tournament, ['id', 'slug'])
      ?? 'unknown-competition',
    name: firstString(league, ['name', 'slug'])
      ?? firstString(tournament, ['name', 'slug'])
      ?? 'Unknown competition',
    ...(region ? { region } : {}),
    ...(stage ? { stage } : {})
  };
}

function gameRef(value: unknown, fallbackNumber: number): LolProviderGame | null {
  const game = object(value);
  const id = firstString(game, ['id', 'gameId']);
  return id ? {
    id,
    number: firstNumber(game, ['number', 'gameNumber']) ?? fallbackNumber,
    state: gameState(game.state)
  } : null;
}

export function normalizeRiotSeries(
  value: unknown,
  observedAt: string,
  fallbackGameId?: string
): LolProviderSeries {
  const event = object(value);
  const match = object(event.match);
  const teams = array(match.teams);
  const games = array(match.games)
    .map((entry, index) => gameRef(entry, index + 1))
    .filter((entry): entry is LolProviderGame => entry !== null);
  if (fallbackGameId && !games.some(game => game.id === fallbackGameId)) {
    games.push({ id: fallbackGameId, number: games.length + 1, state: 'live' });
  }
  const strategy = object(match.strategy);
  return {
    id: firstString(match, ['id'])
      ?? firstString(event, ['id'])
      ?? `unknown-series-${fallbackGameId ?? 'schedule'}`,
    competition: competition(event),
    teams: [teamRef(teams[0], 'team-1', 'Team 1'), teamRef(teams[1], 'team-2', 'Team 2')],
    bestOf: firstNumber(strategy, ['count']) ?? Math.max(games.length, 1),
    state: inferredSeriesState(event, match),
    scheduledStart: firstString(event, ['startTime', 'scheduledStart']) ?? observedAt,
    games
  };
}

function frames(value: unknown): readonly Json[] {
  const payload = object(value);
  return array(payload.frames ?? object(payload.window).frames ?? object(payload.data).frames).map(object);
}

function schedulePayload(value: unknown): Json {
  const payload = object(value);
  return object(object(payload.data).schedule ?? payload.schedule);
}

function scheduleEvents(value: unknown): readonly Json[] {
  return array(schedulePayload(value).events).map(object);
}

function olderScheduleToken(value: unknown): string | null {
  return firstString(object(schedulePayload(value).pages), ['older']);
}

function frameTime(frame: Json): string | null {
  const value = firstString(frame, ['rfc460Timestamp', 'timestamp']);
  return value && parseTime(value) !== null ? value : null;
}

function newestTimedFrame(value: unknown, ceilingMs = Number.POSITIVE_INFINITY): TimedFrame | null {
  let selected: TimedFrame | null = null;
  for (const frame of frames(value)) {
    const timestamp = frameTime(frame);
    const timestampMs = timestamp ? parseTime(timestamp) : null;
    if (!timestamp || timestampMs === null || timestampMs > ceilingMs) continue;
    if (!selected || timestampMs > selected.timestampMs) {
      selected = { frame, timestamp, timestampMs };
    }
  }
  return selected;
}

function earliestFrameTime(value: unknown): number | null {
  let earliest: number | null = null;
  for (const frame of frames(value)) {
    const timestamp = frameTime(frame);
    const timestampMs = timestamp ? parseTime(timestamp) : null;
    if (timestampMs === null) continue;
    if (earliest === null || timestampMs < earliest) earliest = timestampMs;
  }
  return earliest;
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

function hasGameplay(frame: Json): boolean {
  const blue = frameTeam(frame, 'blue');
  const red = frameTeam(frame, 'red');
  const players = [...array(blue.participants), ...array(red.participants)].map(object);
  const gold = (firstNumber(blue, ['totalGold', 'gold']) ?? 0)
    + (firstNumber(red, ['totalGold', 'gold']) ?? 0);
  const cs = players.reduce((sum, player) => sum + (firstNumber(player, ['creepScore', 'cs']) ?? 0), 0);
  const level = players.reduce((highest, player) => Math.max(highest, firstNumber(player, ['level']) ?? 0), 0);
  const kills = (firstNumber(blue, ['totalKills', 'kills']) ?? 0)
    + (firstNumber(red, ['totalKills', 'kills']) ?? 0);
  return gold > 5_000 || cs > 0 || level > 1 || kills > 0;
}

function alignWindowCandidate(candidate: Candidate, detail: TimedFrame): Candidate {
  const aligned = newestTimedFrame(candidate.payload, detail.timestampMs + 1_000);
  if (!aligned || Math.abs(aligned.timestampMs - detail.timestampMs) > 15_000) return candidate;
  return {
    ...candidate,
    frame: aligned.frame,
    timestamp: aligned.timestamp,
    timestampMs: aligned.timestampMs,
    gameplay: hasGameplay(aligned.frame)
  };
}

function windowCandidate(value: unknown): Candidate | null {
  const payload = object(value);
  let selected: Candidate | null = null;
  for (const frame of frames(payload)) {
    const timestamp = frameTime(frame);
    const time = timestamp ? parseTime(timestamp) : null;
    if (!timestamp || time === null) continue;
    if (!selected || time > selected.timestampMs) {
      selected = { payload, frame, timestamp, timestampMs: time, gameplay: hasGameplay(frame) };
    }
  }
  return selected;
}

function newest(candidates: readonly Candidate[]): Candidate | null {
  const gameplay = candidates.filter(candidate => candidate.gameplay);
  const source = gameplay.length ? gameplay : candidates;
  return [...source].sort((a, b) => b.timestampMs - a.timestampMs)[0] ?? null;
}

function participantId(value: Json, fallback: number): string {
  return firstString(value, ['participantId', 'participantID', 'id']) ?? String(fallback);
}

function participantMap(value: unknown, metadata = false): Map<string, Json> {
  const payload = object(value);
  const directParticipants = array(payload.participants);
  const source = metadata
    ? array(payload.participantMetadata)
    : directParticipants.length ? directParticipants : array(newestTimedFrame(value)?.frame.participants);
  return new Map(source.map((entry, index) => {
    const participant = object(entry);
    return [participantId(participant, index + 1), participant] as const;
  }));
}

function items(value: unknown): readonly string[] | null {
  return Array.isArray(value) ? value.map(entry => {
    const item = object(entry);
    return stringValue(entry) ?? firstString(item, ['itemID', 'itemId', 'id']) ?? 'unknown';
  }) : null;
}

function dragons(value: unknown): readonly string[] | null {
  return Array.isArray(value) ? value.map(entry => {
    const dragon = object(entry);
    return stringValue(entry) ?? firstString(dragon, ['name', 'type', 'dragonType']) ?? 'unknown';
  }) : null;
}

function playerState(
  value: unknown,
  index: number,
  metadata: Map<string, Json>,
  details: Map<string, Json>
): LolPlayerState {
  const raw = object(value);
  const id = participantId(raw, index + 1);
  const meta = metadata.get(id) ?? {};
  const detail = details.get(id) ?? {};
  return {
    id,
    handle: firstString(meta, ['summonerName', 'name']) ?? firstString(raw, ['summonerName', 'name']),
    championId: firstString(meta, ['championId', 'championName']) ?? firstString(raw, ['championId', 'championName']),
    role: firstString(meta, ['role']) ?? firstString(raw, ['role']),
    level: firstNumber(detail, ['level']) ?? firstNumber(raw, ['level']),
    kills: firstNumber(detail, ['kills']) ?? firstNumber(raw, ['kills']),
    deaths: firstNumber(detail, ['deaths']) ?? firstNumber(raw, ['deaths']),
    assists: firstNumber(detail, ['assists']) ?? firstNumber(raw, ['assists']),
    creepScore: firstNumber(detail, ['creepScore', 'cs', 'minionsKilled'])
      ?? firstNumber(raw, ['creepScore', 'cs', 'minionsKilled']),
    totalGold: firstNumber(detail, ['totalGold', 'totalGoldEarned', 'gold'])
      ?? firstNumber(raw, ['totalGold', 'totalGoldEarned', 'gold']),
    items: items(detail.items)
  };
}

function eventGame(event: Json, gameId: string): Json {
  return object(array(object(event.match).games).find(entry => (
    firstString(object(entry), ['id', 'gameId']) === gameId
  )));
}

function teamForSide(
  event: Json,
  series: LolProviderSeries,
  gameId: string,
  side: LolSide,
  metadataTeamId: string | null
): TeamRef {
  if (metadataTeamId) {
    const exact = series.teams.find(team => team.id === metadataTeamId);
    if (exact) return exact;
  }
  const sideTeam = array(eventGame(event, gameId).teams).map(object).find(team => (
    String(team.side ?? '').toLowerCase() === side
  ));
  const id = sideTeam ? firstString(sideTeam, ['id', 'teamId']) : null;
  return series.teams.find(team => team.id === id) ?? series.teams[side === 'blue' ? 0 : 1];
}

function teamState(
  side: LolSide,
  frame: Json,
  metadata: Json,
  details: Map<string, Json>,
  info: TeamRef
): LolTeamState {
  const raw = frameTeam(frame, side);
  const meta = participantMap(metadata, true);
  return {
    id: info.id,
    name: info.name,
    side,
    gold: firstNumber(raw, ['totalGold', 'gold']),
    kills: firstNumber(raw, ['totalKills', 'kills']),
    objectives: {
      towers: firstNumber(raw, ['towers', 'towerKills', 'turretsDestroyed']),
      inhibitors: firstNumber(raw, ['inhibitors', 'inhibitorKills']),
      dragons: dragons(raw.dragons),
      barons: firstNumber(raw, ['barons', 'baronKills']),
      heralds: firstNumber(raw, ['heralds', 'riftHeraldKills']),
      grubs: objectiveCount(
        raw,
        ['voidGrubs', 'voidGrubKills', 'grubs', 'hordes', 'hordeKills'],
        ['horde', 'hordes', 'voidGrub', 'voidGrubs', 'grubs']
      )
    },
    players: array(raw.participants).map((entry, index) => playerState(entry, index, meta, details))
  };
}

function startTime(event: Json, gameId: string, metadata: Json): number | null {
  const direct = parseTime(metadata.gameStartTime ?? metadata.startTime);
  if (direct !== null) return direct;
  for (const entry of array(eventGame(event, gameId).vods)) {
    const vod = object(entry);
    const first = parseTime(vod.firstFrameTime);
    const offset = firstNumber(vod, ['startMillis']);
    if (first !== null && offset !== null) return first + offset;
  }
  return null;
}

function gameClock(
  frame: Json,
  event: Json,
  gameId: string,
  metadata: Json,
  sourceMs: number,
  openingFrameMs: number | null
): number | null {
  const direct = firstNumber(frame, ['gameClockSeconds', 'gameTimeSeconds', 'gameTime']);
  if (direct !== null) return Math.max(0, Math.round(direct));
  const start = startTime(event, gameId, metadata) ?? openingFrameMs;
  return start !== null && sourceMs >= start ? Math.round((sourceMs - start) / 1000) : null;
}

function completenessReasons(stats: LolStats): QualityReason[] {
  const reasons: QualityReason[] = [];
  const require = (value: unknown, field: string): void => {
    if (value === null || value === undefined || value === '') {
      reasons.push({ code: 'missing_field', message: `Missing betting-critical field: ${field}.`, field });
    }
  };
  require(stats.gameClockSeconds, 'gameClockSeconds');
  for (const team of [stats.blue, stats.red]) {
    require(team.id, `${team.side}.id`);
    require(team.gold, `${team.side}.gold`);
    require(team.kills, `${team.side}.kills`);
    require(team.objectives.towers, `${team.side}.objectives.towers`);
    require(team.objectives.inhibitors, `${team.side}.objectives.inhibitors`);
    require(team.objectives.dragons, `${team.side}.objectives.dragons`);
    require(team.objectives.barons, `${team.side}.objectives.barons`);
    require(team.objectives.heralds, `${team.side}.objectives.heralds`);
    if (team.players.length !== 5) {
      reasons.push({ code: 'player_count_invalid', message: `${team.side} side does not have 5 players.`, field: `${team.side}.players` });
    }
    team.players.forEach((player, index) => {
      require(player.handle, `${team.side}.players.${index}.handle`);
      require(player.championId, `${team.side}.players.${index}.championId`);
      require(player.role, `${team.side}.players.${index}.role`);
      require(player.level, `${team.side}.players.${index}.level`);
      require(player.kills, `${team.side}.players.${index}.kills`);
      require(player.deaths, `${team.side}.players.${index}.deaths`);
      require(player.assists, `${team.side}.players.${index}.assists`);
      require(player.creepScore, `${team.side}.players.${index}.creepScore`);
      require(player.totalGold, `${team.side}.players.${index}.totalGold`);
      require(player.items, `${team.side}.players.${index}.items`);
    });
  }
  return reasons;
}

async function requestJson(fetcher: FetchLike, url: URL, init: RequestInit, tolerateMiss = false): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const body = await response.text();
    if (response.status === 204) return null;
    if (!response.ok) {
      if (tolerateMiss && response.status === 404) return null;
      throw new Error(`Riot upstream returned HTTP ${response.status}.`);
    }
    return body.trim() ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timer);
  }
}

export function createRiotLolProvider(options: RiotLolProviderOptions): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const includeDetails = options.includeDetails ?? true;
  const gameStartTimes = new Map<string, number>();
  const eventDetailsCache = new Map<string, Promise<Json>>();

  const persisted = async (path: string, params: Record<string, string | string[] | undefined>): Promise<unknown> => {
    const url = new URL(`${PERSISTED_BASE}/${path}`);
    url.searchParams.set('hl', locale);
    for (const [name, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(name, item));
      else if (typeof value === 'string' && value) url.searchParams.set(name, value);
    }
    return requestJson(fetcher, url, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      cache: 'no-store'
    });
  };

  const live = async (path: string, params: Record<string, string | undefined>): Promise<unknown> => {
    const url = new URL(`${LIVE_BASE}/${path}`);
    for (const [name, value] of Object.entries(params)) {
      if (value) url.searchParams.set(name, value);
    }
    return requestJson(fetcher, url, { headers: { Accept: 'application/json' }, cache: 'no-store' }, true);
  };

  const bestWindow = async (gameId: string, after?: string): Promise<Candidate | null> => {
    const observedMs = now().getTime();
    const openingPayload = await live(`window/${encodeURIComponent(gameId)}`, {});
    const openingTime = earliestFrameTime(openingPayload);
    if (openingTime !== null) {
      const previous = gameStartTimes.get(gameId);
      if (previous === undefined || openingTime < previous) gameStartTimes.set(gameId, openingTime);
    }
    const first = windowCandidate(openingPayload);
    const afterMs = parseTime(after);
    if (first?.gameplay && observedMs - first.timestampMs <= 30_000 && (afterMs === null || first.timestampMs > afterMs)) {
      return first;
    }
    const candidates = first ? [first] : [];
    const probes = riotWindowProbeTimes(observedMs, after).slice(1);
    const results = await Promise.all(probes.map(startingTime => (
      live(`window/${encodeURIComponent(gameId)}`, { startingTime: startingTime ?? undefined })
        .then(windowCandidate)
        .catch(() => null)
    )));
    candidates.push(...results.filter((candidate): candidate is Candidate => candidate !== null));
    return newest(candidates);
  };

  const details = async (gameId: string, timestamp: string): Promise<TimedFrame | null> => {
    const sourceMs = parseTime(timestamp);
    if (sourceMs === null) return null;
    const anchors = [...new Set([
      roundedIso(sourceMs - 60_000),
      roundedIso(sourceMs - 30_000),
      roundedIso(sourceMs - 90_000),
      roundedIso(sourceMs),
      roundedIso(sourceMs - 10_000),
      roundedIso(sourceMs - 120_000)
    ])];

    const primary = await live(`details/${encodeURIComponent(gameId)}`, {
      startingTime: anchors[0]
    }).catch(() => null);
    const primaryFrame = newestTimedFrame(primary, sourceMs + 10_000);
    if (primaryFrame) return primaryFrame;

    const results = await Promise.all(anchors.slice(1).map(startingTime => (
      live(`details/${encodeURIComponent(gameId)}`, { startingTime }).catch(() => null)
    )));
    return results
      .map(result => newestTimedFrame(result, sourceMs + 10_000))
      .filter((entry): entry is TimedFrame => entry !== null)
      .sort((left, right) => right.timestampMs - left.timestampMs)[0] ?? null;
  };

  const eventDetails = (matchId: string | null): Promise<Json> => {
    if (!matchId) return Promise.resolve({});
    const cached = eventDetailsCache.get(matchId);
    if (cached) return cached;
    const request = persisted('getEventDetails', { id: matchId })
      .then(payloadValue => {
        const payload = object(payloadValue);
        const data = object(payload.data);
        return object(data.event ?? payload.event ?? data);
      })
      .catch(error => {
        eventDetailsCache.delete(matchId);
        throw error;
      });
    eventDetailsCache.set(matchId, request);
    return request;
  };

  return {
    id: 'riot-lolesports-web',
    name: 'Riot LoL Esports web feed',
    sourceUrl: 'https://lolesports.com',

    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const observedAt = now().toISOString();
      const payload = await persisted('getSchedule', {});
      const olderToken = olderScheduleToken(payload);
      const olderPayload = olderToken
        ? await persisted('getSchedule', { pageToken: olderToken }).catch(() => null)
        : null;
      const entries = [...scheduleEvents(payload), ...scheduleEvents(olderPayload)]
        .map(event => ({ series: normalizeRiotSeries(event, observedAt), observedAt }));
      const seen = new Set<string>();
      return entries.filter(entry => {
        if (seen.has(entry.series.id)) return false;
        seen.add(entry.series.id);
        return true;
      });
    },

    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const observedAt = now().toISOString();
      const candidate = await bestWindow(gameId, after);
      if (!candidate) {
        const series = normalizeRiotSeries({}, observedAt, gameId);
        return {
          series,
          game: series.games[0]!,
          sourceTimestamp: null,
          observedAt,
          advancing: null,
          complete: false,
          stats: null,
          reasons: [{ code: 'telemetry_unavailable', message: 'Riot returned no valid telemetry frame.' }]
        };
      }

      const candidateMetadata = object(candidate.payload.gameMetadata ?? candidate.frame.gameMetadata);
      const matchId = firstString(candidate.payload, ['esportsMatchId'])
        ?? firstString(candidateMetadata, ['esportsMatchId']);
      const detailRequest: Promise<TimedFrame | null> = includeDetails && candidate.gameplay
        ? details(gameId, candidate.timestamp)
        : Promise.resolve(null);
      const eventRequest = eventDetails(matchId).catch(() => ({}));
      const [detail, event] = await Promise.all([detailRequest, eventRequest]);
      const effectiveCandidate = detail ? alignWindowCandidate(candidate, detail) : candidate;
      const metadata = object(effectiveCandidate.payload.gameMetadata ?? effectiveCandidate.frame.gameMetadata);
      const baseSeries = normalizeRiotSeries(event, observedAt, gameId);
      const existing = baseSeries.games.find(game => game.id === gameId)
        ?? { id: gameId, number: baseSeries.games.length || 1, state: 'unknown' as const };
      const game: LolProviderGame = {
        ...existing,
        state: effectiveCandidate.gameplay && existing.state !== 'completed' ? 'live' : existing.state
      };
      const series: LolProviderSeries = {
        ...baseSeries,
        state: effectiveCandidate.gameplay && baseSeries.state !== 'completed' ? 'live' : baseSeries.state,
        games: baseSeries.games.map(entry => entry.id === gameId ? game : entry)
      };
      const afterMs = parseTime(after);
      const advancing = afterMs === null ? null : effectiveCandidate.timestampMs > afterMs;

      if (!effectiveCandidate.gameplay) {
        return {
          series,
          game: { ...game, state: game.state === 'completed' ? 'completed' : 'draft' },
          sourceTimestamp: effectiveCandidate.timestamp,
          observedAt,
          advancing,
          complete: false,
          stats: null,
          reasons: [{ code: 'pregame_or_unknown', message: 'Progressing gameplay has not been verified.' }]
        };
      }

      const detailMap = participantMap(detail?.frame);
      const blueMetadata = object(metadata.blueTeamMetadata);
      const redMetadata = object(metadata.redTeamMetadata);
      const blueInfo = teamForSide(event, series, gameId, 'blue', firstString(blueMetadata, ['esportsTeamId']));
      const redInfo = teamForSide(event, series, gameId, 'red', firstString(redMetadata, ['esportsTeamId']));
      const stats: LolStats = {
        gameClockSeconds: gameClock(
          effectiveCandidate.frame,
          event,
          gameId,
          metadata,
          effectiveCandidate.timestampMs,
          gameStartTimes.get(gameId) ?? null
        ),
        patch: firstString(metadata, ['patchVersion', 'gameVersion']),
        blue: teamState('blue', effectiveCandidate.frame, blueMetadata, detailMap, blueInfo),
        red: teamState('red', effectiveCandidate.frame, redMetadata, detailMap, redInfo)
      };
      const reasons = completenessReasons(stats);
      return {
        series,
        game,
        sourceTimestamp: effectiveCandidate.timestamp,
        observedAt,
        advancing,
        complete: reasons.length === 0,
        stats,
        ...(reasons.length ? { reasons } : {})
      };
    }
  };
}
