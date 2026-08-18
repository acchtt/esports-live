import { AdapterRegistry, type EsportId, type ScheduleEvent, type ScheduleQuery } from '@esports-live/core';
import type { MatchStore } from './match-store.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  Vary: 'Origin'
};

const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 100;

class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

function json(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...headers
    }
  });
}

function commaValues(values: readonly string[]): string[] {
  return values
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

function scheduleQuery(url: URL): ScheduleQuery {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const competitions = commaValues([
    ...url.searchParams.getAll('competitionId'),
    ...url.searchParams.getAll('competitionIds')
  ]);
  const states = commaValues(url.searchParams.getAll('states'));

  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(competitions.length === 1 ? { competitionId: competitions[0] } : {}),
    ...(competitions.length > 1 ? { competitionIds: competitions } : {}),
    ...(states.length ? { states } : {})
  };
}

function encodeCursor(offset: number): string {
  return btoa(`v1:${offset}`)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function decodeCursor(value: string): number {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    const match = /^v1:(\d+)$/.exec(decoded);
    if (!match) throw new Error('Invalid cursor format.');
    const offset = Number(match[1]);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid cursor offset.');
    return offset;
  } catch {
    throw new ApiRequestError(400, 'invalid_cursor', 'The schedule cursor is invalid.');
  }
}

function pagination(url: URL): { enabled: boolean; offset: number; limit: number } {
  const cursor = url.searchParams.get('cursor');
  const rawLimit = url.searchParams.get('limit');
  const enabled = cursor !== null || rawLimit !== null;
  const offset = cursor ? decodeCursor(cursor) : 0;
  if (rawLimit === null) return { enabled, offset, limit: DEFAULT_PAGE_LIMIT };

  if (!/^\d+$/.test(rawLimit)) {
    throw new ApiRequestError(400, 'invalid_limit', 'Schedule limit must be a positive integer.');
  }
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ApiRequestError(
      400,
      'invalid_limit',
      `Schedule limit must be between 1 and ${MAX_PAGE_LIMIT}.`
    );
  }
  return { enabled, offset, limit };
}

async function persistedSchedule(
  store: MatchStore | undefined,
  events: readonly ScheduleEvent[]
): Promise<readonly ScheduleEvent[]> {
  if (!store || !events.length) return events;
  try {
    await store.recordSchedule(events);
    return await store.mergeSchedule(events);
  } catch {
    // Persistence is a reliability layer, never a reason to take the live API down.
    return events;
  }
}

async function persistedContext<T extends Awaited<ReturnType<NonNullable<ReturnType<AdapterRegistry['get']>['getSeriesContext']>>>>(
  store: MatchStore | undefined,
  seriesId: string,
  context: T
): Promise<T> {
  if (!store) return context;
  try {
    return await store.persistSeriesContext(seriesId, context) as T;
  } catch {
    // Keep serving provider context if the database is temporarily unavailable.
    return context;
  }
}

export function createApiHandler(registry: AdapterRegistry, matchStore?: MatchStore) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);

    try {
      if (url.pathname === '/health') {
        return json({
          ok: true,
          service: 'esports-live-api',
          schemaVersion: '1.0',
          adapters: registry.list(),
          persistence: matchStore ? 'd1' : 'memory'
        });
      }

      if (url.pathname === '/v1/esports') {
        return json({ esports: registry.list() });
      }

      if (segments.length === 3 && segments[0] === 'v1' && segments[2] === 'live') {
        const adapter = registry.get(segments[1] as EsportId);
        const sourceEvents = await adapter.getSchedule({ states: ['live', 'paused'] });
        const events = (await persistedSchedule(matchStore, sourceEvents))
          .filter(event => event.series.state !== 'completed');
        const gameIds = events.flatMap(event => {
          const game = event.series.games.find(candidate => (
            candidate.state === 'live'
            || candidate.state === 'draft'
            || candidate.state === 'paused'
          )) ?? event.series.games.at(-1);
          return game ? [game.id] : [];
        });
        const settled = await Promise.allSettled(
          gameIds.map(gameId => adapter.getLiveSnapshot(gameId))
        );
        const snapshots = settled.flatMap(result => (
          result.status === 'fulfilled' ? [result.value] : []
        ));
        return json({
          esport: adapter.esport,
          events,
          snapshots,
          partial: snapshots.length !== gameIds.length
        });
      }

      if (segments.length === 3 && segments[0] === 'v1' && segments[2] === 'schedule') {
        const adapter = registry.get(segments[1] as EsportId);
        const sourceEvents = await adapter.getSchedule(scheduleQuery(url));
        const events = await persistedSchedule(matchStore, sourceEvents);
        const pageRequest = pagination(url);
        const total = events.length;
        const pageEvents = pageRequest.enabled
          ? events.slice(pageRequest.offset, pageRequest.offset + pageRequest.limit)
          : events;
        const nextOffset = pageRequest.offset + pageRequest.limit;
        const previousOffset = Math.max(0, pageRequest.offset - pageRequest.limit);
        return json({
          esport: adapter.esport,
          events: pageEvents,
          page: {
            total,
            offset: pageRequest.enabled ? pageRequest.offset : 0,
            limit: pageRequest.enabled ? pageRequest.limit : total,
            nextCursor: pageRequest.enabled && nextOffset < total ? encodeCursor(nextOffset) : null,
            previousCursor: pageRequest.enabled && pageRequest.offset > 0
              ? encodeCursor(previousOffset)
              : null
          }
        });
      }

      if (
        segments.length === 5
        && segments[0] === 'v1'
        && segments[2] === 'series'
        && segments[4] === 'context'
      ) {
        const adapter = registry.get(segments[1] as EsportId);
        const seriesId = decodeURIComponent(segments[3] ?? '');
        if (!seriesId) throw new ApiRequestError(400, 'series_id_required', 'Series ID is required.');
        if (!adapter.getSeriesContext) {
          throw new ApiRequestError(404, 'context_not_supported', 'Series context is not supported for this esport.');
        }
        const providerContext = await adapter.getSeriesContext(seriesId);
        const context = await persistedContext(matchStore, seriesId, providerContext);
        return json(context);
      }

      if (
        segments.length === 5
        && segments[0] === 'v1'
        && segments[2] === 'games'
        && segments[4] === 'live'
      ) {
        const adapter = registry.get(segments[1] as EsportId);
        const gameId = decodeURIComponent(segments[3] ?? '');
        if (!gameId) throw new ApiRequestError(400, 'game_id_required', 'Game ID is required.');
        const after = url.searchParams.get('after') ?? undefined;
        const snapshot = await adapter.getLiveSnapshot(gameId, after);
        return json(snapshot, 200, {
          'X-Data-Quality': snapshot.quality.freshness,
          'X-Live-Analysis-Safe': String(snapshot.quality.safeForLiveAnalysis),
          ...(snapshot.quality.ageSeconds !== null
            ? { 'X-Source-Age-Seconds': String(snapshot.quality.ageSeconds) }
            : {})
        });
      }

      return json({ error: 'not_found' }, 404);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        return json({ error: error.code, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.startsWith('No adapter registered') ? 404 : 502;
      return json({ error: status === 404 ? 'esport_not_supported' : 'upstream_failure', message }, status);
    }
  };
}
