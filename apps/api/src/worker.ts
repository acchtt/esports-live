import {
  LolAdapter,
  createChampionKillProvider,
  createCompletedInventoryProvider,
  createLeaguepediaHistoryFallbackProvider,
  createRiotCurrentPlayerProvider,
  createRiotDelayedLiveRecoveryProvider,
  createRiotFinalityProvider,
  createRiotLolConsistentProvider,
  createRiotScheduleReconciliationProvider,
  createRiotSupplementalLeagueProvider,
  createUsableScheduleProvider,
  type LolProviderClient,
  type LolProviderSnapshot,
  type RiotCurrentPlayerProviderOptions
} from '@esports-live/adapter-lol';
import {
  DotaAdapter,
  createFallbackDotaProvider,
  createOpenDotaProvider,
  createSteamDotaProvider
} from '@esports-live/adapter-dota2';
import { AdapterRegistry, CachedAdapter } from '@esports-live/core';
import { createGrubsCvProvider } from './grubs-cv-provider.ts';
import { createApiHandler } from './router.ts';

export interface WorkerEnv {
  LOL_ESPORTS_API_KEY?: string;
  OPENDOTA_API_KEY?: string;
  STEAM_API_KEY?: string;
  GRUBS_CV_URL?: string;
  GRUBS_CV_TOKEN?: string;
  GRUBS_CV_MIN_CONFIDENCE?: string;
  GRUBS_CV_ALLOW_SIMULATED?: string;
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

interface SourceAlignedInventoryProvider {
  provider: LolProviderClient;
  prime(snapshot: Snapshot): void;
}

interface GameInventoryProviders {
  state: string;
  primary: LolProviderClient | null;
  sourceAligned: SourceAlignedInventoryProvider;
}

function inventoryCount(snapshot: LolProviderSnapshot): number {
  if (!snapshot.stats) return 0;
  return [...snapshot.stats.blue.players, ...snapshot.stats.red.players]
    .reduce((total, player) => total + (player.items?.length ?? 0), 0);
}

function sourceTimestampMs(snapshot: Snapshot): number | null {
  const parsed = Date.parse(snapshot.sourceTimestamp ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function confidenceEnv(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.9;
}

function booleanEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
}

/**
 * Keep Riot inventory probe state alive per game while selecting the correct
 * details clock from the normalized snapshot.
 *
 * Live games first use Riot's wall-clock details frontier. Some delayed feeds
 * expose a scoreboard timestamp well behind wall clock, so those probes can
 * return detail frames that are rejected as future data. When the whole board
 * remains empty, a persistent source-aligned provider probes from the exact
 * normalized snapshot timestamp instead of relying on Riot's unanchored window.
 * Completed games always use that source-aligned provider.
 */
export function createProductionInventoryProvider(
  base: LolProviderClient,
  options: ProductionInventoryProviderOptions = {}
): LolProviderClient {
  const inventoryWaitBudgetMs =
    options.inventoryWaitBudgetMs ?? LIVE_INVENTORY_SETTLE_BUDGET_MS;
  const sharedOptions = { ...options, inventoryWaitBudgetMs };
  const fallbackNow = options.now ?? (() => new Date());
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

  function createSourceAlignedProvider(
    gameId: string,
    initialSnapshot: Snapshot
  ): SourceAlignedInventoryProvider {
    let primedSnapshot: Snapshot | null = initialSnapshot;
    let targetMs = sourceTimestampMs(initialSnapshot);
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
    const provider = createRiotCurrentPlayerProvider(snapshotBase, {
      ...sharedOptions,
      now: () => targetMs === null ? fallbackNow() : new Date(targetMs),
      useWindowOverlay: false
    });
    return {
      provider,
      prime(snapshot: Snapshot) {
        primedSnapshot = snapshot;
        targetMs = sourceTimestampMs(snapshot);
      }
    };
  }

  function createGameProviders(gameId: string, snapshot: Snapshot): GameInventoryProviders {
    const completed = snapshot.game.state === 'completed';
    return {
      state: snapshot.game.state,
      primary: completed
        ? null
        : createRiotCurrentPlayerProvider(createPrimedBase(gameId, snapshot), {
            ...sharedOptions,
            useWindowOverlay: false
          }),
      sourceAligned: createSourceAlignedProvider(gameId, snapshot)
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

      let snapshot: Snapshot;
      if (entry.primary) {
        snapshot = await entry.primary.getSnapshot(gameId, after);
        if (inventoryCount(snapshot) === 0) {
          entry.sourceAligned.prime(snapshot);
          const fallbackSnapshot = await entry.sourceAligned.provider.getSnapshot(gameId, after);
          if (inventoryCount(fallbackSnapshot) > inventoryCount(snapshot)) {
            snapshot = fallbackSnapshot;
          }
        }
      } else {
        snapshot = await entry.sourceAligned.provider.getSnapshot(gameId, after);
      }

      if (snapshot.stats && snapshot.sourceTimestamp && snapshot.game.state !== entry.state) {
        gameProviders.set(gameId, createGameProviders(gameId, snapshot));
      }
      return snapshot;
    }
  };
}

/**
 * Schedule reconciliation only needs authoritative game state, not the full
 * player/item/history enrichment stack used by match scoreboards. Keep the rich
 * provider for schedule/context data and regular snapshots, but route the
 * reconciliation snapshot probes through the lightweight Riot provider. Also
 * coalesce concurrent catalogue schedule reads so active and completed requests
 * do not repeat the same full reconciliation work inside one Worker isolate.
 */
export function createProductionScheduleProvider(
  enrichedProvider: LolProviderClient,
  lightweightSnapshotProvider: LolProviderClient
): LolProviderClient {
  const scheduleProbeProvider: LolProviderClient = {
    ...enrichedProvider,
    getSnapshot(gameId: string, after?: string) {
      return lightweightSnapshotProvider.getSnapshot(gameId, after);
    }
  };
  const usableScheduleProvider = createUsableScheduleProvider(scheduleProbeProvider);
  let scheduleInFlight: ReturnType<LolProviderClient['getSchedule']> | null = null;

  return {
    ...enrichedProvider,
    getSchedule() {
      if (scheduleInFlight) return scheduleInFlight;
      const request = usableScheduleProvider.getSchedule();
      scheduleInFlight = request;
      void request.then(
        () => {
          if (scheduleInFlight === request) scheduleInFlight = null;
        },
        () => {
          if (scheduleInFlight === request) scheduleInFlight = null;
        }
      );
      return request;
    }
  };
}

let cachedConfigKey: string | null = null;
let cachedHandler: ApiHandler | null = null;

export function createWorkerHandler(env: WorkerEnv): ApiHandler {
  const apiKey = env.LOL_ESPORTS_API_KEY?.trim() ?? '';
  const openDotaApiKey = env.OPENDOTA_API_KEY?.trim() ?? '';
  const steamApiKey = env.STEAM_API_KEY?.trim() ?? '';
  const grubsCvUrl = env.GRUBS_CV_URL?.trim() ?? '';
  const grubsCvToken = env.GRUBS_CV_TOKEN?.trim() ?? '';
  const grubsCvMinConfidence = confidenceEnv(env.GRUBS_CV_MIN_CONFIDENCE);
  const grubsCvAllowSimulated = booleanEnv(env.GRUBS_CV_ALLOW_SIMULATED);
  const configKey = JSON.stringify([
    apiKey,
    openDotaApiKey,
    steamApiKey,
    grubsCvUrl,
    grubsCvToken,
    grubsCvMinConfidence,
    grubsCvAllowSimulated
  ]);
  if (cachedHandler && cachedConfigKey === configKey) return cachedHandler;

  const registry = new AdapterRegistry();
  if (apiKey) {
    const riotProvider = createRiotFinalityProvider(
      createRiotScheduleReconciliationProvider(
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
      ),
      { apiKey }
    );
    const historyProvider = createLeaguepediaHistoryFallbackProvider(
      createCompletedInventoryProvider(
        createProductionInventoryProvider(riotProvider)
      )
    );
    const enrichedProvider = grubsCvUrl
      ? createGrubsCvProvider(historyProvider, {
          baseUrl: grubsCvUrl,
          token: grubsCvToken,
          minConfidence: grubsCvMinConfidence,
          allowSimulated: grubsCvAllowSimulated
        })
      : historyProvider;
    const snapshotProvider = createChampionKillProvider(enrichedProvider);
    const provider = createProductionScheduleProvider(snapshotProvider, riotProvider);
    registry.register(new CachedAdapter(new LolAdapter(provider), {
      scheduleTtlMs: 15_000,
      liveSnapshotTtlMs: 400,
      seriesContextTtlMs: 10_000
    }));
  }

  const openDotaProvider = createOpenDotaProvider({ apiKey: openDotaApiKey });
  const dotaProvider = steamApiKey
    ? createFallbackDotaProvider(
        createSteamDotaProvider({ apiKey: steamApiKey }),
        openDotaProvider,
        { id: 'dota-live', name: 'Dota Live' }
      )
    : openDotaProvider;
  registry.register(new CachedAdapter(
    new DotaAdapter(dotaProvider),
    {
      scheduleTtlMs: 8_000,
      liveSnapshotTtlMs: 2_000,
      seriesContextTtlMs: 300_000
    }
  ));

  cachedConfigKey = configKey;
  cachedHandler = createApiHandler(registry);
  return cachedHandler;
}

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return createWorkerHandler(env)(request);
  }
};
