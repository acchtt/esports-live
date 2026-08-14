import { createOpenDotaProvider } from './opendota-provider.ts';
import type { DotaProviderClient, DotaProviderSnapshot } from './provider.ts';

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

interface SteamTopLiveGame {
  match_id?: string | number | null;
  server_steam_id?: string | number | null;
}

interface SteamTopLiveResponse {
  game_list?: readonly SteamTopLiveGame[] | null;
}

interface SteamRealtimeMatch {
  game_time?: number | null;
  matchId?: string | number | null;
  match_id?: string | number | null;
  timestamp?: number | null;
}

interface SteamRealtimeTeam {
  score?: number | null;
  team_number?: number | null;
}

interface SteamRealtimeResponse {
  graph_data?: {
    graph_gold?: readonly number[] | null;
  } | null;
  match?: SteamRealtimeMatch | null;
  teams?: readonly SteamRealtimeTeam[] | null;
}

export interface SteamDotaProviderOptions {
  apiKey: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
  now?: () => Date;
}

const DEFAULT_BASE_URL = 'https://api.steampowered.com';
const REALTIME_SUCCESS_TTL_MS = 5_000;
const REALTIME_FAILURE_TTL_MS = 30_000;

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

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function epochIso(value: unknown): string | null {
  const numeric = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1_000).toISOString();
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

function realtimeBody(value: unknown): SteamRealtimeResponse | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const body = record.result && typeof record.result === 'object'
    ? record.result
    : record;
  return body as SteamRealtimeResponse;
}

function matchId(value: SteamRealtimeResponse): string {
  return String(value.match?.matchId ?? value.match?.match_id ?? '').trim();
}

function teamScore(
  teams: readonly SteamRealtimeTeam[],
  teamNumber: number,
  fallbackIndex: number
): number | null {
  const team = teams.find(entry => finiteNumber(entry.team_number, -1) === teamNumber)
    ?? teams[fallbackIndex];
  return typeof team?.score === 'number' && Number.isFinite(team.score) ? team.score : null;
}

function latestGoldLead(value: SteamRealtimeResponse): number | null {
  const points = value.graph_data?.graph_gold ?? [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (typeof point === 'number' && Number.isFinite(point)) return point;
  }
  return null;
}

interface RealtimeOutcome {
  expiresAt: number;
  reason: string;
  value: SteamRealtimeResponse | null;
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
  // Production receives this value from the encrypted STEAM_API_KEY Worker binding.
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error('Steam Dota provider requires an API key.');
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const serverByGame = new Map<string, string>();
  const realtimeByGame = new Map<string, RealtimeOutcome>();

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
      return jsonResponse(await fetchSteam(url, requestInit), value => {
        const games = (value as SteamTopLiveResponse)?.game_list ?? [];
        games.forEach(game => {
          const gameId = String(game.match_id ?? '').trim();
          const serverId = String(game.server_steam_id ?? '').trim();
          if (gameId && serverId && serverId !== '0') serverByGame.set(gameId, serverId);
        });
        return games;
      });
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

