export type DotaSide = 'radiant' | 'dire';

export interface DotaPlayerState {
  accountId: string | null;
  heroId: number;
  heroName: string | null;
  heroImageUrl: string | null;
  side: DotaSide;
  position: number;
}

export interface DotaTeamState {
  id: string;
  name: string;
  side: DotaSide;
  kills: number;
  players: readonly DotaPlayerState[];
}

export interface DotaStats {
  gameClockSeconds: number;
  radiant: DotaTeamState;
  dire: DotaTeamState;
  radiantNetWorthLead: number;
  spectators: number | null;
  broadcastDelaySeconds: number | null;
}
