import type { LolProviderClient, LolProviderScheduleEntry, LolProviderSeries } from './provider.ts';
import { RIOT_LPL_LEAGUE_ID } from './riot-supplemental-league-provider.ts';

export interface UsableScheduleProviderOptions {
  now?: () => Date;
  scheduledLiveProbeDelayMs?: number;
  scheduledLiveProbeWindowMs?: number;
  scheduledLiveProbeLimit?: number;
  completedLiveProbeWindowMs?: number;
  completedLiveProbeLimit?: number;
}

const DEFAULT_SCHEDULED_LIVE_PROBE_DELAY_MS = 2 * 60 * 1_000;
const DEFAULT_SCHEDULED_LIVE_PROBE_WINDOW_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_SCHEDULED_LIVE_PROBE_LIMIT = 6;
const DEFAULT_COMPLETED_LIVE_PROBE_WINDOW_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_COMPLETED_LIVE_PROBE_LIMIT = 4;

type ProviderGame = LolProviderSeries['games'][number];

function hasPlaceholderTeam(series: LolProviderSeries): boolean {
  return series.teams.some((team, index) => team.name === `Team ${index + 1}`);
}

function hasUsableTeams(series: LolProviderSeries): boolean {
  return !hasPlaceholderTeam(series);
}

function hasActiveGame(games: readonly ProviderGame[]): boolean {
  return games.some(game => (
    game.state === 'live'
    || game.state === 'draft'
    || game.state === 'paused'
  ));
}

function isUsableLiveSeries(series: LolProviderSeries): boolean {
  return hasUsableTeams(series) && series.games.length > 0;
}

function verifiedSeriesState(games: readonly ProviderGame[]): LolProviderSeries['state'] {
  if (games.some(game => game.state === 'paused')) return 'paused';
  if (games.some(game => game.state === 'live' || game.state === 'draft')) return 'live';
  if (games.length > 0 && games.every(game => game.state === 'completed')) return 'completed';
  return 'scheduled';
}

function applyVerifiedSeriesState(
  series: LolProviderSeries,
  games: readonly ProviderGame[]
): LolProviderSeries {
  const state = verifiedSeriesState(games);
  return games === series.games && state === series.state
    ? series
    : { ...series, games, state };
}

function scheduledProbeTime(
  series: LolProviderSeries,
  nowMs: number,
  delayMs: number,
  windowMs: number
): number | null {
  if (series.state !== 'scheduled' || !hasUsableTeams(series)) return null;
  const scheduledStart = Date.parse(series.scheduledStart);
  if (!Number.isFinite(scheduledStart)) return null;
  const elapsed = nowMs - scheduledStart;
  return elapsed >= delayMs && elapsed <= windowMs ? scheduledStart : null;
}

function isLplSeries(series: LolProviderSeries): boolean {
  const competitionId = series.competition.id.trim().toLowerCase();
  const competitionName = series.competition.name.trim().toLowerCase();
  return competitionId === RIOT_LPL_LEAGUE_ID
    || competitionName === 'lpl'
    || competitionName.includes('league of legends pro league');
}

function completedProbeTime(
  series: LolProviderSeries,
  nowMs: number,
  windowMs: number
): number | null {
  if (series.state !== 'completed' || !hasUsableTeams(series)) return null;
  const scheduledStart = Date.parse(series.scheduledStart);
  if (!Number.isFinite(scheduledStart)) return null;
  const elapsed = nowMs - scheduledStart;
  if (elapsed < 0 || elapsed > windowMs) return null;

  const winsRequired = Math.floor(Math.max(1, series.bestOf) / 2) + 1;
  const completedGames = series.games.filter(game => game.state === 'completed').length;
  const incompleteGameInventory = series.games.length < winsRequired
    || completedGames < winsRequired
    || series.games.some(game => game.state !== 'completed');

  return isLplSeries(series) || incompleteGameInventory ? scheduledStart : null;
}