  const topLiveProvider = createOpenDotaProvider({
    fetcher: bridgeFetcher,
    idPrefix: 'steam',
    liveOnlyMessage: 'Valve supplies current Dota games; upcoming fixtures and final history are outside this live feed.',
    providerId: 'steam-dota-live',
    providerName: 'Valve Dota Live',
    sourceUrl: 'https://api.steampowered.com',
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.now === undefined ? {} : { now: options.now })
  });

  async function loadRealtime(gameId: string): Promise<RealtimeOutcome> {
    const current = now().getTime();
    const cached = realtimeByGame.get(gameId);
    if (cached && cached.expiresAt > current) return cached;
    const serverId = serverByGame.get(gameId);
    if (!serverId) {
      return {
        expiresAt: current + REALTIME_FAILURE_TTL_MS,
        reason: 'Valve top-live data did not include a usable server ID.',
        value: null
      };
    }

    const url = new URL(steamUrl(
      baseUrl,
      '/IDOTA2MatchStats_570/GetRealtimeStats/v1/',
      apiKey
    ));
    url.searchParams.set('server_steam_id', serverId);
    const requestInit: CloudflareRequestInit = {
      headers: { Accept: 'application/json' },
      cf: {
        cacheEverything: true,
        cacheTtlByStatus: { '200-299': 5, '400-599': 0 }
      }
    };

    let outcome: RealtimeOutcome;
    try {
      const response = await fetchSteam(url, requestInit);
      if (!response.ok) {
        outcome = {
          expiresAt: current + REALTIME_FAILURE_TTL_MS,
          reason: `Valve GetRealtimeStats returned ${response.status}.`,
          value: null
        };
      } else {
        const value = realtimeBody(await response.json());
        const valid = value?.match && Array.isArray(value.teams);
        outcome = valid
          ? {
              expiresAt: current + REALTIME_SUCCESS_TTL_MS,
              reason: 'Valve GetRealtimeStats supplied a telemetry frame.',
              value
            }
          : {
              expiresAt: current + REALTIME_FAILURE_TTL_MS,
              reason: 'Valve GetRealtimeStats returned an empty telemetry frame.',
              value: null
            };
      }
    } catch {
      outcome = {
        expiresAt: current + REALTIME_FAILURE_TTL_MS,
        reason: 'Valve GetRealtimeStats request failed.',
        value: null
      };
    }
    realtimeByGame.set(gameId, outcome);
    return outcome;
  }

  function enrichSnapshot(
    snapshot: DotaProviderSnapshot,
    outcome: RealtimeOutcome,
    after?: string
  ): DotaProviderSnapshot {
    const fallbackReasons = snapshot.reasons ?? [];
    const unavailableReason = {
      code: 'realtime_stats_unavailable',
      message: `${outcome.reason} Using Valve top-live telemetry.`
    };
    const realtime = outcome.value;
    if (!realtime || !snapshot.stats) {
      return { ...snapshot, reasons: [...fallbackReasons, unavailableReason] };
    }
    const realtimeId = matchId(realtime);
    if (realtimeId && realtimeId !== snapshot.game.id) {
      return {
        ...snapshot,
        reasons: [...fallbackReasons, {
          code: 'realtime_stats_mismatch',
          message: 'Valve GetRealtimeStats returned a different match; using top-live telemetry.'
        }]
      };
    }
    const sourceTimestamp = epochIso(realtime.match?.timestamp);
    const realtimeMs = Date.parse(sourceTimestamp ?? '');
    const fallbackMs = Date.parse(snapshot.sourceTimestamp ?? '');
    const realtimeClock = finiteNumber(realtime.match?.game_time, Number.NaN);
    const newerTimestamp = Number.isFinite(realtimeMs)
      && (!Number.isFinite(fallbackMs) || realtimeMs > fallbackMs);
    const newerClock = Number.isFinite(realtimeClock)
      && realtimeClock > snapshot.stats.gameClockSeconds
      && Number.isFinite(realtimeMs)
      && (!Number.isFinite(fallbackMs) || realtimeMs >= fallbackMs - 5_000);
    if (!sourceTimestamp || (!newerTimestamp && !newerClock)) {
      return {
        ...snapshot,
        reasons: [...fallbackReasons, {
          code: 'realtime_stats_not_newer',
          message: 'Valve GetRealtimeStats was not newer than top-live telemetry.'
        }]
      };
    }

    const teams = realtime.teams ?? [];
    const radiantScore = teamScore(teams, 2, 0);
    const direScore = teamScore(teams, 3, 1);
    const goldLead = latestGoldLead(realtime);
    const afterMs = Date.parse(after ?? '');
    return {
      ...snapshot,
      sourceTimestamp,
      advancing: Number.isFinite(afterMs) ? realtimeMs > afterMs : null,
      stats: {
        ...snapshot.stats,
        ...(Number.isFinite(realtimeClock)
          ? { gameClockSeconds: Math.max(0, realtimeClock) }
          : {}),
        radiant: {
          ...snapshot.stats.radiant,
          ...(radiantScore === null ? {} : { kills: radiantScore })
        },
        dire: {
          ...snapshot.stats.dire,
          ...(direScore === null ? {} : { kills: direScore })
        },
        ...(goldLead === null ? {} : { radiantNetWorthLead: goldLead })
      },
      reasons: [...fallbackReasons, {
        code: 'realtime_stats_provider',
        message: 'Valve GetRealtimeStats supplied newer match telemetry.'
      }]
    };
  }

  return {
    ...topLiveProvider,
    async getSnapshot(gameId: string, after?: string): Promise<DotaProviderSnapshot> {
      const snapshot = await topLiveProvider.getSnapshot(gameId, after);
      const outcome = await loadRealtime(gameId);
      return enrichSnapshot(snapshot, outcome, after);
    }
  };
}
