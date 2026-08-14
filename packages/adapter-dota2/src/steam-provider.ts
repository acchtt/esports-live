import { createOpenDotaProvider } from './opendota-provider.ts';
import type { DotaProviderClient } from './provider.ts';

interface SteamHero {
  id?: number | null;
  name?: string | null;
  localized_name?: string | null;
}

interface SteamHeroResponse {
  result?: {
    heroes?: readonly SteamHero[] | null;
  } | null;
}

interface SteamTopLiveResponse {
  game_list?: readonly unknown[] | null;
}

export interface SteamDotaProviderOptions {
  apiKey: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
}

const DEFAULT_BASE_URL = 'https://api.steampowered.com';

interface CloudflareRequestInit extends RequestInit {
  cf?: {
    cacheEverything: boolean;
    cacheTtlByStatus: Readonly<Record<string, number>>;
  };
}

function steamUrl(baseUrl: string, path: string, apiKey: string): string {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

function heroImagePath(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const slug = name.trim().replace(/^npc_dota_hero_/, '');
  return slug ? `/apps/dota2/images/dota_react/heroes/${slug}.png` : null;
}

function normalizedHeroes(value: SteamHeroResponse): Readonly<Record<string, unknown>> {
  return Object.fromEntries((value.result?.heroes ?? [])
    .filter(hero => typeof hero.id === 'number' && hero.id > 0)
    .map(hero => [String(hero.id), {
      id: hero.id,
      localized_name: hero.localized_name ?? null,
      img: heroImagePath(hero.name)
    }]));
}

async function jsonResponse(
  response: Response,
  transform: (value: unknown) => unknown
): Promise<Response> {
  if (!response.ok) return response;
  const value = await response.json();
  return Response.json(transform(value), {
    status: response.status,
    headers: {
      'Cache-Control': response.headers.get('Cache-Control') ?? 'public, max-age=10'
    }
  });
}

/**
 * Reads Valve's own Dota live feed. The small request bridge lets us reuse the
 * battle-tested OpenDota payload normalizer because GetTopLiveGame is the
 * upstream source for the same match shape used by OpenDota's /live service.
 */
export function createSteamDotaProvider(options: SteamDotaProviderOptions): DotaProviderClient {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Steam Dota provider requires an API key.');
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function fetchSteam(url: URL, init: CloudflareRequestInit): Promise<Response> {
    try {
      return await fetcher(url, init);
    } catch {
      // Do not let a runtime fetch error echo the key-bearing URL to API clients.
      throw new Error('Valve Dota Live request failed.');
    }
  }

  const bridgeFetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const requestInit: CloudflareRequestInit = {
      ...init,
      headers: { Accept: 'application/json' },
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: {
          '200-299': path.endsWith('/constants/heroes') ? 86_400 : 10,
          '400-599': 0
        }
      }
    };

    if (path.endsWith('/live')) {
      const url = new URL(steamUrl(
        baseUrl,
        '/IDOTA2Match_570/GetTopLiveGame/v1/',
        apiKey
      ));
      url.searchParams.set('partner', '1');
      return jsonResponse(await fetchSteam(url, requestInit), value => (
        (value as SteamTopLiveResponse)?.game_list ?? []
      ));
    }

    if (path.endsWith('/constants/heroes')) {
      const url = new URL(steamUrl(
        baseUrl,
        '/IEconDOTA2_570/GetHeroes/v0001/',
        apiKey
      ));
      url.searchParams.set('language', 'en_us');
      return jsonResponse(await fetchSteam(url, requestInit), value => (
        normalizedHeroes(value as SteamHeroResponse)
      ));
    }

    if (path.endsWith('/leagues')) return Response.json([]);
    return new Response('Unsupported Steam Dota bridge path.', { status: 404 });
  };

  return createOpenDotaProvider({
    fetcher: bridgeFetcher,
    idPrefix: 'steam',
    liveOnlyMessage: 'Valve supplies current Dota games; upcoming fixtures and final history are outside this live feed.',
    providerId: 'steam-dota-live',
    providerName: 'Valve Dota Live',
    sourceUrl: 'https://api.steampowered.com',
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
}
