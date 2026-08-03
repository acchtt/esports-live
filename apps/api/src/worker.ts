import {
  LolAdapter,
  createCompletedInventoryProvider,
  createLeaguepediaHistoryFallbackProvider,
  createRiotCurrentPlayerProvider,
  createRiotLolConsistentProvider,
  createUsableScheduleProvider
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

let cachedApiKey: string | null = null;
let cachedHandler: ApiHandler | null = null;

export function createWorkerHandler(env: WorkerEnv): ApiHandler {
  const apiKey = env.LOL_ESPORTS_API_KEY?.trim() ?? '';
  if (cachedHandler && cachedApiKey === apiKey) return cachedHandler;

  const registry = new AdapterRegistry();
  if (apiKey) {
    const provider = createUsableScheduleProvider(
      createLeaguepediaHistoryFallbackProvider(
        createCompletedInventoryProvider(
          createRiotCurrentPlayerProvider(
            createRiotLolConsistentProvider({
              apiKey,
              includeDetails: false,
              useDetailItemFallback: false
            }),
            {
              // Derive the inventory probe from Riot's newest live-window timestamp.
              // Wall-clock anchors can be ahead of delayed broadcasts and return no
              // detail frames, leaving every player inventory empty.
              useWindowOverlay: true,
              inventoryWaitBudgetMs: LIVE_INVENTORY_SETTLE_BUDGET_MS
            }
          )
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
