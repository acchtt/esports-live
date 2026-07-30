import { AdapterRegistry, type EsportId, type ScheduleQuery } from '@esports-live/core';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function scheduleQuery(url: URL): ScheduleQuery {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const competitionId = url.searchParams.get('competitionId');
  const states = url.searchParams.get('states')
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean);

  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(competitionId ? { competitionId } : {}),
    ...(states?.length ? { states } : {})
  };
}

export function createApiHandler(registry: AdapterRegistry) {
  return async function handle(request: Request): Promise<Response> {
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
          adapters: registry.list()
        });
      }

      if (url.pathname === '/v1/esports') {
        return json({ esports: registry.list() });
      }

      if (segments.length === 3 && segments[0] === 'v1' && segments[2] === 'schedule') {
        const adapter = registry.get(segments[1] as EsportId);
        const events = await adapter.getSchedule(scheduleQuery(url));
        return json({ esport: adapter.esport, events });
      }

      if (
        segments.length === 5
        && segments[0] === 'v1'
        && segments[2] === 'games'
        && segments[4] === 'live'
      ) {
        const adapter = registry.get(segments[1] as EsportId);
        const gameId = decodeURIComponent(segments[3] ?? '');
        if (!gameId) return json({ error: 'game_id_required' }, 400);
        const after = url.searchParams.get('after') ?? undefined;
        const snapshot = await adapter.getLiveSnapshot(gameId, after);
        return json(snapshot);
      }

      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.startsWith('No adapter registered') ? 404 : 502;
      return json({ error: status === 404 ? 'esport_not_supported' : 'upstream_failure', message }, status);
    }
  };
}
