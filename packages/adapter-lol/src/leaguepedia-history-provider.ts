import type {
  QualityReason,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSeries,
  LolProviderSnapshot
} from './provider.ts';

const LEAGUEPEDIA_API = 'https://lol.fandom.com/api.php';
const REQUEST_TIMEOUT_MS = 5_000;
const RESULT_CACHE_MS = 5 * 60 * 1_000;
const EMPTY_RESULT_CACHE_MS = 10_000;
const LOOKBACK_MS = 8 * 60 * 60 * 1_000;
const LOOKAHEAD_MS = 8 * 60 * 60 * 1_000;
const STALE_ACTIVE_HISTORY_PROBE_MS = 90 * 60 * 1_000;
const REQUEST_RETRY_DELAYS_MS = [0, 750] as const;
const LEAGUEPEDIA_USER_AGENT = 'esports-live/1.0 (Leaguepedia completed-game enrichment)';
const GENERIC_TEAM_TOKENS = new Set([
  'academy',
  'challenger',
  'challengers',
  'club',
  'esport',
  'esports',
  'gaming',
  'team',
  'youth'
]);

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface LeaguepediaHistoryOptions {
  fetcher?: FetchLike;
  now?: () => Date;
  sleep?: (delayMs: number) => Promise<void>;
}

interface LeaguepediaRow {
  matchId: string;
  gameId: string;
  team1: string;
  team2: string;
  winTeam: string;
  winner: number | null;
  gameNumber: number | null;
  durationSeconds: number | null;
  dateTimeMs: number | null;
  team1VoidGrubs: number | null;
  team2VoidGrubs: number | null;
}

interface CachedRows {
  expiresAt: number;
  rows: readonly LeaguepediaRow[];
}

interface SeriesGameLocator {
  seriesId: string;
  gameNumber: number;
}

const object = (value: unknown): Json => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
);
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamAliases(team: TeamRef): ReadonlySet<string> {
  return new Set(
    [team.name, team.code, team.slug]
      .filter((value): value is string => Boolean(value))
      .map(normalizeName)
      .filter(Boolean)
  );
}

function tokens(value: string): readonly string[] {
  return normalizeName(value).split(' ').filter(Boolean);
}

function identityTokens(value: string): readonly string[] {
  const filtered = tokens(value).filter(token => !GENERIC_TEAM_TOKENS.has(token));
  return filtered.length ? filtered : tokens(value);
}

function acronym(values: readonly string[]): string {
  return values.map(value => value.length <= 3 ? value : value[0]).join('');
}

function aliasMatchScore(alias: string, candidate: string): number {
  const normalizedAlias = normalizeName(alias);
  const normalizedCandidate = normalizeName(candidate);
  if (!normalizedAlias || !normalizedCandidate) return 0;
  if (normalizedAlias === normalizedCandidate) return 100;

  const aliasTokens = tokens(normalizedAlias);
  const candidateTokens = tokens(normalizedCandidate);
  if (candidateTokens.includes(normalizedAlias) || aliasTokens.includes(normalizedCandidate)) return 94;
  if (
    normalizedAlias.length >= 2
    && (
      normalizedCandidate.startsWith(`${normalizedAlias} `)
      || normalizedAlias.startsWith(`${normalizedCandidate} `)
    )
  ) {
    return 92;
  }

  const aliasIdentity = identityTokens(normalizedAlias);
  const candidateIdentity = identityTokens(normalizedCandidate);
  const aliasCompact = aliasIdentity.join('');
  const candidateCompact = candidateIdentity.join('');
  if (aliasCompact && aliasCompact === candidateCompact) return 90;

  const aliasAcronym = acronym(aliasIdentity);
  const candidateAcronym = acronym(candidateIdentity);
  if (
    aliasCompact.length >= 2
    && candidateAcronym.length >= 2
    && aliasCompact === candidateAcronym
  ) {
    return 88;
  }
  if (
    candidateCompact.length >= 2
    && aliasAcronym.length >= 2
    && candidateCompact === aliasAcronym
  ) {
    return 88;
  }
  if (
    aliasAcronym.length >= 2
    && aliasAcronym === candidateAcronym
  ) {
    return 84;
  }

  const overlap = aliasIdentity.filter(token => candidateIdentity.includes(token)).length;
  if (overlap > 0 && overlap === Math.min(aliasIdentity.length, candidateIdentity.length)) {
    return 76 + Math.min(6, overlap * 2);
  }
  return 0;
}

