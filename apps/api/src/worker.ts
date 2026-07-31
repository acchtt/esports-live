import { LolAdapter, createRiotLolHistoryProvider } from '@esports-live/adapter-lol';
import { AdapterRegistry, CachedAdapter } from '@esports-live/core';
import { createApiHandler } from './router.ts';

export interface WorkerEnv {
  LOL_ESPORTS_API_KEY?: string;
}

type ApiHandler = (request: Request) => Promise<Response>;

let cachedApiKey: string | null = null;
let cachedHandler: ApiHandler | null = null;

export function createWorkerHandler(env: WorkerEnv): ApiHandler {
  const apiKey = env.LOL_ESPORTS_API_KEY?.trim() ?? '';
  if (cachedHandler && cachedApiKey === apiKey) return cachedHandler;

  const registry = new AdapterRegistry();
  if (apiKey) {
    const riot = new LolAdapter(createRiotLolHistoryProvider({ apiKey }));
    registry.register(new CachedAdapter(riot));
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
