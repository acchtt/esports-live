import {
  LolAdapter,
  createCompletedInventoryProvider,
  createLeaguepediaHistoryFallbackProvider,
  createRiotCurrentPlayerProvider,
  createRiotLolConsistentProvider,
  createUsableScheduleProvider,
  type LolProviderClient,
  type RiotCurrentPlayerProviderOptions
} from '@esports-live/adapter-lol';
import { AdapterRegistry, CachedAdapter } from '@esports-live/core';
import { createApiHandler } from './router.ts';

export interface WorkerEnv {
  LOL_ESPORTS_API_KEY?: string;
}

type ApiHandler = (request: Request) => Promise<Response>;

// Riot inventory enrichment can issue one primary and one fallback details
// request. Each request is capped at three seconds by the provider. Keep the
// Worker invocation alive long enough for that bounded probe to settle so the
// response does not leave a floating promise that Cloudflare may cancel.
export const LIVE_INVENTORY_SETTLE_BUDGET_MS = 6_500;

export type ProductionInventoryProviderOptions = Omit<
  RiotCurrentPlayerProviderOptions,
  'useWindowOverlay'
>;

/**
 * Select the inventory clock independently from the normalized scoreboard.
 *
 * Riot's public live clients request details using wall-clock timestamps. An
 * unanchored window response can contain an initial or otherwise stale frame,
 * which makes an inventory probe miss even while the base scoreboard is
 * current. Completed games still need their final source timestamp because a
 * wall-clock request after the game has ended can be outside the feed window.
 */
export function createProductionInventoryProvider(
  base: LolProviderClient,
  options: ProductionInventoryProviderOptions = {}
): LolProviderClient {
  return {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      const snapshot = await base.getSnapshot(gameId, after);
      if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;

      const snapshotProvider: LolProviderClient = {
        ...base,
        async getSnapshot() {
          return snapshot;
        }
      };

      const inventoryProvider = createRiotCurrentPlayerProvider(snapshotProvider, {
        ...options,
        // Live details use the same wall-clock frontier as Riot's public web
        // clients. Final games use the source window so history still resolves.
        useWindowOverlay: snapshot.game.state === 'completed',
        inventoryWaitBudgetMs:
          options.inventoryWaitBudgetMs ?? LIVE_INVENTORY_SETTLE_BUDGET_MS
      });

      return inventoryProvider.getSnapshot(gameId, after);
    }
  };
}

let cachedApiKey: string | null = null;
let cachedHandler: ApiHandler | null = null;

export function createWorkerHandler(env: WorkerEnv): ApiHandler {
  const apiKey = env.LOL_ESPORTS_API_KEY?.trim() ?? '';
  if (cachedHandler && cachedApiKey === apiKey) return cachedHandler;

  const registry = new AdapterRegistry();
  if (apiKey) {
    const riotProvider = createRiotLolConsistentProvider({
      apiKey,
      includeDetails: false,
      useDetailItemFallback: false
    });
    const provider = createUsableScheduleProvider(
      createLeaguepediaHistoryFallbackProvider(
        createCompletedInventoryProvider(
          createProductionInventoryProvider(riotProvider)
        )
      )
    );
    registry.register(new CachedAdapter(new LolAdapter(provider), {
      scheduleTtlMs: 45_000,
      liveSnapshotTtlMs: 400,
      seriesContextTtlMs: 45_000
    }));
  }

  cachedApiKey = apiKey;
  cachedHandler = createApiHandler(registry);
  return cachedHandler;
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return createWorkerHandler(env)(request);
  }
};
