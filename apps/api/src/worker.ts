import {
  LolAdapter,
  createCompletedInventoryProvider,
  createLeaguepediaHistoryFallbackProvider,
  createRiotCurrentPlayerProvider,
  createRiotDelayedLiveRecoveryProvider,
  createRiotFinalityProvider,
  createRiotLolConsistentProvider,
  createRiotSupplementalLeagueProvider,
  createUsableScheduleProvider,
  type LolProviderClient,
  type LolProviderSnapshot,
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
 * Keep Riot inventory probe state alive across snapshot requests.
 *
 * The normalized snapshot is loaded once, then supplied to one of two
 * persistent enrichment providers. Live games probe Riot's wall-clock details
 * frontier; completed games probe the final source window. Keeping both
 * providers alive preserves their adaptive delay and cached inventories while
 * routing the first completed snapshot correctly.
 */
export function createProductionInventoryProvider(
  base: LolProviderClient,
  options: ProductionInventoryProviderOptions = {}
): LolProviderClient {
  const inventoryWaitBudgetMs =
    options.inventoryWaitBudgetMs ?? LIVE_INVENTORY_SETTLE_BUDGET_MS;
  const sharedOptions = { ...options, inventoryWaitBudgetMs };
  const snapshots = new Map<string, LolProviderSnapshot>();
  const snapshotProvider: LolProviderClient = {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      return snapshots.get(gameId) ?? base.getSnapshot(gameId, after);
    }
  };
  const liveInventoryProvider = createRiotCurrentPlayerProvider(snapshotProvider, {
    ...sharedOptions,
    useWindowOverlay: false
  });
  const completedInventoryProvider = createRiotCurrentPlayerProvider(snapshotProvider, {
    ...sharedOptions,
    useWindowOverlay: true
  });

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      const snapshot = await base.getSnapshot(gameId, after);
      snapshots.set(gameId, snapshot);
      const provider = snapshot.game.state === 'completed'
        ? completedInventoryProvider
        : liveInventoryProvider;
      return provider.getSnapshot(gameId, after);
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
    const riotProvider = createRiotFinalityProvider(
      createRiotDelayedLiveRecoveryProvider(
        createRiotSupplementalLeagueProvider(
          createRiotLolConsistentProvider({
            apiKey,
            includeDetails: false,
            useDetailItemFallback: false
          }),
          { apiKey }
        )
      ),
      { apiKey }
    );
    const provider = createUsableScheduleProvider(
      createLeaguepediaHistoryFallbackProvider(
        createCompletedInventoryProvider(
          createProductionInventoryProvider(riotProvider)
        )
      )
    );
    registry.register(new CachedAdapter(new LolAdapter(provider), {
      scheduleTtlMs: 15_000,
      liveSnapshotTtlMs: 400,
      seriesContextTtlMs: 10_000
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
