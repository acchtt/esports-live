import {
  assessQuality,
  type EsportAdapter,
  type LiveSnapshot,
  type ProviderRef,
  type ScheduleEvent,
  type ScheduleQuery,
  type SeriesContext,
  type SeriesRef
} from '@esports-live/core';
import type { LolProviderClient, LolProviderSeries } from './provider.ts';
import type { LolStats } from './types.ts';

function providerRef(client: LolProviderClient): ProviderRef {
  return {
    id: client.id,
    name: client.name,
    ...(client.sourceUrl ? { sourceUrl: client.sourceUrl } : {})
  };
}

function seriesRef(series: LolProviderSeries): SeriesRef {
  return {
    id: series.id,
    esport: 'lol',
    competition: series.competition,
    teams: series.teams,
    bestOf: series.bestOf,
    state: series.state,
    scheduledStart: series.scheduledStart,
    games: series.games
  };
}

function withinRange(value: string, from?: string, to?: string): boolean {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  if (from && time < Date.parse(from)) return false;
  if (to && time > Date.parse(to)) return false;
  return true;
}

function competitionFilter(query: ScheduleQuery): ReadonlySet<string> {
  const ids = [
    ...(query.competitionIds ?? []),
    ...(query.competitionId ? [query.competitionId] : [])
  ];
  return new Set(ids);
}

export class LolAdapter implements EsportAdapter<LolStats> {
  readonly esport = 'lol' as const;
  readonly providerId: string;
  readonly getSeriesContext?: (seriesId: string) => Promise<SeriesContext>;
  readonly #provider: LolProviderClient;

  constructor(provider: LolProviderClient) {
    this.#provider = provider;
    this.providerId = provider.id;

    if (provider.getSeriesContext) {
      this.getSeriesContext = async (seriesId: string): Promise<SeriesContext> => {
        const context = await provider.getSeriesContext!(seriesId);
        return {
          schemaVersion: '1.0',
          esport: 'lol',
          seriesId: context.seriesId,
          provider: providerRef(provider),
          observedAt: context.observedAt,
          rosters: context.rosters,
          standings: context.standings,
          complete: context.complete,
          reasons: context.reasons ?? []
        };
      };
    }
  }

  async getSchedule(query: ScheduleQuery = {}): Promise<readonly ScheduleEvent[]> {
    const entries = await this.#provider.getSchedule();
    const competitions = competitionFilter(query);
    return entries
      .filter(entry => withinRange(entry.series.scheduledStart, query.from, query.to))
      .filter(entry => competitions.size === 0 || competitions.has(entry.series.competition.id))
      .filter(entry => !query.states?.length || query.states.includes(entry.series.state))
      .map(entry => ({
        series: seriesRef(entry.series),
        provider: providerRef(this.#provider),
        observedAt: entry.observedAt
      }));
  }

  async getLiveSnapshot(gameId: string, after?: string): Promise<LiveSnapshot<LolStats>> {
    const raw = await this.#provider.getSnapshot(gameId, after);
    const complete = raw.complete && raw.stats !== null;
    const quality = assessQuality({
      sourceTimestamp: raw.sourceTimestamp,
      observedAt: raw.observedAt,
      complete,
      advancing: raw.advancing,
      ...(raw.reasons ? { reasons: raw.reasons } : {})
    });

    return {
      schemaVersion: '1.0',
      esport: 'lol',
      provider: providerRef(this.#provider),
      series: seriesRef(raw.series),
      game: raw.game,
      stats: raw.stats,
      quality
    };
  }
}
