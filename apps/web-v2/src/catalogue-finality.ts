import type {
  ScheduleEvent,
  SeriesContext,
  SeriesGameRef
} from '@esports-live/core';

const ACTIVE_SUSPECT_AGE_MS = 2 * 60 * 60 * 1_000;
const OVERDUE_SUSPECT_AGE_MS = 90 * 60 * 1_000;
const MAX_ACTIVE_PROBES = 3;
const MAX_OVERDUE_PROBES = 4;
const RECHECK_MS = 25_000;
const CONTEXT_TIMEOUT_MS = 8_000;

type FetchInput = RequestInfo | URL;

interface ScheduleResponse {
  esport?: string;
  events?: readonly ScheduleEvent[];
}

interface ConfirmedFinality {
  games: readonly SeriesGameRef[];
}

function requestUrl(input: FetchInput): URL | null {
  try {
    const value = input instanceof Request ? input.url : String(input);
    return new URL(value, window.location.href);
  } catch {
    return null;
  }
}

function isMatchesSchedule(url: URL): boolean {
  if (!url.pathname.endsWith('/v1/lol/schedule')) return false;
  const states = url.searchParams.get('states') ?? '';
  return states.includes('live')
    || states.includes('paused')
    || states.includes('scheduled')
    || states.includes('unknown');
}

function scheduledTime(event: ScheduleEvent): number {
  const value = Date.parse(event.series.scheduledStart);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function activeSeries(event: ScheduleEvent): boolean {
  return event.series.state === 'live' || event.series.state === 'paused';
}

function overdueSeries(event: ScheduleEvent): boolean {
  return event.series.state === 'scheduled' || event.series.state === 'unknown';
}

function probeCandidates(
  events: readonly ScheduleEvent[],
  now: number
): readonly ScheduleEvent[] {
  const active = events
    .filter(activeSeries)
    .filter(event => now - scheduledTime(event) >= ACTIVE_SUSPECT_AGE_MS)
    .sort((left, right) => scheduledTime(right) - scheduledTime(left))
    .slice(0, MAX_ACTIVE_PROBES);
  const overdue = events
    .filter(overdueSeries)
    .filter(event => now - scheduledTime(event) >= OVERDUE_SUSPECT_AGE_MS)
    .sort((left, right) => scheduledTime(right) - scheduledTime(left))
    .slice(0, MAX_OVERDUE_PROBES);
  const merged = new Map<string, ScheduleEvent>();
  [...active, ...overdue].forEach(event => merged.set(event.series.id, event));
  return [...merged.values()];
}

function winnerCounts(context: SeriesContext): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const game of context.history?.games ?? []) {
    if (game.state !== 'completed' || !game.winner?.id) continue;
    counts.set(game.winner.id, (counts.get(game.winner.id) ?? 0) + 1);
  }
  return counts;
}

function contextConfirmsCompletion(context: SeriesContext): boolean {
  const history = context.history;
  if (!history) return false;
  const winsRequired = Math.max(
    1,
    history.winsRequired || Math.floor(Math.max(1, history.bestOf) / 2) + 1
  );
  if (history.score.some(score => score.wins >= winsRequired)) return true;
  return [...winnerCounts(context).values()].some(wins => wins >= winsRequired);
}

function finalGames(
  event: ScheduleEvent,
  context: SeriesContext
): readonly SeriesGameRef[] {
  const historyGames = context.history?.games ?? [];
  const source = historyGames.length
    ? historyGames.map(game => ({ id: game.id, number: game.number, state: game.state }))
    : event.series.games;
  return source.map(game => (
    game.state === 'live' || game.state === 'draft' || game.state === 'paused'
      ? { ...game, state: 'completed' as const }
      : game
  ));
}

function applyConfirmedFinality(
  event: ScheduleEvent,
  finality: ConfirmedFinality
): ScheduleEvent {
  return {
    ...event,
    series: {
      ...event.series,
      state: 'completed',
      games: finality.games
    }
  };
}

function responseWithJson(response: Response, payload: unknown): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function loadFreshContext(
  nativeFetch: typeof window.fetch,
  seriesId: string
): Promise<SeriesContext | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);
  try {
    const response = await nativeFetch(
      `/v1/lol/series/${encodeURIComponent(seriesId)}/context?catalogue-final=${Date.now()}`,
      { cache: 'no-store', signal: controller.signal }
    );
    if (!response.ok) return null;
    return await response.json() as SeriesContext;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function installCatalogueFinality(): void {
  const nativeFetch = window.fetch.bind(window);
  const confirmed = new Map<string, ConfirmedFinality>();
  const checkedAt = new Map<string, number>();

  window.fetch = async (input: FetchInput, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const url = requestUrl(input);
    if (!url || !response.ok || !isMatchesSchedule(url)) return response;

    let payload: ScheduleResponse;
    try {
      payload = await response.clone().json() as ScheduleResponse;
    } catch {
      return response;
    }
    if (!Array.isArray(payload.events)) return response;

    let events = payload.events.map(event => {
      const finality = confirmed.get(event.series.id);
      return finality ? applyConfirmedFinality(event, finality) : event;
    });

    const now = Date.now();
    const candidates = probeCandidates(events, now).filter(event => {
      if (confirmed.has(event.series.id)) return false;
      return now - (checkedAt.get(event.series.id) ?? 0) >= RECHECK_MS;
    });

    await Promise.all(candidates.map(async event => {
      checkedAt.set(event.series.id, now);
      const context = await loadFreshContext(nativeFetch, event.series.id);
      if (!context || !contextConfirmsCompletion(context)) return;
      confirmed.set(event.series.id, {
        games: finalGames(event, context)
      });
    }));

    if (confirmed.size) {
      events = events.map(event => {
        const finality = confirmed.get(event.series.id);
        return finality ? applyConfirmedFinality(event, finality) : event;
      });
    }

    return responseWithJson(response, { ...payload, events });
  };
}