async function reconcileLiveGameState(
  provider: LolProviderClient,
  games: readonly ProviderGame[]
): Promise<readonly ProviderGame[]> {
  let reconciled = games;
  const candidates = games.filter(game => game.state !== 'completed');
  for (const candidate of candidates) {
    try {
      const snapshot = await provider.getSnapshot(candidate.id);
      if (snapshot.game.state === 'completed') {
        reconciled = reconciled.map(game => (
          game.id === candidate.id ? { ...game, state: 'completed' } : game
        ));
        continue;
      }
      if (
        snapshot.game.state === 'live'
        || snapshot.game.state === 'draft'
        || snapshot.game.state === 'paused'
        || snapshot.stats
      ) {
        const state = snapshot.game.state === 'draft'
          ? 'draft'
          : snapshot.game.state === 'paused'
            ? 'paused'
            : 'live';
        return reconciled.map(game => game.id === candidate.id ? { ...game, state } : game);
      }
      if (snapshot.game.state === 'unstarted' || snapshot.game.state === 'unknown') {
        reconciled = reconciled.map(game => (
          game.id === candidate.id ? { ...game, state: snapshot.game.state } : game
        ));
      }
    } catch {
      // A live-stat miss is expected while Riot is between games; try the next slot.
    }
  }
  return reconciled;
}

async function resolveFromSeriesHistory(
  provider: LolProviderClient,
  series: LolProviderSeries
): Promise<LolProviderSeries | null> {
  if (!provider.getSeriesContext) return null;

  const context = await provider.getSeriesContext(series.id);
  const history = context.history;
  if (!history || history.score.length < 2 || !history.games.length) return null;

  const historyGames = history.games
    .map(game => ({ id: game.id, number: game.number, state: game.state }))
    .sort((left, right) => left.number - right.number);
  const games = await reconcileLiveGameState(provider, historyGames);
  return {
    ...series,
    teams: [history.score[0]!.team, history.score[1]!.team],
    bestOf: history.bestOf,
    games
  };
}

async function resolveLiveEntry(
  provider: LolProviderClient,
  entry: LolProviderScheduleEntry
): Promise<LolProviderScheduleEntry | null> {
  const { series } = entry;
  const pendingEntry = hasUsableTeams(series)
    ? { ...entry, series: applyVerifiedSeriesState(series, series.games) }
    : null;

  if (isUsableLiveSeries(series)) {
    const games = await reconcileLiveGameState(provider, series.games);
    return { ...entry, series: applyVerifiedSeriesState(series, games) };
  }

  // Keep a listing with real teams visible while Riot publishes game IDs, but
  // do not label it live until an active game or gameplay frame is verified.
  try {
    const resolvedSeries = await resolveFromSeriesHistory(provider, series);
    return resolvedSeries && isUsableLiveSeries(resolvedSeries)
      ? { ...entry, series: applyVerifiedSeriesState(resolvedSeries, resolvedSeries.games) }
      : pendingEntry;
  } catch {
    return pendingEntry;
  }
}

function promoteScheduledEntry(
  entry: LolProviderScheduleEntry,
  series: LolProviderSeries
): LolProviderScheduleEntry {
  const state = series.games.some(game => game.state === 'paused') ? 'paused' : 'live';
  return { ...entry, series: { ...series, state } };
}

async function resolveScheduledEntry(
  provider: LolProviderClient,
  entry: LolProviderScheduleEntry,
  probeScheduled: boolean
): Promise<LolProviderScheduleEntry> {
  const { series } = entry;
  if (hasActiveGame(series.games)) return promoteScheduledEntry(entry, series);
  if (!probeScheduled) return entry;

  if (series.games.length) {
    const games = await reconcileLiveGameState(provider, series.games);
    const resolvedSeries = { ...series, games };
    if (hasActiveGame(games)) return promoteScheduledEntry(entry, resolvedSeries);
  }

  try {
    const resolvedSeries = await resolveFromSeriesHistory(provider, series);
    return resolvedSeries && hasActiveGame(resolvedSeries.games)
      ? promoteScheduledEntry(entry, resolvedSeries)
      : entry;
  } catch {
    return entry;
  }
}

