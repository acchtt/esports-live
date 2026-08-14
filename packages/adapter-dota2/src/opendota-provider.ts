import type { TeamRef } from '@esports-live/core';
import type {
  DotaProviderClient,
  DotaProviderGame,
  DotaProviderScheduleEntry,
  DotaProviderSeries,
  DotaProviderSnapshot
} from './provider.ts';
import type { DotaPlayerState, DotaTeamState } from './types.ts';

interface OpenDotaLivePlayer {
  account_id?: number | null;
  hero_id?: number | null;
  team?: number | null;
  team_slot?: number | null;
}

interface OpenDotaLiveMatch {
  activate_time?: number | null;
  deactivate_time?: number | null;
  delay?: number | null;
  dire_score?: number | null;
  game_time?: number | null;
  last_update_time?: number | null;
  league_id?: number | null;
  match_id?: string | number | null;
  players?: readonly OpenDotaLivePlayer[] | null;
  radiant_lead?: number | null;
  radiant_score?: number | null;
  series_id?: number | null;
  spectators?: number | null;
  team_id_dire?: number | null;
  team_id_radiant?: number | null;
  team_name_dire?: string | null;
  team_name_radiant?: string | null;
}

interface OpenDotaHero {
  id?: number | null;
  localized_name?: string | null;
  img?: string | null;
}

interface OpenDotaLeague {
  leagueid?: number | null;
  name?: string | null;
}

export interface OpenDotaProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
  idPrefix?: string;
  liveOnlyMessage?: string;
  now?: () => Date;
  providerId?: string;
  providerName?: string;
  sourceUrl?: string;
}

interface FeedCache {
  expiresAt: number;
  storedAt: number;
  matches: readonly OpenDotaLiveMatch[];
}

const DEFAULT_BASE_URL = 'https://api.opendota.com/api';
const HERO_IMAGE_ORIGIN = 'https://cdn.cloudflare.steamstatic.com';
const ACTIVE_UPDATE_WINDOW_MS = 5 * 60 * 1_000;
const STALE_FEED_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_RETRY_DELAY_MS = 30_000;

interface CloudflareRequestInit extends RequestInit {
  cf?: {
    cacheEverything: boolean;
    cacheTtlByStatus: Readonly<Record<string, number>>;
  };
}

class OpenDotaHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(
    providerName: string,
    status: number,
    path: string,
    retryAfterMs: number | null
  ) {
    super(`${providerName} returned ${status} for ${path}.`);
    this.name = 'OpenDotaHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(response: Response, nowMs: number): number | null {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

function edgeCacheTtlSeconds(path: string): number {
  if (path === '/live') return 15;
  if (path === '/constants/heroes') return 24 * 60 * 60;
  if (path === '/leagues') return 60 * 60;
  return 0;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function epochIso(value: unknown): string | null {
  const seconds = finiteNumber(value, Number.NaN);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1_000).toISOString();
}

function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function matchId(match: OpenDotaLiveMatch): string {
  return String(match.match_id ?? '').trim();
}

function isLeagueMatch(match: OpenDotaLiveMatch): boolean {
  return finiteNumber(match.league_id) > 0
    && Boolean(matchId(match))
    && Boolean(cleanName(match.team_name_radiant))
    && Boolean(cleanName(match.team_name_dire));
}

function isActive(match: OpenDotaLiveMatch): boolean {
  return finiteNumber(match.deactivate_time) <= 0;
}

function isCurrentActive(match: OpenDotaLiveMatch, nowMs: number): boolean {
  const updated = finiteNumber(match.last_update_time, Number.NaN) * 1_000;
  return isActive(match)
    && Number.isFinite(updated)
    && updated >= nowMs - ACTIVE_UPDATE_WINDOW_MS
    && updated <= nowMs + ACTIVE_UPDATE_WINDOW_MS;
}

function seriesKey(match: OpenDotaLiveMatch, idPrefix: string): string {
  const id = finiteNumber(match.series_id);
  return `${idPrefix}-series:${id > 0 ? id : matchId(match)}`;
}

function teamId(
  value: unknown,
  name: string,
  side: 'radiant' | 'dire',
  idPrefix: string
): string {
  const id = finiteNumber(value);
  if (id > 0) return `${idPrefix}-team:${id}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${idPrefix}-team:${slug || side}`;
}

function teamRef(
  match: OpenDotaLiveMatch,
  side: 'radiant' | 'dire',
  idPrefix: string
): TeamRef {
  const name = cleanName(side === 'radiant' ? match.team_name_radiant : match.team_name_dire);
  const id = side === 'radiant' ? match.team_id_radiant : match.team_id_dire;
  return {
    id: teamId(id, name, side, idPrefix),
    name: name || (side === 'radiant' ? 'Radiant' : 'Dire')
  };
}

function orderedMatches(matches: readonly OpenDotaLiveMatch[]): readonly OpenDotaLiveMatch[] {
  return [...matches].sort((left, right) => (
    finiteNumber(left.activate_time) - finiteNumber(right.activate_time)
    || matchId(left).localeCompare(matchId(right))
  ));
}

function gameRefs(matches: readonly OpenDotaLiveMatch[]): readonly DotaProviderGame[] {
  return orderedMatches(matches).map((match, index) => ({
    id: matchId(match),
    number: index + 1,
    state: isActive(match)
      ? finiteNumber(match.game_time) < 0 ? 'draft' : 'live'
      : 'completed'
  }));
}

function activeMatch(matches: readonly OpenDotaLiveMatch[]): OpenDotaLiveMatch | null {
  return orderedMatches(matches).findLast(match => isActive(match)) ?? null;
}

function createSeries(
  matches: readonly OpenDotaLiveMatch[],
  leagueNames: ReadonlyMap<number, string>,
  idPrefix: string
): DotaProviderSeries {
  const active = activeMatch(matches) ?? orderedMatches(matches).at(-1);
  if (!active) throw new Error('Dota live series has no games.');
  const start = epochIso(orderedMatches(matches)[0]?.activate_time) ?? new Date(0).toISOString();
  return {
    id: seriesKey(active, idPrefix),
    competition: {
      id: `${idPrefix}-league:${finiteNumber(active.league_id)}`,
      name: leagueNames.get(finiteNumber(active.league_id))
        ?? `Dota 2 League ${finiteNumber(active.league_id)}`,
      stage: 'Live series'
    },
    teams: [teamRef(active, 'radiant', idPrefix), teamRef(active, 'dire', idPrefix)],
    bestOf: 1,
    state: isActive(active) ? 'live' : 'completed',
    scheduledStart: start,
    games: gameRefs(matches)
  };
}

function jsonUrl(baseUrl: string, path: string, apiKey: string): string {
  const url = new URL(`${baseUrl}${path}`);
  if (apiKey) url.searchParams.set('api_key', apiKey);
  return url.toString();
}

function heroImageUrl(value: string | null | undefined): string | null {
  const path = cleanName(value);
  if (!path) return null;
  try {
    return new URL(path, HERO_IMAGE_ORIGIN).toString();
  } catch {
    return null;
  }
}

export function createOpenDotaProvider(options: OpenDotaProviderOptions = {}): DotaProviderClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const apiKey = options.apiKey?.trim() ?? '';
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 8_000);
  const idPrefix = options.idPrefix?.trim() || 'opendota';
  const providerId = options.providerId?.trim() || 'opendota-live';
  const providerName = options.providerName?.trim() || 'OpenDota Live';
  const sourceUrl = options.sourceUrl?.trim() || 'https://docs.opendota.com/';
  const liveOnlyMessage = options.liveOnlyMessage?.trim()
    || 'OpenDota supplies current league games; upcoming fixtures and final history are outside this live feed.';
  let feedCache: FeedCache | null = null;
  let feedInFlight: Promise<readonly OpenDotaLiveMatch[]> | null = null;
  let feedRetryAt = 0;
  let heroes: ReadonlyMap<number, OpenDotaHero> | null = null;
  let heroesInFlight: Promise<ReadonlyMap<number, OpenDotaHero>> | null = null;
  let leagues: ReadonlyMap<number, string> | null = null;
  let leaguesInFlight: Promise<ReadonlyMap<number, string>> | null = null;

  async function fetchJson<T>(path: string): Promise<T> {
    const edgeTtl = edgeCacheTtlSeconds(path);
    const init: CloudflareRequestInit = {
      headers: { Accept: 'application/json' },
      ...(edgeTtl > 0 ? {
        // Cloudflare's subrequest cache is shared across Worker isolates, so
        // concurrent visitors reuse one OpenDota response instead of consuming
        // the unauthenticated quota independently.
        cf: {
          cacheEverything: true,
          cacheTtlByStatus: {
            '200-299': edgeTtl,
            '400-599': 0
          }
        }
      } : {})
    };
    const response = await fetcher(jsonUrl(baseUrl, path, apiKey), init);
    if (!response.ok) {
      throw new OpenDotaHttpError(
        providerName,
        response.status,
        path,
        retryAfterMs(response, now().getTime())
      );
    }
    return await response.json() as T;
  }

  async function loadMatches(): Promise<readonly OpenDotaLiveMatch[]> {
    const current = now().getTime();
    if (feedCache && feedCache.expiresAt > current) return feedCache.matches;
    if (
      feedCache
      && feedRetryAt > current
      && current - feedCache.storedAt <= STALE_FEED_WINDOW_MS
    ) return feedCache.matches;
    if (feedInFlight) return feedInFlight;
    feedInFlight = fetchJson<unknown>('/live')
      .then(value => {
        if (!Array.isArray(value)) {
          throw new Error(`${providerName} live response is not an array.`);
        }
        const matches = value as readonly OpenDotaLiveMatch[];
        const storedAt = now().getTime();
        feedCache = { matches, storedAt, expiresAt: storedAt + cacheTtlMs };
        feedRetryAt = 0;
        return matches;
      })
      .catch(error => {
        const failedAt = now().getTime();
        const stale = feedCache;
        if (!stale || failedAt - stale.storedAt > STALE_FEED_WINDOW_MS) throw error;
        const requestedDelay = error instanceof OpenDotaHttpError
          ? error.retryAfterMs
          : null;
        feedRetryAt = failedAt + Math.max(DEFAULT_RETRY_DELAY_MS, requestedDelay ?? 0);
        return stale.matches;
      })
      .finally(() => { feedInFlight = null; });
    return feedInFlight;
  }

  async function loadHeroes(): Promise<ReadonlyMap<number, OpenDotaHero>> {
    if (heroes) return heroes;
    if (heroesInFlight) return heroesInFlight;
    heroesInFlight = fetchJson<unknown>('/constants/heroes')
      .then(value => {
        const values = value && typeof value === 'object'
          ? Object.values(value as Record<string, OpenDotaHero>)
          : [];
        heroes = new Map(values
          .filter(hero => finiteNumber(hero.id) > 0)
          .map(hero => [finiteNumber(hero.id), hero]));
        return heroes;
      })
      .catch(() => {
        heroes = new Map();
        return heroes;
      })
      .finally(() => { heroesInFlight = null; });
    return heroesInFlight;
  }

  async function loadLeagues(): Promise<ReadonlyMap<number, string>> {
    if (leagues) return leagues;
    if (leaguesInFlight) return leaguesInFlight;
    leaguesInFlight = fetchJson<unknown>('/leagues')
      .then(value => {
        const values = Array.isArray(value) ? value as readonly OpenDotaLeague[] : [];
        leagues = new Map(values
          .map(league => [finiteNumber(league.leagueid), cleanName(league.name)] as const)
          .filter(([id, name]) => id > 0 && Boolean(name)));
        return leagues;
      })
      .catch(() => {
        leagues = new Map();
        return leagues;
      })
      .finally(() => { leaguesInFlight = null; });
    return leaguesInFlight;
  }

  function groups(matches: readonly OpenDotaLiveMatch[]): ReadonlyMap<string, readonly OpenDotaLiveMatch[]> {
    const result = new Map<string, OpenDotaLiveMatch[]>();
    matches.filter(isLeagueMatch).forEach(match => {
      const key = seriesKey(match, idPrefix);
      const values = result.get(key) ?? [];
      values.push(match);
      result.set(key, values);
    });
    return result;
  }

  function playerState(
    player: OpenDotaLivePlayer,
    index: number,
    heroMap: ReadonlyMap<number, OpenDotaHero>
  ): DotaPlayerState {
    const heroId = finiteNumber(player.hero_id);
    const hero = heroMap.get(heroId);
    const side = finiteNumber(player.team) === 1 ? 'dire' : 'radiant';
    return {
      accountId: finiteNumber(player.account_id) > 0 ? String(player.account_id) : null,
      heroId,
      heroName: cleanName(hero?.localized_name) || null,
      heroImageUrl: heroImageUrl(hero?.img),
      side,
      position: finiteNumber(player.team_slot, index + 1)
    };
  }

  return {
    id: providerId,
    name: providerName,
    sourceUrl,

    async getSchedule(): Promise<readonly DotaProviderScheduleEntry[]> {
      const observedAt = now().toISOString();
      const [matches, leagueNames] = await Promise.all([loadMatches(), loadLeagues()]);
      const grouped = groups(matches);
      return [...grouped.values()]
        .filter(seriesMatches => seriesMatches.some(match => isCurrentActive(match, now().getTime())))
        .map(seriesMatches => ({
          series: createSeries(seriesMatches, leagueNames, idPrefix),
          observedAt
        }))
        .sort((left, right) => left.series.scheduledStart.localeCompare(right.series.scheduledStart));
    },

    async getSnapshot(gameId: string, after?: string): Promise<DotaProviderSnapshot> {
      const [matches, leagueNames] = await Promise.all([loadMatches(), loadLeagues()]);
      const match = matches.find(entry => (
        matchId(entry) === gameId
        && isLeagueMatch(entry)
        && isCurrentActive(entry, now().getTime())
      ));
      if (!match) throw new Error(`${providerName} live game not found: ${gameId}`);
      const seriesMatches = groups(matches).get(seriesKey(match, idPrefix)) ?? [match];
      const series = createSeries(seriesMatches, leagueNames, idPrefix);
      const game = series.games.find(entry => entry.id === gameId);
      if (!game) throw new Error(`${providerName} series game not found: ${gameId}`);
      const heroMap = await loadHeroes();
      const players = (match.players ?? []).map((player, index) => playerState(player, index, heroMap));
      const radiantPlayers = players.filter(player => player.side === 'radiant');
      const direPlayers = players.filter(player => player.side === 'dire');
      const sourceTimestamp = epochIso(match.last_update_time);
      const observedAt = now().toISOString();
      const radiantTeam = teamRef(match, 'radiant', idPrefix);
      const direTeam = teamRef(match, 'dire', idPrefix);
      const radiant: DotaTeamState = {
        ...radiantTeam,
        side: 'radiant',
        kills: finiteNumber(match.radiant_score),
        players: radiantPlayers
      };
      const dire: DotaTeamState = {
        ...direTeam,
        side: 'dire',
        kills: finiteNumber(match.dire_score),
        players: direPlayers
      };
      const complete = Boolean(sourceTimestamp)
        && Boolean(radiant.name)
        && Boolean(dire.name)
        && Number.isFinite(match.game_time)
        && Number.isFinite(match.radiant_score)
        && Number.isFinite(match.dire_score)
        && Number.isFinite(match.radiant_lead);
      const afterMs = Date.parse(after ?? '');
      const sourceMs = Date.parse(sourceTimestamp ?? '');

      return {
        series,
        game,
        sourceTimestamp,
        observedAt,
        advancing: Number.isFinite(afterMs) && Number.isFinite(sourceMs) ? sourceMs > afterMs : null,
        complete,
        stats: {
          gameClockSeconds: Math.max(0, finiteNumber(match.game_time)),
          radiant,
          dire,
          radiantNetWorthLead: finiteNumber(match.radiant_lead),
          spectators: Number.isFinite(match.spectators) ? finiteNumber(match.spectators) : null,
          broadcastDelaySeconds: Number.isFinite(match.delay) ? finiteNumber(match.delay) : null
        },
        reasons: [
          {
            code: 'live_only_provider',
            message: liveOnlyMessage
          }
        ]
      };
    }
  };
}
