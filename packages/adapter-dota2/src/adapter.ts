import {
  assessQuality,
  type EsportAdapter,
  type LiveSnapshot,
  type ProviderRef,
  type ScheduleEvent,
  type ScheduleQuery,
  type SeriesRef
} from '@esports-live/core';
import type { DotaProviderClient, DotaProviderSeries } from './provider.ts';
import type { DotaStats } from './types.ts';

function providerRef(client: DotaProviderClient): ProviderRef {
  return {
    id: client.id,
    name: client.name,
    ...(client.sourceUrl ? { sourceUrl: client.sourceUrl } : {})
  };
}

function seriesRef(series: DotaProviderSeries): SeriesRef {
  return {
    ...series,
    esport: 'dota2'
  };
}

function competitionIds(query: ScheduleQuery): ReadonlySet<string> {
  return new Set([
    ...(query.competitionIds ?? []),
    ...(query.competitionId ? [query.competitionId] : [])
  ]);
}

function withinRange(value: string, from?: string, to?: string): boolean {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  if (from && time < Date.parse(from)) return false;
  if (to && time > Date.parse(to)) return false;
  return true;
}

export class DotaAdapter implements EsportAdapter<DotaStats> {
  readonly esport = 'dota2' as const;
  readonly providerId: string;
  readonly #provider: DotaProviderClient;

  constructor(provider: DotaProviderClient) {
    this.#provider = provider;
    this.providerId = provider.id;
  }

  async getSchedule(query: ScheduleQuery = {}): Promise<readonly ScheduleEvent[]> {
    const entries = await this.#provider.getSchedule();
    const competitions = competitionIds(query);
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

  async getLiveSnapshot(gameId: string, after?: string): Promise<LiveSnapshot<DotaStats>> {
    const raw = await this.#provider.getSnapshot(gameId, after);
    const complete = raw.complete && raw.stats !== null;
    return {
      schemaVersion: '1.0',
      esport: 'dota2',
      provider: providerRef(this.#provider),
      series: seriesRef(raw.series),
      game: raw.game,
      stats: raw.stats,
      quality: assessQuality({
        sourceTimestamp: raw.sourceTimestamp,
        observedAt: raw.observedAt,
        complete,
        advancing: raw.advancing,
        ...(raw.reasons ? { reasons: raw.reasons } : {})
      })
    };
  }
}
