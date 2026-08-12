import type {
  ScheduleEvent,
  SeriesContext,
  SeriesGameRef,
  TeamRef
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
  signature: string;
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

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function eventTeamKey(event: ScheduleEvent, team: TeamRef | null | undefined): string | null {
  if (!team) return null;
  const teamId = team.id?.trim() ?? '';
  const teamName = normalized(team.name);
  const teamCode = normalized(team.code);

  for (const candidate of event.series.teams) {
    if (teamId && candidate.id?.trim() === teamId) return candidate.id;
    if (teamName && normalized(candidate.name) === teamName) return candidate.id || teamName;
    if (teamCode && normalized(candidate.code) === teamCode) return candidate.id || teamCode;
  }
  return null;
}

function completionEvidence(
  event: ScheduleEvent,
  context: SeriesContext
): ConfirmedFinality | null {
  if (context.seriesId !== event.series.id) return null;
  const history = context.history;
  if (!history) return null;

  // A completed-series score cannot be trusted when the same fresh context still
  // contains an active game. This was the source of live LPL series flipping to
  // Final/Ended mid-game.
  if (history.games.some(game => (
    game.state === 'live' || game.state === 'draft' || game.state === 'paused'
  ))) {
    return null;
  }

  const winsRequired = Math.max(
    1,
    history.winsRequired || Math.floor(Math.max(1, history.bestOf) / 2) + 1
  );
  const winnerCounts = new Map<string, number>();
  const seenGames = new Set<string>();
  const signatureGames: string[] = [];

  for (const game of history.games) {
    if (game.state !== 'completed' || !game.winner) continue;
    const uniqueGame = game.id?.trim() || `game-${game.number}`;
    if (seenGames.has(uniqueGame)) continue;
    seenGames.add(uniqueGame);

    const winnerKey = eventTeamKey(event, game.winner);
    if (!winnerKey) continue;
    winnerCounts.set(winnerKey, (winnerCounts.get(winnerKey) ?? 0) + 1);
    signatureGames.push(`${game.number}:${uniqueGame}:${winnerKey}`);
  }

  // Do not accept the aggregate score alone. At least winsRequired distinct
  // completed game records must identify the same series team as winner.
  const decisive = [...winnerCounts.entries()]
    .find(([, wins]) => wins >= winsRequired);
  if (!decisive) return null;

  const games = history.games.map(game => ({
    id: game.id,
    number: game.number,
    state: game.state
  }));
  signatureGames.sort();
  return {
    signature: `${decisive[0]}:${decisive[1]}:${signatureGames.join('|')}`,
    games
  };
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

    const sourceEvents = payload.events;
    const visibleIds = new Set(sourceEvents.map(event => event.series.id));
    for (const id of [...confirmed.keys()]) if (!visibleIds.has(id)) confirmed.delete(id);

    const now = Date.now();
    const candidateMap = new Map<string, ScheduleEvent>();
    probeCandidates(sourceEvents, now).forEach(event => candidateMap.set(event.series.id, event));

    // A local override is intentionally not sticky. If the upstream schedule still
    // disagrees, keep re-checking context so a later live/partial frame can restore
    // the match to Live instead of leaving it poisoned in Ended until reload.
    sourceEvents.forEach(event => {
      if (confirmed.has(event.series.id) && (activeSeries(event) || overdueSeries(event))) {
        candidateMap.set(event.series.id, event);
      }
    });

    const candidates = [...candidateMap.values()].filter(event => (
      now - (checkedAt.get(event.series.id) ?? 0) >= RECHECK_MS
    ));

    await Promise.all(candidates.map(async event => {
      checkedAt.set(event.series.id, now);
      const context = await loadFreshContext(nativeFetch, event.series.id);
      if (!context) return;

      const evidence = completionEvidence(event, context);
      if (!evidence) {
        confirmed.delete(event.series.id);
        return;
      }
      confirmed.set(event.series.id, evidence);
    }));

    const events = sourceEvents.map(event => {
      if (event.series.state === 'completed') return event;
      const finality = confirmed.get(event.series.id);
      return finality ? applyConfirmedFinality(event, finality) : event;
    });

    return responseWithJson(response, { ...payload, events });
  };
}
