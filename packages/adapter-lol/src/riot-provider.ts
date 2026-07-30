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
import type {
  LolObjectiveState,
  LolPlayerState,
  LolSide,
  LolStats,
  LolTeamState
} from './types.ts';

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';
const LIVE_BASE = 'https://feed.lolesports.com/livestats/v1';
const DEFAULT_LOCALE = 'en-US';
const REQUEST_TIMEOUT_MS = 8_000;
const FRESH_SELECTION_SECONDS = 30;
const PARTICIPANT_IDS = '1_2_3_4_5_6_7_8_9_10';

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RiotLolProviderOptions {
  apiKey: string;
  fetcher?: FetchLike;
  locale?: string;
  now?: () => Date;
}

interface WindowCandidate {
  payload: JsonRecord;
  frame: JsonRecord;
  timestamp: string;
  timestampMs: number;
  gameplay: boolean;
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMs(value: unknown): number | null {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(source: JsonRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(source: JsonRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = numberValue(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function roundedIso(valueMs: number): string {
  return new Date(Math.floor(valueMs / 10_000) * 10_000).toISOString();
}

export function riotWindowProbeTimes(nowMs: number, after?: string): readonly (string | null)[] {
  const afterMs = timestampMs(after);
  const raw = afterMs === null
    ? [nowMs - 20_000, nowMs - 60_000, nowMs - 120_000, nowMs - 240_000, nowMs - 360_000]
    : [afterMs + 10_000, afterMs + 20_000, nowMs - 20_000, nowMs - 60_000, nowMs - 240_000];

  const anchors = raw
    .filter(value => value <= nowMs + 15_000 && (afterMs === null || value > afterMs))
    .map(roundedIso);

  return [null, ...new Set(anchors)].slice(0, 6);
}

function mapSeriesState(value: unknown): SeriesState {
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

function mapGameState(value: unknown): GameState {
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

function normalizeTeamRef(value: unknown, fallbackId: string, fallbackName: string): TeamRef {
  const team = record(value);
  const id = firstText(team, ['id', 'teamId']) ?? fallbackId;
  const name = firstText(team, ['name', 'code']) ?? fallbackName;
  const code = firstText(team, ['code', 'acronym']);
  const imageUrl = firstText(team, ['image', 'imageUrl', 'logo']);
  return {
    id,
    name,
    ...(code ? { code } : {}),
    ...(imageUrl ? { imageUrl } : {})
  };
}

function normalizeCompetition(event: JsonRecord): CompetitionRef {
  const league = record(event.league);
  const tournament = record(event.tournament);
  const id = firstText(league, ['id', 'slug'])
    ?? firstText(tournament, ['id', 'slug'])
    ?? 'unknown-competition';
  const name = firstText(league, ['name', 'slug'])
    ?? firstText(tournament, ['name', 'slug'])
    ?? 'Unknown competition';
  const region = firstText(league, ['region']) ?? firstText(tournament, ['region']);
  const stage = firstText(event, ['blockName', 'stage']) ?? firstText(tournament, ['stage']);
  return {
    id,
    name,
    ...(region ? { region } : {}),
    ...(stage ? { stage } : {})
  };
}

function normalizeGame(value: unknown, fallbackNumber: number): LolProviderGame | null {
  const game = record(value);
  const id = firstText(game, ['id', 'gameId']);
  if (!id) return null;
  return {
    id,
    number: firstNumber(game, ['number', 'gameNumber']) ?? fallbackNumber,
    state: mapGameState(game.state)
  };
}

function normalizeSeries(eventValue: unknown, observedAt: string, fallbackGameId?: string): LolProviderSeries {
  const event = record(eventValue);
  const match = record(event.match);
  const rawTeams = list(match.teams);
  const teamA = normalizeTeamRef(rawTeams[0], 'team-1', 'Team 1');
  const teamB = normalizeTeamRef(rawTeams[1], 'team-2', 'Team 2');
  const games = list(match.games)
    .map((value, index) => normalizeGame(value, index + 1))
    .filter((value): value is LolProviderGame => value !== null);

  if (fallbackGameId && !games.some(game => game.id === fallbackGameId)) {
    games.push({ id: fallbackGameId, number: games.length + 1, state: 'live' });
  }

  const strategy = record(match.strategy);
  return {
    id: firstText(match, ['id']) ?? firstText(event, ['id']) ?? `unknown-series-${fallbackGameId ?? 'schedule'}`,
    competition: normalizeCompetition(event),
    teams: [teamA, teamB],
    bestOf: firstNumber(strategy, ['count']) ?? Math.max(1, games.length),
    state: mapSeriesState(event.state ?? match.state),
    scheduledStart: firstText(event, ['startTime', 'scheduledStart']) ?? observedAt,
    games
  };
}

function framesOf(payload: JsonRecord): readonly JsonRecord[] {
  const nestedWindow = record(payload.window);
  const data = record(payload.data);
  return list(payload.frames ?? nestedWindow.frames ?? data.frames).map(record);
}

function frameTimestamp(frame: JsonRecord): string | null {
  const value = firstText(frame, ['rfc460Timestamp', 'timestamp']);
  return value && timestampMs(value) !== null ? value : null;
}

function teamFrame(frame: JsonRecord, side: LolSide): JsonRecord {
  const direct = record(frame[side === 'blue' ? 'blueTeam' : 'redTeam']);
  if (Object.keys(direct).length) return direct;
  const numericId = side === 'blue' ? '100' : '200';
  return record(list(frame.teams).find(value => {
    const team = record(value);
    return String(team.teamID ?? team.teamId ?? team.id ?? '') === numericId;
  }));
}

function gameplayEvidence(frame: JsonRecord): boolean {
  const blue = teamFrame(frame, 'blue');
  const red = teamFrame(frame, 'red');
  const players = [...list(blue.participants), ...list(red.participants)].map(record);
  const combinedGold = (firstNumber(blue, ['totalGold', 'gold']) ?? 0)
    + (firstNumber(red, ['totalGold', 'gold']) ?? 0);
  const totalCs = players.reduce((sum, player) => sum + (firstNumber(player, ['creepScore', 'cs']) ?? 0), 0);
  const highestLevel = players.reduce((highest, player) => Math.max(highest, firstNumber(player, ['level']) ?? 0), 0);
  const kills = (firstNumber(blue, ['totalKills', 'kills']) ?? 0)
    + (firstNumber(red, ['totalKills', 'kills']) ?? 0);
  return combinedGold > 5_000 || totalCs > 0 || highestLevel > 1 || kills > 0;
}

function candidateFromPayload(value: unknown): WindowCandidate | null {
  const payload = record(value);
  let selected: WindowCandidate | null = null;
  for (const frame of framesOf(payload)) {
    const timestamp = frameTimestamp(frame);
    const parsed = timestamp ? timestampMs(timestamp) : null;
    if (!timestamp || parsed === null) continue;
    if (!selected || parsed > selected.timestampMs) {
      selected = { payload, frame, timestamp, timestampMs: parsed, gameplay: gameplayEvidence(frame) };
    }
  }
  return selected;
}

function newestCandidate(candidates: readonly WindowCandidate[]): WindowCandidate | null {
  const gameplay = candidates.filter(candidate => candidate.gameplay);
  const source = gameplay.length ? gameplay : candidates;
  return [...source].sort((left, right) => right.timestampMs - left.timestampMs)[0] ?? null;
}

function sourceAgeSeconds(candidate: WindowCandidate, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - candidate.timestampMs) / 1000));
}

function itemIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(item => {
    const object = record(item);
    return text(item) ?? firstText(object, ['itemID', 'itemId', 'id']) ?? 'unknown';
  });
}

function dragonNames(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map(dragon => {
    const object = record(dragon);
    return text(dragon) ?? firstText(object, ['name', 'type', 'dragonType']) ?? 'unknown';
  });
}

function participantId(value: JsonRecord, fallback: number): string {
  return firstText(value, ['participantId', 'participantID', 'id']) ?? String(fallback);
}

function detailsByParticipant(payload: unknown): Map<string, JsonRecord> {
  const frame = [...framesOf(record(payload))].sort((left, right) => {
    const leftMs = timestampMs(frameTimestamp(left)) ?? 0;
    const rightMs = timestampMs(frameTimestamp(right)) ?? 0;
    return rightMs - leftMs;
  })[0] ?? {};
  return new Map(list(frame.participants).map((value, index) => {
    const participant = record(value);
    return [participantId(participant, index + 1), participant] as const;
  }));
}

function participantMetadata(metadata: JsonRecord): Map<string, JsonRecord> {
  return new Map(list(metadata.participantMetadata).map((value, index) => {
    const participant = record(value);
    return [participantId(participant, index + 1), participant] as const;
  }));
}

function eventGame(event: JsonRecord, gameId: string): JsonRecord {
  const games = list(record(event.match).games).map(record);
  return games.find(game => firstText(game, ['id', 'gameId']) === gameId) ?? {};
}

function eventTeamForSide(
  event: JsonRecord,
  series: LolProviderSeries,
  gameId: string,
  side: LolSide,
  metadataTeamId: string | null
): TeamRef {
  if (metadataTeamId) {
    const exact = series.teams.find(team => team.id === metadataTeamId);
    if (exact) return exact;
  }

  const sideTeam = list(eventGame(event, gameId).teams)
    .map(record)
    .find(team => String(team.side ?? '').toLowerCase() === side);
  const sideTeamId = sideTeam ? firstText(sideTeam, ['id', 'teamId']) : null;
  if (sideTeamId) {
    const exact = series.teams.find(team => team.id === sideTeamId);
    if (exact) return exact;
  }
  return series.teams[side === 'blue' ? 0 : 1];
}

function normalizePlayer(
  rawValue: unknown,
  index: number,
  metadataById: Map<string, JsonRecord>,
  details: Map<string, JsonRecord>
): LolPlayerState {
  const raw = record(rawValue);
  const id = participantId(raw, index + 1);
  const metadata = metadataById.get(id) ?? {};
  const detail = details.get(id) ?? {};
  return {
    id,
    handle: firstText(metadata, ['summonerName', 'name']) ?? firstText(raw, ['summonerName', 'name']),
    championId: firstText(metadata, ['championId', 'championName']) ?? firstText(raw, ['championId', 'championName']),
    role: firstText(metadata, ['role']) ?? firstText(raw, ['role']),
    level: firstNumber(detail, ['level']) ?? firstNumber(raw, ['level']),
    kills: firstNumber(detail, ['kills']) ?? firstNumber(raw, ['kills']),
    deaths: firstNumber(detail, ['deaths']) ?? firstNumber(raw, ['deaths']),
    assists: firstNumber(detail, ['assists']) ?? firstNumber(raw, ['assists']),
    creepScore: firstNumber(detail, ['creepScore', 'cs', 'minionsKilled'])
      ?? firstNumber(raw, ['creepScore', 'cs', 'minionsKilled']),
    totalGold: firstNumber(detail, ['totalGold', 'totalGoldEarned', 'gold'])
      ?? firstNumber(raw, ['totalGold', 'totalGoldEarned', 'gold']),
    items: itemIds(detail.items)
  };
}

function normalizeTeam(
  side: LolSide,
  frame: JsonRecord,
  metadata: JsonRecord,
  details: Map<string, JsonRecord>,
  info: TeamRef
): LolTeamState {
  const raw = teamFrame(frame, side);
  const metadataById = participantMetadata(metadata);
  return {
    id: info.id,
    name: info.name,
    side,
    gold: firstNumber(raw, ['totalGold', 'gold']),
    kills: firstNumber(raw, ['totalKills', 'kills']),
    objectives: {
      towers: firstNumber(raw, ['towers', 'towerKills', 'turretsDestroyed']),
      inhibitors: firstNumber(raw, ['inhibitors', 'inhibitorKills']),
      dragons: dragonNames(raw.dragons),
      barons: firstNumber(raw, ['barons', 'baronKills']),
      heralds: firstNumber(raw, ['heralds', 'riftHeraldKills'])
    },
    players: list(raw.participants).map((participant, index) => (
      normalizePlayer(participant, index, metadataById, details)
    ))
  };
}

function gameStartMs(event: JsonRecord, gameId: string, metadata: JsonRecord): number | null {
  const direct = timestampMs(metadata.gameStartTime ?? metadata.startTime);
  if (direct !== null) return direct;
  for (const vodValue of list(eventGame(event, gameId).vods)) {
    const vod = record(vodValue);
    const firstFrame = timestampMs(vod.firstFrameTime);
    const startMillis = firstNumber(vod, ['startMillis']);
    if (firstFrame !== null && startMillis !== null) return firstFrame + startMillis;
  }
  return null;
}

function clockSeconds(frame: JsonRecord, event: JsonRecord, gameId: string, metadata: JsonRecord, sourceMs: number): number | null {
  const direct = firstNumber(frame, ['gameClockSeconds', 'gameTimeSeconds', 'gameTime']);
  if (direct !== null) return Math.max(0, Math.round(direct));
  const start = gameStartMs(event, gameId, metadata);
  return start !== null && sourceMs >= start ? Math.round((sourceMs - start) / 1000) : null;
}

function missingReasons(stats: LolStats): QualityReason[] {
  const missing: QualityReason[] = [];
  const requireValue = (value: unknown, field: string): void => {
    if (value === null || value === undefined || value === '') {
      missing.push({ code: 'missing_field', message: `Missing betting-critical field: ${field}.`, field });
    }
  };

  requireValue(stats.gameClockSeconds, 'gameClockSeconds');
  for (const team of [stats.blue, stats.red]) {
    requireValue(team.id, `${team.side}.id`);
    requireValue(team.gold, `${team.side}.gold`);
    requireValue(team.kills, `${team.side}.kills`);
    requireValue(team.objectives.towers, `${team.side}.objectives.towers`);
    requireValue(team.objectives.inhibitors, `${team.side}.objectives.inhibitors`);
    requireValue(team.objectives.dragons, `${team.side}.objectives.dragons`);
    requireValue(team.objectives.barons, `${team.side}.objectives.barons`);
    requireValue(team.objectives.heralds, `${team.side}.objectives.heralds`);
    if (team.players.length !== 5) {
      missing.push({
        code: 'player_count_invalid',
        message: `${team.side} side has ${team.players.length} players instead of 5.`,
        field: `${team.side}.players`
      });
    }
    team.players.forEach((player, index) => {
      requireValue(player.handle, `${team.side}.players.${index}.handle`);
      requireValue(player.championId, `${team.side}.players.${index}.championId`);
      requireValue(player.role, `${team.side}.players.${index}.role`);
      requireValue(player.level, `${team.side}.players.${index}.level`);
      requireValue(player.kills, `${team.side}.players.${index}.kills`);
      requireValue(player.deaths, `${team.side}.players.${index}.deaths`);
      requireValue(player.assists, `${team.side}.players.${index}.assists`);
      requireValue(player.creepScore, `${team.side}.players.${index}.creepScore`);
      requireValue(player.totalGold, `${team.side}.players.${index}.totalGold`);
      requireValue(player.items, `${team.side}.players.${index}.items`);
    });
  }
  return missing;
}

async function responseJson(
  fetcher: FetchLike,
  url: URL,
  init: RequestInit,
  tolerateMiss = false
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const body = await response.text();
    if (response.status === 204) return null;
    if (!response.ok) {
      const cacheMiss = response.status === 404 && /cache\s*miss/i.test(body);
      if (tolerateMiss && (cacheMiss || response.status === 404)) return null;
      throw new Error(`Riot upstream returned HTTP ${response.status}.`);
    }
    return body.trim() ? JSON.parse(body) : null;
  } finally {
    clearTimeout(timeout);
  }
}

export function createRiotLolProvider(options: RiotLolProviderOptions): LolProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('A Riot LoL Esports API key is required.');
  const fetcher = options.fetcher ?? fetch;
  const locale = options.locale ?? DEFAULT_LOCALE;
  const now = options.now ?? (() => new Date());

  const persisted = async (path: string, params: Record<string, string | readonly string[] | undefined>): Promise<unknown> => {
    const url = new URL(`${PERSISTED_BASE}/${path}`);
    url.searchParams.set('hl', locale);
    for (const [name, value] of Object.entries(params)) {
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(name, item));
      else if (value) url.searchParams.set(name, value);
    }
    return responseJson(fetcher, url, {
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      cache: 'no-store'
    });
  };

