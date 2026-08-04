import {
  LolAdapter,
  createCompletedInventoryProvider,
  createLeaguepediaHistoryFallbackProvider,
  createRiotCurrentPlayerProvider,
  createRiotDelayedLiveRecoveryProvider,
  createRiotLolConsistentProvider,
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

type Snapshot = Awaited<ReturnType<LolProviderClient['getSnapshot']>>;

interface GameInventoryProviders {
  state: string;
  primary: LolProviderClient;
  sourceWindowFallback: LolProviderClient | null;
}

function inventoryCount(snapshot: LolProviderSnapshot): number {
  if (!snapshot.stats) return 0;
  return [...snapshot.stats.blue.players, ...snapshot.stats.red.players]
    .reduce((total, player) => total + (player.items?.length ?? 0), 0);
}

/**
 * Keep Riot inventory probe state alive per game while selecting the correct
 * details clock from the first normalized snapshot.
 *
 * Live games first use Riot's wall-clock details frontier. Some delayed feeds
 * return inventory frames newer than the normalized scoreboard timestamp; the
 * current-player provider correctly refuses to merge those future frames. When
 * that leaves the whole board empty, retry through a persistent source-window
 * provider so the UI receives the newest inventory aligned to the scoreboard.
 * Completed games always use their final source window.
 */
export function createProductionInventoryProvider(
  base: LolProviderClient,
  options: ProductionInventoryProviderOptions = {}
): LolProviderClient {
  const inventoryWaitBudgetMs =
    options.inventoryWaitBudgetMs ?? LIVE_INVENTORY_SETTLE_BUDGET_MS;
  const sharedOptions = { ...options, inventoryWaitBudgetMs };
  const gameProviders = new Map<string, GameInventoryProviders>();

  function createPrimedBase(gameId: string, snapshot: Snapshot): LolProviderClient {
    let primedSnapshot: Snapshot | null = snapshot;
    return {
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
  }

  function createGameProviders(gameId: string, snapshot: Snapshot): GameInventoryProviders {
    const completed = snapshot.game.state === 'completed';
    const primary = createRiotCurrentPlayerProvider(createPrimedBase(gameId, snapshot), {
      ...sharedOptions,
      useWindowOverlay: completed
    });
    const sourceWindowFallback = completed
      ? null
      : createRiotCurrentPlayerProvider(createPrimedBase(gameId, snapshot), {
          ...sharedOptions,
          useWindowOverlay: true
        });
    return {
      state: snapshot.game.state,
      primary,
      sourceWindowFallback
    };
  }

  return {
    ...base,
    async getSnapshot(gameId: string, after?: string) {
      let entry = gameProviders.get(gameId);
      if (!entry) {
        const firstSnapshot = await base.getSnapshot(gameId, after);
        if (!firstSnapshot.stats || !firstSnapshot.sourceTimestamp) return firstSnapshot;
        entry = createGameProviders(gameId, firstSnapshot);
        gameProviders.set(gameId, entry);
      }

      let snapshot = await entry.primary.getSnapshot(gameId, after);
      if (
        snapshot.game.state !== 'completed'
        && inventoryCount(snapshot) === 0
        && entry.sourceWindowFallback
      ) {
        const fallbackSnapshot = await entry.sourceWindowFallback.getSnapshot(gameId, after);
        if (inventoryCount(fallbackSnapshot) > inventoryCount(snapshot)) {
          snapshot = fallbackSnapshot;
        }
      }

      if (snapshot.stats && snapshot.sourceTimestamp && snapshot.game.state !== entry.state) {
        gameProviders.set(gameId, createGameProviders(gameId, snapshot));
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
