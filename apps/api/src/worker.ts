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
 * Keep Riot inventory probe state alive per game while selecting the correct
 * details clock from the first normalized snapshot.
 *
 * Live games use Riot's wall-clock details frontier. Completed games use their
 * final source window. Priming each game-scoped provider with the snapshot used
 * to choose that mode prevents an extra base request and ensures a completed
 * game receives a source-window probe on its first enrichment pass.
 */
export function createProductionInventoryProvider(
  base: LolProviderClient,
  options: ProductionInventoryProviderOptions = {}
): LolProviderClient {
  const inventoryWaitBudgetMs =
    options.inventoryWaitBudgetMs ?? LIVE_INVENTORY_SETTLE_BUDGET_MS;
  const sharedOptions = { ...options, inventoryWaitBudgetMs };
  const gameProviders = new Map<string, {
    state: string;
    provider: LolProviderClient;
  }>();

  function createGameProvider(
    gameId: string,
    snapshot: Awaited<ReturnType<LolProviderClient['getSnapshot']>>
  ): LolProviderClient {
    let primedSnapshot: Awaited<ReturnType<LolProviderClient['getSnapshot']>> | null = snapshot;
    const snapshotBase: LolProviderClient = {
      ...base,
      async getSnapshot(requestedGameId: string, after?: string) {
        if (requestedGameId === gameId && primedSnapshot) {
          const value = primedSnapshot;
          primedSnapshot = null;
          return value;
        }
        return base.getSnapshot(requestedGameId, after);
      }
    };

    return createRiotCurrentPlayerProvider(snapshotBase, {
      ...sharedOptions,
      useWindowOverlay: snapshot.game.state === 'completed'
    });
  }

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      let entry = gameProviders.get(gameId);
      if (!entry) {
        const firstSnapshot = await base.getSnapshot(gameId, after);
        if (!firstSnapshot.stats || !firstSnapshot.sourceTimestamp) return firstSnapshot;
        entry = {
          state: firstSnapshot.game.state,
          provider: createGameProvider(gameId, firstSnapshot)
        };
        gameProviders.set(gameId, entry);
      }

      const snapshot = await entry.provider.getSnapshot(gameId, after);
      if (snapshot.stats && snapshot.sourceTimestamp && snapshot.game.state !== entry.state) {
        gameProviders.set(gameId, {
          state: snapshot.game.state,
          provider: createGameProvider(gameId, snapshot)
        });
      }
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