  const liveFeed = async (path: string, params: Record<string, string | undefined>): Promise<unknown> => {
    const url = new URL(`${LIVE_BASE}/${path}`);
    for (const [name, value] of Object.entries(params)) {
      if (value) url.searchParams.set(name, value);
    }
    return responseJson(fetcher, url, { headers: { Accept: 'application/json' }, cache: 'no-store' }, true);
  };

  const bestWindow = async (gameId: string, after?: string): Promise<WindowCandidate | null> => {
    const nowMs = now().getTime();
    const probes = riotWindowProbeTimes(nowMs, after);
    const first = candidateFromPayload(await liveFeed(`window/${encodeURIComponent(gameId)}`, {}));
    const afterMs = timestampMs(after);
    if (
      first?.gameplay
      && sourceAgeSeconds(first, nowMs) <= FRESH_SELECTION_SECONDS
      && (afterMs === null || first.timestampMs > afterMs)
    ) return first;

    const candidates = first ? [first] : [];
    const fallbacks = await Promise.all(probes.slice(1).map(startingTime => (
      liveFeed(`window/${encodeURIComponent(gameId)}`, { startingTime: startingTime ?? undefined })
        .then(candidateFromPayload)
        .catch(() => null)
    )));
    candidates.push(...fallbacks.filter((candidate): candidate is WindowCandidate => candidate !== null));
    return newestCandidate(candidates);
  };

