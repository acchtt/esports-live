import type {
  CompetitionRef,
  GameState,
  QualityReason,
  SeriesState,
  TeamRef
} from '@esports-live/core';
import type { LolStats } from './types.ts';

export interface LolProviderGame {
  id: string;
  number: number;
  state: GameState;
}

export interface LolProviderSeries {
  id: string;
  competition: CompetitionRef;
  teams: readonly [TeamRef, TeamRef];
  bestOf: number;
  state: SeriesState;
  scheduledStart: string;
  games: readonly LolProviderGame[];
}

export interface LolProviderScheduleEntry {
  series: LolProviderSeries;
  observedAt: string;
}

export interface LolProviderSnapshot {
  series: LolProviderSeries;
  game: LolProviderGame;
  sourceTimestamp: string | null;
  observedAt: string;
  advancing: boolean | null;
  complete: boolean;
  stats: LolStats | null;
  reasons?: readonly QualityReason[];
}

export interface LolProviderClient {
  readonly id: string;
  readonly name: string;
  readonly sourceUrl?: string;

  getSchedule(): Promise<readonly LolProviderScheduleEntry[]>;
  getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot>;
}
