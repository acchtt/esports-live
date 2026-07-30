export type LolSide = 'blue' | 'red';

export interface LolObjectiveState {
  towers: number;
  inhibitors: number;
  dragons: readonly string[];
  barons: number;
  heralds: number;
}

export interface LolPlayerState {
  id: string;
  handle: string;
  championId: string;
  role: string;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  totalGold: number;
  items: readonly string[];
}

export interface LolTeamState {
  id: string;
  name: string;
  side: LolSide;
  gold: number;
  kills: number;
  objectives: LolObjectiveState;
  players: readonly LolPlayerState[];
}

export interface LolStats {
  gameClockSeconds: number;
  patch: string | null;
  blue: LolTeamState;
  red: LolTeamState;
}
