import type { LolProviderClient, LolProviderScheduleEntry, LolProviderSeries } from './provider.ts';

function hasPlaceholderTeam(series: LolProviderSeries): boolean {
  return series.teams.some((team, index) => (
    team.id === `team-${index + 1}` || team.name === `Team ${index + 1}`
  ));
}

function isUsableLiveSeries(series: LolProviderSeries): boolean {
  return !hasPlaceholderTeam(series) && series.games.length > 0;
}

async function resolveSparseEntry(
  provider: LolProviderClient,
  entry: LolProviderScheduleEntry
): Promise<LolProviderScheduleEntry | null> {
  const { series } = entry;
  if (series.state !== 'live' && series.state !== 'paused') return entry;
  if (isUsableLiveSeries(series)) return entry;
  if (!provider.getSeriesContext) return null;

  try {
    const context = await provider.getSeriesContext(series.id);
    const history = context.history;
    if (!history || history.score.length < 2 || !history.games.length) return null;

    const resolvedSeries: LolProviderSeries = {
      ...series,
      teams: [history.score[0]!.team, history.score[1]!.team],
      bestOf: history.bestOf,
      games: history.games
        .map(game => ({ id: game.id, number: game.number, state: game.state }))
        .sort((left, right) => left.number - right.number)
    };
    return isUsableLiveSeries(resolvedSeries) ? { ...entry, series: resolvedSeries } : null;
  } catch {
    return null;
  }
}

export function createUsableScheduleProvider(provider: LolProviderClient): LolProviderClient {
  return {
    id: provider.id,
    name: provider.name,
    ...(provider.sourceUrl ? { sourceUrl: provider.sourceUrl } : {}),
    async getSchedule(): Promise<readonly LolProviderScheduleEntry[]> {
      const entries = await provider.getSchedule();
      const resolved = await Promise.all(entries.map(entry => resolveSparseEntry(provider, entry)));
      return resolved.filter((entry): entry is LolProviderScheduleEntry => entry !== null);
    },
    getSnapshot: (gameId, after) => provider.getSnapshot(gameId, after),
    ...(provider.getSeriesContext
      ? { getSeriesContext: (seriesId: string) => provider.getSeriesContext!(seriesId) }
      : {})
  };
}
