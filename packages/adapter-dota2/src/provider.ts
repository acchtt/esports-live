import type {
  CompetitionRef,
  QualityReason,
  SeriesRef
} from '@esports-live/core';
import type { DotaStats } from './types.ts';

export interface DotaProviderGame {
  id: string;
  number: number;
  state: 'draft' | 'live' | 'completed';
}

export interface DotaProviderSeries extends Omit<SeriesRef, 'esport' | 'games'> {
  competition: CompetitionRef;
  games: readonly DotaProviderGame[];
}

export interface DotaProviderScheduleEntry {
  series: DotaProviderSeries;
  observedAt: string;
}

export interface DotaProviderSnapshot {
  series: DotaProviderSeries;
  game: DotaProviderGame;
  sourceTimestamp: string | null;
  observedAt: string;
  advancing: boolean | null;
  complete: boolean;
  stats: DotaStats | null;
  reasons?: readonly QualityReason[];
}

export interface DotaProviderClient {
  readonly id: string;
  readonly name: string;
  readonly sourceUrl?: string;

  getSchedule(): Promise<readonly DotaProviderScheduleEntry[]>;
  getSnapshot(gameId: string, after?: string): Promise<DotaProviderSnapshot>;
}
