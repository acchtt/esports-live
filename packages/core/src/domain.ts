export type EsportId = 'lol' | 'cs2' | 'dota2' | (string & {});

export type SeriesState = 'scheduled' | 'live' | 'paused' | 'completed' | 'cancelled' | 'unknown';
export type GameState = 'unstarted' | 'draft' | 'live' | 'paused' | 'completed' | 'unknown';
export type Freshness = 'fresh' | 'degraded' | 'stale' | 'unavailable';

export interface ProviderRef {
  id: string;
  name: string;
  sourceUrl?: string;
}

export interface CompetitionRef {
  id: string;
  name: string;
  region?: string;
  stage?: string;
}

export interface TeamRef {
  id: string;
  name: string;
  code?: string;
  imageUrl?: string;
}

export interface PlayerRef {
  id: string;
  handle: string;
  teamId?: string;
  role?: string;
}

export interface SeriesGameRef {
  id: string;
  number: number;
  state: GameState;
}

export interface SeriesRef {
  id: string;
  esport: EsportId;
  competition: CompetitionRef;
  teams: readonly [TeamRef, TeamRef];
  bestOf: number;
  state: SeriesState;
  scheduledStart: string;
  games: readonly SeriesGameRef[];
}

export interface ScheduleEvent {
  series: SeriesRef;
  provider: ProviderRef;
  observedAt: string;
}

export interface QualityReason {
  code: string;
  message: string;
  field?: string;
}

export interface TelemetryQuality {
  freshness: Freshness;
  sourceTimestamp: string | null;
  observedAt: string;
  ageSeconds: number | null;
  complete: boolean;
  advancing: boolean | null;
  safeForLiveAnalysis: boolean;
  reasons: readonly QualityReason[];
}

export interface LiveSnapshot<TStats = unknown> {
  schemaVersion: '1.0';
  esport: EsportId;
  provider: ProviderRef;
  series: SeriesRef;
  game: SeriesGameRef;
  stats: TStats | null;
  quality: TelemetryQuality;
}