function teamMatchScore(team: TeamRef, value: string): number {
  let score = 0;
  for (const alias of teamAliases(team)) score = Math.max(score, aliasMatchScore(alias, value));
  return score;
}

function teamIndex(series: LolProviderSeries, value: string): number | null {
  const normalized = normalizeName(value);
  if (!normalized) return null;
  const exact = series.teams.findIndex(team => teamAliases(team).has(normalized));
  if (exact >= 0) return exact;

  const ranked = series.teams
    .map((team, index) => ({ index, score: teamMatchScore(team, value) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score < 70) return null;
  const second = ranked[1];
  if (second && second.score > 0 && best.score - second.score < 8) return null;
  return best.index;
}

function snapshotTeamIndex(
  series: LolProviderSeries,
  team: { id: string; name: string }
): number | null {
  const byId = series.teams.findIndex(candidate => candidate.id === team.id);
  return byId >= 0 ? byId : teamIndex(series, team.name);
}

function cargoDate(milliseconds: number): string {
  return new Date(milliseconds).toISOString().replace('T', ' ').slice(0, 19);
}

function parseDuration(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.length < 2 || parts.some(part => !Number.isFinite(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? Math.round(seconds) : null;
}

function parseDate(value: unknown): number | null {
  const text = stringValue(value);
  if (!text) return null;
  const parsed = Date.parse(text.endsWith('Z') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRows(payload: unknown): readonly LeaguepediaRow[] {
  return array(object(payload).cargoquery).map(entry => object(object(entry).title)).map((row, index) => ({
    matchId: stringValue(row.MatchId) || `row-${index}`,
    gameId: stringValue(row.GameId),
    team1: stringValue(row.Team1),
    team2: stringValue(row.Team2),
    winTeam: stringValue(row.WinTeam),
    winner: numberValue(row.Winner),
    gameNumber: numberValue(row.N_GameInMatch),
    durationSeconds: parseDuration(row.Gamelength),
    dateTimeMs: parseDate(row.DateTime_UTC),
    team1VoidGrubs: numberValue(row.Team1VoidGrubs),
    team2VoidGrubs: numberValue(row.Team2VoidGrubs)
  })).filter(row => row.team1 && row.team2);
}

function pairScore(
  firstTeam: TeamRef,
  firstName: string,
  secondTeam: TeamRef,
  secondName: string
): number {
  const first = teamMatchScore(firstTeam, firstName);
  const second = teamMatchScore(secondTeam, secondName);
  return Math.min(first, second) >= 70 ? first + second : -1;
}

function groupMatchScore(series: LolProviderSeries, rows: readonly LeaguepediaRow[]): number {
  const row = rows[0];
  if (!row) return -1;
  return Math.max(
    pairScore(series.teams[0], row.team1, series.teams[1], row.team2),
    pairScore(series.teams[0], row.team2, series.teams[1], row.team1)
  );
}

function matchingRows(series: LolProviderSeries, rows: readonly LeaguepediaRow[]): readonly LeaguepediaRow[] {
  const grouped = new Map<string, LeaguepediaRow[]>();
  for (const row of rows) {
    const current = grouped.get(row.matchId) ?? [];
    current.push(row);
    grouped.set(row.matchId, current);
  }

  const scheduled = Date.parse(series.scheduledStart);
  const candidates = [...grouped.values()]
    .map(group => ({ group, score: groupMatchScore(series, group) }))
    .filter(candidate => candidate.score >= 140)
    .sort((left, right) => {
      const score = right.score - left.score;
      if (score) return score;
      const leftDate = left.group.map(row => row.dateTimeMs).find((value): value is number => value !== null) ?? 0;
      const rightDate = right.group.map(row => row.dateTimeMs).find((value): value is number => value !== null) ?? 0;
      return Math.abs(leftDate - scheduled) - Math.abs(rightDate - scheduled);
    });

  return candidates[0]?.group
    .slice()
    .sort((left, right) => (left.gameNumber ?? 0) - (right.gameNumber ?? 0))
    ?? [];
}

function winnerForRow(series: LolProviderSeries, row: LeaguepediaRow): TeamRef | null {
  const directIndex = teamIndex(series, row.winTeam);
  if (directIndex !== null) return series.teams[directIndex] ?? null;

  if (row.winner !== 1 && row.winner !== 2) return null;
  const winningName = row.winner === 1 ? row.team1 : row.team2;
  const index = teamIndex(series, winningName);
  return index === null ? null : series.teams[index] ?? null;
}

function supplementHistory(
  series: LolProviderSeries,
  history: SeriesHistoryRef,
  rows: readonly LeaguepediaRow[],
  recoverCompletedRows = false
): { history: SeriesHistoryRef; changed: boolean } {
  const byNumber = new Map(
    rows
      .filter(row => row.gameNumber !== null)
      .map(row => [row.gameNumber!, row] as const)
  );
  const conflictingWinner = [...byNumber.entries()].some(([number, row]) => {
    const existing = history.games.find(game => game.number === number);
    const winner = winnerForRow(series, row);
    return Boolean(existing?.winner && winner && existing.winner.id !== winner.id);
  });
  const allowRecovery = recoverCompletedRows && !conflictingWinner;
  let changed = false;
  let games = history.games.map(game => {
    const row = byNumber.get(game.number);
    if (!row) return game;
    const rowWinner = winnerForRow(series, row);
    const promoteCompleted = allowRecovery && rowWinner !== null;
    if (game.state !== 'completed' && !promoteCompleted) return game;
    const state = promoteCompleted ? 'completed' as const : game.state;
    const winner = game.winner ?? rowWinner;
    const durationSeconds = game.durationSeconds ?? row.durationSeconds;
    if (
      state === game.state
      && winner === game.winner
      && durationSeconds === game.durationSeconds
    ) {
      return game;
    }
    changed = true;
    return { ...game, state, winner, durationSeconds };
  });

  if (allowRecovery) {
    const existingNumbers = new Set(games.map(game => game.number));
    for (const [number, row] of byNumber) {
      if (existingNumbers.has(number) || number < 1 || number > Math.max(series.bestOf, history.bestOf)) continue;
      const winner = winnerForRow(series, row);
      if (!winner) continue;
      const seriesGame = series.games.find(game => game.number === number);
      games.push({
        id: seriesGame?.id ?? (row.gameId || `leaguepedia:${series.id}:${number}`),
        number,
        state: 'completed',
        blueTeam: null,
        redTeam: null,
        winner,
        durationSeconds: row.durationSeconds
      });
      existingNumbers.add(number);
      changed = true;
    }
    games = games.sort((left, right) => left.number - right.number);
  }

  let score = history.score;
  if (allowRecovery) {
    const evidence = [...byNumber.entries()]
      .map(([number, row]) => ({ number, winner: winnerForRow(series, row) }))
      .filter((entry): entry is { number: number; winner: TeamRef } => entry.winner !== null)
      .sort((left, right) => left.number - right.number);
    const coherent = evidence.length > 0
      && evidence.every((entry, index) => entry.number === index + 1);
    if (coherent) {
      const rowWins = series.teams.map(team => (
        evidence.filter(entry => entry.winner.id === team.id).length
      )) as [number, number];
      const clinched = rowWins.some(wins => wins >= history.winsRequired);
      const existingGamesPlayed = history.score[0].wins + history.score[1].wins;
      if (clinched || evidence.length > existingGamesPlayed) {
        score = [
          { team: history.score[0].team, wins: rowWins[0] },
          { team: history.score[1].team, wins: rowWins[1] }
        ];
        changed = true;
      }
      if (clinched) {
        games = games.map(game => {
          if (game.state !== 'live' && game.state !== 'draft' && game.state !== 'paused') return game;
          if (byNumber.has(game.number)) return game;
          changed = true;
          return { ...game, state: 'unstarted' as const };
        });
      }
    }
  }

  return { history: changed ? { ...history, score, games } : history, changed };
}

function supplementSnapshotGrubs(
  series: LolProviderSeries,
  snapshot: LolProviderSnapshot,
  row: LeaguepediaRow
): LolProviderSnapshot {
  if (!snapshot.stats) return snapshot;

  const team1Index = teamIndex(series, row.team1);
  const team2Index = teamIndex(series, row.team2);
  const blueIndex = snapshotTeamIndex(series, snapshot.stats.blue);
  const redIndex = snapshotTeamIndex(series, snapshot.stats.red);
  if (
    team1Index === null
    || team2Index === null
    || team1Index === team2Index
    || blueIndex === null
    || redIndex === null
    || blueIndex === redIndex
  ) {
    return snapshot;
  }

  const countForIndex = (index: number): number | null => {
    if (index === team1Index) return row.team1VoidGrubs;
    if (index === team2Index) return row.team2VoidGrubs;
    return null;
  };
  const blueGrubs = snapshot.stats.blue.objectives.grubs ?? countForIndex(blueIndex);
  const redGrubs = snapshot.stats.red.objectives.grubs ?? countForIndex(redIndex);
  if (
    blueGrubs === snapshot.stats.blue.objectives.grubs
    && redGrubs === snapshot.stats.red.objectives.grubs
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    stats: {
      ...snapshot.stats,
      blue: {
        ...snapshot.stats.blue,
        objectives: { ...snapshot.stats.blue.objectives, grubs: blueGrubs }
      },
      red: {
        ...snapshot.stats.red,
        objectives: { ...snapshot.stats.red.objectives, grubs: redGrubs }
      }
    }
  };
}

async function requestRows(
  fetcher: FetchLike,
  sleep: (delayMs: number) => Promise<void>,
  series: LolProviderSeries
): Promise<readonly LeaguepediaRow[]> {
  const start = Date.parse(series.scheduledStart);
  if (!Number.isFinite(start)) return [];
  const where = [
    `SG.DateTime_UTC >= "${cargoDate(start - LOOKBACK_MS)}"`,
    `SG.DateTime_UTC <= "${cargoDate(start + LOOKAHEAD_MS)}"`
  ].join(' AND ');
  const url = new URL(LEAGUEPEDIA_API);
  url.searchParams.set('action', 'cargoquery');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '500');
  url.searchParams.set('tables', 'ScoreboardGames=SG');
  url.searchParams.set('fields', [
    'SG.MatchId=MatchId',
    'SG.GameId=GameId',
    'SG.Team1=Team1',
    'SG.Team2=Team2',
    'SG.WinTeam=WinTeam',
    'SG.Winner=Winner',
    'SG.Gamelength=Gamelength',
    'SG.N_GameInMatch=N_GameInMatch',
    'SG.DateTime_UTC=DateTime_UTC',
    'SG.Team1VoidGrubs=Team1VoidGrubs',
    'SG.Team2VoidGrubs=Team2VoidGrubs'
  ].join(','));
  url.searchParams.set('where', where);
  url.searchParams.set('order_by', 'SG.DateTime_UTC ASC, SG.N_GameInMatch ASC');
  url.searchParams.set('origin', '*');

  for (let attempt = 0; attempt < REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = REQUEST_RETRY_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) await sleep(delay);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': LEAGUEPEDIA_USER_AGENT
        },
        cache: 'no-store',
        signal: controller.signal
      });
      if (response.status === 429 || response.status >= 500) continue;
      if (!response.ok) return [];
      const body = await response.text();
      if (!body.trim()) return [];
      const payload = JSON.parse(body) as unknown;
      const error = object(object(payload).error);
      if (stringValue(error.code).toLowerCase() === 'ratelimited') continue;
      if (Object.keys(error).length) return [];
      return parseRows(payload);
    } catch {
      // Retry bounded transient transport failures, then degrade to no enrichment.
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

export function createLeaguepediaHistoryFallbackProvider(
  base: LolProviderClient,
  options: LeaguepediaHistoryOptions = {}
): LolProviderClient {
  if (!base.getSeriesContext) throw new Error('Leaguepedia history fallback requires series context support.');
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  const seriesById = new Map<string, LolProviderSeries>();
  const seriesGameById = new Map<string, SeriesGameLocator>();
  const rowCache = new Map<string, CachedRows>();
  const rowInFlight = new Map<string, Promise<readonly LeaguepediaRow[]>>();

  const remember = (entries: readonly LolProviderScheduleEntry[]): readonly LolProviderScheduleEntry[] => {
    for (const entry of entries) {
      seriesById.set(entry.series.id, entry.series);
      for (const game of entry.series.games) {
        seriesGameById.set(game.id, { seriesId: entry.series.id, gameNumber: game.number });
      }
    }
    return entries;
  };

  const getSchedule = async (): Promise<readonly LolProviderScheduleEntry[]> => remember(await base.getSchedule());

  const rowsFor = async (series: LolProviderSeries): Promise<readonly LeaguepediaRow[]> => {
    const currentTime = now().getTime();
    const cached = rowCache.get(series.id);
    if (cached && cached.expiresAt > currentTime) return cached.rows;
    const pending = rowInFlight.get(series.id);
    if (pending) return pending;

    const request = requestRows(fetcher, sleep, series)
      .then(rows => {
        rowCache.set(series.id, {
          rows,
          expiresAt: now().getTime() + (rows.length ? RESULT_CACHE_MS : EMPTY_RESULT_CACHE_MS)
        });
        return rows;
      })
      .finally(() => {
        if (rowInFlight.get(series.id) === request) rowInFlight.delete(series.id);
      });
    rowInFlight.set(series.id, request);
    return request;
  };

  const locateGame = async (gameId: string): Promise<{ series: LolProviderSeries; gameNumber: number } | null> => {
    let locator = seriesGameById.get(gameId);
    if (!locator) {
      await getSchedule();
      locator = seriesGameById.get(gameId);
    }
    if (!locator) return null;
    const series = seriesById.get(locator.seriesId);
    return series ? { series, gameNumber: locator.gameNumber } : null;
  };

  return {
    id: base.id,
    name: base.name,
    ...(base.sourceUrl ? { sourceUrl: base.sourceUrl } : {}),
    getSchedule,
    async getSnapshot(gameId: string, after?: string) {
      const snapshot = await base.getSnapshot(gameId, after);
      if (
        snapshot.game.state !== 'completed'
        || !snapshot.stats
        || (
          snapshot.stats.blue.objectives.grubs !== null
          && snapshot.stats.red.objectives.grubs !== null
        )
      ) {
        return snapshot;
      }

      const located = await locateGame(gameId);
      if (!located) return snapshot;
      const allRows = await rowsFor(located.series);
      const directRow = allRows.find(candidate => (
        candidate.gameId && candidate.gameId.toLowerCase() === gameId.toLowerCase()
      ));
      const row = directRow
        ?? matchingRows(located.series, allRows).find(candidate => candidate.gameNumber === located.gameNumber);
      return row ? supplementSnapshotGrubs(located.series, snapshot, row) : snapshot;
    },
    async getSeriesContext(seriesId: string) {
      const context = await base.getSeriesContext!(seriesId);
      if (!context.history) return context;

      const missing = context.history.games.some(game => (
        game.state === 'completed' && (!game.winner || game.durationSeconds === null)
      ));
      const active = context.history.games.some(game => (
        game.state === 'live' || game.state === 'draft' || game.state === 'paused'
      ));
      if (!missing && !active) return context;

      let series = seriesById.get(seriesId);
      if (!series) {
        await getSchedule();
        series = seriesById.get(seriesId);
      }
      if (!series) return context;

      const scheduled = Date.parse(series.scheduledStart);
      const staleActive = active
        && Number.isFinite(scheduled)
        && scheduled <= now().getTime() - STALE_ACTIVE_HISTORY_PROBE_MS;
      if (!missing && !staleActive) return context;

      const rows = matchingRows(series, await rowsFor(series));
      const supplemented = supplementHistory(series, context.history, rows, staleActive);
      if (!supplemented.changed) return context;

      const reason: QualityReason = {
        code: 'history_supplemented',
        message: staleActive
          ? 'Stale active-game history was reconciled with matched Leaguepedia completed-game evidence.'
          : 'Missing completed-game winner or duration fields were supplemented from Leaguepedia.'
      };
      const reasons = [
        ...(context.reasons ?? []).filter(item => item.code !== reason.code),
        reason
      ];
      return { ...context, history: supplemented.history, reasons };
    }
  };
}