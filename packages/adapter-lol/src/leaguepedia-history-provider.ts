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
const LOOKBACK_MS = 18 * 60 * 60 * 1_000;
const LOOKAHEAD_MS = 36 * 60 * 60 * 1_000;

type Json = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface LeaguepediaHistoryOptions {
  fetcher?: FetchLike;
  now?: () => Date;
}

interface LeaguepediaRow {
  matchId: string;
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
  return typeof value === 'string' ? value.trim() : '';
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

function teamIndex(series: LolProviderSeries, value: string): number | null {
  const normalized = normalizeName(value);
  if (!normalized) return null;
  const index = series.teams.findIndex(team => teamAliases(team).has(normalized));
  return index >= 0 ? index : null;
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

function cargoString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
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

function matchingRows(series: LolProviderSeries, rows: readonly LeaguepediaRow[]): readonly LeaguepediaRow[] {
  const grouped = new Map<string, LeaguepediaRow[]>();
  for (const row of rows) {
    const indices = [teamIndex(series, row.team1), teamIndex(series, row.team2)];
    if (!indices.includes(0) || !indices.includes(1)) continue;
    const current = grouped.get(row.matchId) ?? [];
    current.push(row);
    grouped.set(row.matchId, current);
  }

  const scheduled = Date.parse(series.scheduledStart);
  return [...grouped.values()]
    .sort((left, right) => {
      const leftDate = left.map(row => row.dateTimeMs).find((value): value is number => value !== null) ?? 0;
      const rightDate = right.map(row => row.dateTimeMs).find((value): value is number => value !== null) ?? 0;
      return Math.abs(leftDate - scheduled) - Math.abs(rightDate - scheduled);
    })[0]
    ?.slice()
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
  rows: readonly LeaguepediaRow[]
): { history: SeriesHistoryRef; changed: boolean } {
  const byNumber = new Map(
    rows
      .filter(row => row.gameNumber !== null)
      .map(row => [row.gameNumber!, row] as const)
  );
  let changed = false;
  const games = history.games.map(game => {
    if (game.state !== 'completed') return game;
    const row = byNumber.get(game.number);
    if (!row) return game;
    const winner = game.winner ?? winnerForRow(series, row);
    const durationSeconds = game.durationSeconds ?? row.durationSeconds;
    if (winner === game.winner && durationSeconds === game.durationSeconds) return game;
    changed = true;
    return { ...game, winner, durationSeconds };
  });
  return { history: changed ? { ...history, games } : history, changed };
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
  series: LolProviderSeries
): Promise<readonly LeaguepediaRow[]> {
  const start = Date.parse(series.scheduledStart);
  if (!Number.isFinite(start)) return [];
  const teamNames = series.teams.map(team => cargoString(team.name));
  const where = [
    `SG.DateTime_UTC >= "${cargoDate(start - LOOKBACK_MS)}"`,
    `SG.DateTime_UTC <= "${cargoDate(start + LOOKAHEAD_MS)}"`,
    `((SG.Team1="${teamNames[0]}" OR SG.Team2="${teamNames[0]}")`,
    `AND (SG.Team1="${teamNames[1]}" OR SG.Team2="${teamNames[1]}"))`
  ].join(' ');
  const url = new URL(LEAGUEPEDIA_API);
  url.searchParams.set('action', 'cargoquery');
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '50');
  url.searchParams.set('tables', 'ScoreboardGames=SG');
  url.searchParams.set('fields', [
    'SG.MatchId=MatchId',
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) return [];
    return parseRows(await response.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function createLeaguepediaHistoryFallbackProvider(
  base: LolProviderClient,
  options: LeaguepediaHistoryOptions = {}
): LolProviderClient {
  if (!base.getSeriesContext) throw new Error('Leaguepedia history fallback requires series context support.');
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const seriesById = new Map<string, LolProviderSeries>();
  const seriesGameById = new Map<string, SeriesGameLocator>();
  const rowCache = new Map<string, CachedRows>();

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
    const cached = rowCache.get(series.id);
    if (cached && cached.expiresAt > now().getTime()) return cached.rows;
    const rows = await requestRows(fetcher, series);
    rowCache.set(series.id, { rows, expiresAt: now().getTime() + RESULT_CACHE_MS });
    return rows;
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
      const rows = matchingRows(located.series, await rowsFor(located.series));
      const row = rows.find(candidate => candidate.gameNumber === located.gameNumber);
      return row ? supplementSnapshotGrubs(located.series, snapshot, row) : snapshot;
    },
    async getSeriesContext(seriesId: string) {
      const context = await base.getSeriesContext!(seriesId);
      const missing = context.history?.games.some(game => (
        game.state === 'completed' && (!game.winner || game.durationSeconds === null)
      ));
      if (!context.history || !missing) return context;

      let series = seriesById.get(seriesId);
      if (!series) {
        await getSchedule();
        series = seriesById.get(seriesId);
      }
      if (!series) return context;

      const rows = matchingRows(series, await rowsFor(series));
      const supplemented = supplementHistory(series, context.history, rows);
      if (!supplemented.changed) return context;

      const reason: QualityReason = {
        code: 'history_supplemented',
        message: 'Missing completed-game winner or duration fields were supplemented from Leaguepedia.'
      };
      const reasons = [
        ...(context.reasons ?? []).filter(item => item.code !== reason.code),
        reason
      ];
      return { ...context, history: supplemented.history, reasons };
    }
  };
}