async function resolveCompletedEntry(
  provider: LolProviderClient,
  entry: LolProviderScheduleEntry,
  probeCompleted: boolean
): Promise<LolProviderScheduleEntry> {
  if (!probeCompleted) return entry;
  const { series } = entry;

  if (series.games.some(game => game.state !== 'completed')) {
    const games = await reconcileLiveGameState(provider, series.games);
    const resolvedSeries = { ...series, games };
    if (hasActiveGame(games)) return promoteScheduledEntry(entry, resolvedSeries);
  }

  try {
    const resolvedSeries = await resolveFromSeriesHistory(provider, series);
    return resolvedSeries && hasActiveGame(resolvedSeries.games)
      ? promoteScheduledEntry(entry, resolvedSeries)
      : entry;
  } catch {
    return entry;
  }
}

async function resolveEntry(
  provider: LolProviderClient,
  entry: LolProviderScheduleEntry,
  probeScheduled: boolean,
  probeCompleted: boolean
): Promise<LolProviderScheduleEntry | null> {
  if (entry.series.state === 'live' || entry.series.state === 'paused') {
    return resolveLiveEntry(provider, entry);
  }
  if (entry.series.state === 'scheduled') {
    return resolveScheduledEntry(provider, entry, probeScheduled);
  }
  if (entry.series.state === 'completed') {
    return resolveCompletedEntry(provider, entry, probeCompleted);
  }
  return entry;
}

export function createUsableScheduleProvider(
  provider: LolProviderClient,
  options: UsableScheduleProviderOptions = {}
): LolProviderClient {
  const now = options.now ?? (() => new Date());
  const scheduledLiveProbeDelayMs = options.scheduledLiveProbeDelayMs
    ?? DEFAULT_SCHEDULED_LIVE_PROBE_DELAY_MS;
  const scheduledLiveProbeWindowMs = options.scheduledLiveProbeWindowMs
    ?? DEFAULT_SCHEDULED_LIVE_PROBE_WINDOW_MS;
  const scheduledLiveProbeLimit = options.scheduledLiveProbeLimit
    ?? DEFAULT_SCHEDULED_LIVE_PROBE_LIMIT;
  const completedLiveProbeWindowMs = options.completedLiveProbeWindowMs
    ?? DEFAULT_COMPLETED_LIVE_PROBE_WINDOW_MS;
  const completedLiveProbeLimit = options.completedLiveProbeLimit
    ?? DEFAULT_COMPLETED_LIVE_PROBE_LIMIT;

  return {
    id: provider.id,
    name: provider.name,
    ...(provider.sourceUrl ? { sourceUrl: provider.sourceUrl } : {}),
    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const entries = await provider.getSchedule();
      const nowMs = now().getTime();
      const scheduledProbeIds = new Set(entries
        .map(entry => ({
          id: entry.series.id,
          start: scheduledProbeTime(
            entry.series,
            nowMs,
            scheduledLiveProbeDelayMs,
            scheduledLiveProbeWindowMs
          )
        }))
        .filter((candidate): candidate is { id: string; start: number } => candidate.start !== null)
        .sort((left, right) => right.start - left.start)
        .slice(0, Math.max(0, scheduledLiveProbeLimit))
        .map(candidate => candidate.id));
      const completedProbeIds = new Set(entries
        .map(entry => ({
          id: entry.series.id,
          start: completedProbeTime(
            entry.series,
            nowMs,
            completedLiveProbeWindowMs
          )
        }))
        .filter((candidate): candidate is { id: string; start: number } => candidate.start !== null)
        .sort((left, right) => right.start - left.start)
        .slice(0, Math.max(0, completedLiveProbeLimit))
        .map(candidate => candidate.id));
      const resolved = await Promise.all(entries.map(entry => (
        resolveEntry(
          provider,
          entry,
          scheduledProbeIds.has(entry.series.id),
          completedProbeIds.has(entry.series.id)
        )
      )));
      return resolved.filter((entry): entry is LolProviderScheduleEntry => entry !== null);
    },
    getSnapshot: (gameId, after) => provider.getSnapshot(gameId, after),
    ...(provider.getSeriesContext
      ? { getSeriesContext: (seriesId: string) => provider.getSeriesContext!(seriesId) }
      : {})
  };
}