  const bestDetails = async (gameId: string, sourceTimestamp: string): Promise<unknown> => {
    const sourceMs = timestampMs(sourceTimestamp);
    if (sourceMs === null) return null;
    const probes = [...new Set([
      new Date(sourceMs).toISOString(),
      roundedIso(sourceMs),
      roundedIso(sourceMs - 10_000)
    ])];
    const responses = await Promise.all(probes.map(startingTime => (
      liveFeed(`details/${encodeURIComponent(gameId)}`, { startingTime, participantIds: PARTICIPANT_IDS })
        .catch(() => null)
    )));
    return responses.find(value => framesOf(record(value)).length > 0) ?? null;
  };

  const eventForMatch = async (matchId: string | null): Promise<JsonRecord> => {
    if (!matchId) return {};
    const payload = record(await persisted('getEventDetails', { id: matchId }));
    const data = record(payload.data);
    return record(data.event ?? payload.event ?? data);
  };

  return {
    id: 'riot-lolesports-web',
    name: 'Riot LoL Esports web feed',
    sourceUrl: 'https://lolesports.com',

    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const observedAt = now().toISOString();
      const payload = record(await persisted('getSchedule', {}));
      const events = list(record(record(payload.data).schedule).events ?? record(payload.schedule).events);
      return events.map(event => ({ series: normalizeSeries(event, observedAt), observedAt }));
    },

    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const observedAt = now().toISOString();
      const candidate = await bestWindow(gameId, after);
      if (!candidate) {
        const series = normalizeSeries({}, observedAt, gameId);
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

      const metadata = record(candidate.payload.gameMetadata ?? candidate.frame.gameMetadata);
      const matchId = firstText(candidate.payload, ['esportsMatchId'])
        ?? firstText(metadata, ['esportsMatchId']);
      const event = await eventForMatch(matchId).catch(() => ({}));
      const baseSeries = normalizeSeries(event, observedAt, gameId);
      const eventGameRef = baseSeries.games.find(game => game.id === gameId)
        ?? { id: gameId, number: baseSeries.games.length || 1, state: 'unknown' as const };
      const game: LolProviderGame = {
        ...eventGameRef,
        state: candidate.gameplay && eventGameRef.state !== 'completed' ? 'live' : eventGameRef.state
      };
      const series: LolProviderSeries = {
        ...baseSeries,
        state: candidate.gameplay && baseSeries.state !== 'completed' ? 'live' : baseSeries.state,
        games: baseSeries.games.map(item => item.id === gameId ? game : item)
      };
      const afterMs = timestampMs(after);
      const advancing = afterMs === null ? null : candidate.timestampMs > afterMs;

      if (!candidate.gameplay) {
        return {
          series,
          game: { ...game, state: game.state === 'completed' ? 'completed' : 'draft' },
          sourceTimestamp: candidate.timestamp,
          observedAt,
          advancing,
          complete: false,
          stats: null,
          reasons: [{
            code: 'pregame_or_unknown',
            message: 'A timestamped frame exists, but progressing gameplay has not been verified.'
          }]
        };
      }

      const detailsPayload = await bestDetails(gameId, candidate.timestamp);
      const details = detailsByParticipant(detailsPayload);
      const blueMetadata = record(metadata.blueTeamMetadata);
      const redMetadata = record(metadata.redTeamMetadata);
      const blueTeamId = firstText(blueMetadata, ['esportsTeamId']);
      const redTeamId = firstText(redMetadata, ['esportsTeamId']);
      const blueInfo = eventTeamForSide(event, series, gameId, 'blue', blueTeamId);
      const redInfo = eventTeamForSide(event, series, gameId, 'red', redTeamId);
      const stats: LolStats = {
        gameClockSeconds: clockSeconds(candidate.frame, event, gameId, metadata, candidate.timestampMs),
        patch: firstText(metadata, ['patchVersion', 'gameVersion']),
        blue: normalizeTeam('blue', candidate.frame, blueMetadata, details, blueInfo),
        red: normalizeTeam('red', candidate.frame, redMetadata, details, redInfo)
      };
      const reasons = missingReasons(stats);
      return {
        series,
        game,
        sourceTimestamp: candidate.timestamp,
        observedAt,
        advancing,
        complete: reasons.length === 0,
        stats,
        ...(reasons.length ? { reasons } : {})
      };
    }
  };
}