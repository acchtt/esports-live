import type { LolProviderClient } from './provider.ts';
import type { LolPlayerState, LolStats, LolTeamState } from './types.ts';

function completeChampionKillTotal(players: readonly LolPlayerState[]): number | null {
  if (players.length !== 5) return null;

  let total = 0;
  for (const player of players) {
    const kills = player.kills;
    if (kills === null || !Number.isInteger(kills) || kills < 0) return null;
    total += kills;
  }
  return total;
}

function correctTeamKills(team: LolTeamState): LolTeamState {
  const championKills = completeChampionKillTotal(team.players);
  if (championKills === null || championKills === team.kills) return team;
  return { ...team, kills: championKills };
}

function correctStats(stats: LolStats): LolStats {
  const blue = correctTeamKills(stats.blue);
  const red = correctTeamKills(stats.red);
  if (blue === stats.blue && red === stats.red) return stats;
  return { ...stats, blue, red };
}

/**
 * Riot's team-level kill aggregate can include executions even though no enemy
 * champion received a kill. When a complete five-player K/D/A board is
 * available, the sum of player champion kills is the authoritative team total.
 * In incomplete telemetry, keep the provider's reported aggregate unchanged.
 */
export function createChampionKillProvider(base: LolProviderClient): LolProviderClient {
  return {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      const snapshot = await base.getSnapshot(gameId, after);
      if (!snapshot.stats) return snapshot;
      const stats = correctStats(snapshot.stats);
      return stats === snapshot.stats ? snapshot : { ...snapshot, stats };
    }
  };
}
