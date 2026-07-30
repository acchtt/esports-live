import type { EsportId, LiveSnapshot, ScheduleEvent } from './domain.ts';

export interface ScheduleQuery {
  from?: string;
  to?: string;
  competitionId?: string;
  states?: readonly string[];
}

export interface EsportAdapter<TStats = unknown> {
  readonly esport: EsportId;
  readonly providerId: string;

  getSchedule(query?: ScheduleQuery): Promise<readonly ScheduleEvent[]>;
  getLiveSnapshot(gameId: string, after?: string): Promise<LiveSnapshot<TStats>>;
}

export class AdapterRegistry {
  readonly #adapters = new Map<EsportId, EsportAdapter>();

  register(adapter: EsportAdapter): void {
    if (this.#adapters.has(adapter.esport)) {
      throw new Error(`Adapter already registered for esport: ${adapter.esport}`);
    }
    this.#adapters.set(adapter.esport, adapter);
  }

  get(esport: EsportId): EsportAdapter {
    const adapter = this.#adapters.get(esport);
    if (!adapter) throw new Error(`No adapter registered for esport: ${esport}`);
    return adapter;
  }

  list(): readonly EsportId[] {
    return [...this.#adapters.keys()];
  }
}
