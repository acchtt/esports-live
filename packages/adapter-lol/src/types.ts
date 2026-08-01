export type LolSide = 'blue' | 'red';

export interface LolObjectiveState {
  towers: number | null;
  inhibitors: number | null;
  dragons: readonly string[] | null;
  barons: number | null;
  heralds: number | null;
  grubs: number | null;
}

export interface LolPlayerState {
  id: string;
  handle: string | null;
  championId: string | null;
  role: string | null;
  level: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  creepScore: number | null;
  totalGold: number | null;
  items: readonly string[] | null;
}

export interface LolTeamState {
  id: string;
  name: string;
  side: LolSide;
  gold: number | null;
  kills: number | null;
  objectives: LolObjectiveState;
  players: readonly LolPlayerState[];
}

export interface LolStats {
  gameClockSeconds: number | null;
  patch: string | null;
  blue: LolTeamState;
  red: LolTeamState;
}
