import type {
  DotaProviderClient,
  DotaProviderScheduleEntry,
  DotaProviderSnapshot
} from './provider.ts';

export interface FallbackDotaProviderOptions {
  id?: string;
  name?: string;
  sourceUrl?: string;
}

/** Uses the fallback only when the primary provider fails; an empty primary feed is valid. */
export function createFallbackDotaProvider(
  primary: DotaProviderClient,
  fallback: DotaProviderClient,
  options: FallbackDotaProviderOptions = {}
): DotaProviderClient {
  const sourceUrl = options.sourceUrl?.trim() || primary.sourceUrl;
  return {
    id: options.id?.trim() || primary.id,
    name: options.name?.trim() || primary.name,
    ...(sourceUrl ? { sourceUrl } : {}),

    async getSchedule(): Promise<readonly DotaProviderScheduleEntry[]> {
      try {
        return await primary.getSchedule();
      } catch {
        return fallback.getSchedule();
      }
    },

    async getSnapshot(gameId: string, after?: string): Promise<DotaProviderSnapshot> {
      try {
        return await primary.getSnapshot(gameId, after);
      } catch {
        return fallback.getSnapshot(gameId, after);
      }
    }
  };
}
