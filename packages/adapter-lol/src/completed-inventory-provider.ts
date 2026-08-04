import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';

const DEFAULT_RETRY_DELAYS_MS = [750, 1_500, 2_500] as const;

export interface CompletedInventoryProviderOptions {
  retryDelaysMs?: readonly number[];
  sleep?: (delayMs: number) => Promise<void>;
}

interface InventoryCoverage {
  resolved: number;
  total: number;
}

function inventoryCoverage(snapshot: LolProviderSnapshot): InventoryCoverage {
  if (!snapshot.stats) return { resolved: 0, total: 0 };
  const players = [...snapshot.stats.blue.players, ...snapshot.stats.red.players];
  return {
    resolved: players.filter(player => Array.isArray(player.items) && player.items.length > 0).length,
    total: players.length
  };
}

function needsCompletedInventoryRetry(snapshot: LolProviderSnapshot): boolean {
  if (snapshot.game.state !== 'completed' || !snapshot.stats) return false;
  const coverage = inventoryCoverage(snapshot);
  return coverage.total > 0 && coverage.resolved < coverage.total;
}

function preferInventoryCoverage(
  current: LolProviderSnapshot,
  candidate: LolProviderSnapshot
): LolProviderSnapshot {
  return inventoryCoverage(candidate).resolved > inventoryCoverage(current).resolved
    ? candidate
    : current;
}

export function createCompletedInventoryProvider(
  base: LolProviderClient,
  options: CompletedInventoryProviderOptions = {}
): LolProviderClient {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      let best = await base.getSnapshot(gameId, after);
      if (!needsCompletedInventoryRetry(best)) return best;

      for (const delayMs of retryDelaysMs) {
        if (delayMs > 0) await sleep(delayMs);
        try {
          const candidate = await base.getSnapshot(gameId);
          best = preferInventoryCoverage(best, candidate);
        } catch {
          // Preserve the usable final frame when optional enrichment retries fail.
        }
        if (!needsCompletedInventoryRetry(best)) break;
      }

      return best;
    }
  };
}
