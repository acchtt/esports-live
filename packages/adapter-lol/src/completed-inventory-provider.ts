import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';

const DEFAULT_RETRY_DELAYS_MS = [750, 1_500, 2_500] as const;
const MAX_REMEMBERED_GAMES = 64;

export interface CompletedInventoryProviderOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
}

interface InventoryCoverage {
  resolved: number;
  total: number;
}

type InventoryMemory = Map<string, readonly string[]>;

function hasInventory(items: readonly string[] | null | undefined): items is readonly string[] {
  return Array.isArray(items) && items.length > 0;
}

function inventoryCoverage(snapshot: LolProviderSnapshot): InventoryCoverage {
  if (!snapshot.stats) return { resolved: 0, total: 0 };
  const players = [...snapshot.stats.blue.players, ...snapshot.stats.red.players];
  return {
    resolved: players.filter(player => hasInventory(player.items)).length,
    total: players.length
  };
}

function needsCompletedInventoryRetry(snapshot: LolProviderSnapshot): boolean {
  if (snapshot.game.state !== 'completed' || !snapshot.stats) return false;
  const coverage = inventoryCoverage(snapshot);
  return coverage.total > 0 && coverage.resolved < coverage.total;
}

function applyRememberedInventories(
  snapshot: LolProviderSnapshot,
  memory: InventoryMemory
): LolProviderSnapshot {
  if (!snapshot.stats) return snapshot;

  for (const team of [snapshot.stats.blue, snapshot.stats.red]) {
    for (const player of team.players) {
      if (hasInventory(player.items)) memory.set(player.id, [...player.items]);
    }
  }

  const mergeTeam = (team: typeof snapshot.stats.blue) => ({
    ...team,
    players: team.players.map(player => {
      if (hasInventory(player.items)) return player;
      const remembered = memory.get(player.id);
      return remembered ? { ...player, items: remembered } : player;
    })
  });

  return {
    ...snapshot,
    stats: {
      ...snapshot.stats,
      blue: mergeTeam(snapshot.stats.blue),
      red: mergeTeam(snapshot.stats.red)
    }
  };
}

export function createCompletedInventoryProvider(
  base: LolProviderClient,
  options: CompletedInventoryProviderOptions = {}
): LolProviderClient {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  const rememberedInventories = new Map<string, InventoryMemory>();

  const memoryFor = (gameId: string): InventoryMemory => {
    const existing = rememberedInventories.get(gameId);
    if (existing) {
      rememberedInventories.delete(gameId);
      rememberedInventories.set(gameId, existing);
      return existing;
    }

    const created: InventoryMemory = new Map();
    rememberedInventories.set(gameId, created);
    while (rememberedInventories.size > MAX_REMEMBERED_GAMES) {
      const oldest = rememberedInventories.keys().next().value as string | undefined;
      if (!oldest) break;
      rememberedInventories.delete(oldest);
    }
    return created;
  };

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const memory = memoryFor(gameId);
      let best = applyRememberedInventories(await base.getSnapshot(gameId, after), memory);
      if (!needsCompletedInventoryRetry(best)) return best;

      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) await sleep(delayMs);
        try {
          applyRememberedInventories(await base.getSnapshot(gameId), memory);
          best = applyRememberedInventories(best, memory);
        } catch {
          // Preserve the usable final frame and any inventories already observed for this game.
        }
        if (!needsCompletedInventoryRetry(best)) break;
      }

      return best;
    }
  };
}
