import {
  LolAdapter,
  createCompletedInventoryProvider,
  createLeaguepediaHistoryFallbackProvider,
  createRiotCurrentPlayerProvider,
  createRiotDelayedLiveRecoveryProvider,
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
 * Keep Riot inventory probe state alive across snapshot requests.
 *
 * Live games use Riot's wall-clock details frontier. Completed games use the
 * final source window instead. The two persistent provider instances retain
 * their adaptive detail delay and cached inventory observations; recreating an
 * enrichment provider for every request prevented that frontier from ever
 * moving far enough to find inventories on delayed live feeds.
 */
export function createProductionInventoryProvider(
  base: LolProviderClient,
  options: ProductionInventoryProviderOptions = {}
): LolProviderClient {
  const inventoryWaitBudgetMs =
    options.inventoryWaitBudgetMs ?? LIVE_INVENTORY_SETTLE_BUDGET_MS;
  const sharedOptions = { ...options, inventoryWaitBudgetMs };
  const liveInventoryProvider = createRiotCurrentPlayerProvider(base, {
    ...sharedOptions,
    useWindowOverlay: false
  });
  const completedInventoryProvider = createRiotCurrentPlayerProvider(base, {
    ...sharedOptions,
    useWindowOverlay: true
  });
  const gameStates = new Map<string, string>();

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      const provider = gameStates.get(gameId) === 'completed'
        ? completedInventoryProvider
        : liveInventoryProvider;
      const snapshot = await provider.getSnapshot(gameId, after);
      gameStates.set(gameId, snapshot.game.state);
      return snapshot;
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
    const riotProvider = createRiotDelayedLiveRecoveryProvider(
      createRiotLolConsistentProvider({
        apiKey,
        includeDetails: false,
        useDetailItemFallback: false
      })
    );
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