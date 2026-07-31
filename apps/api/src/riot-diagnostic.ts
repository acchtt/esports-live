type Json = Record<string, unknown>;

const PERSISTED_BASE = 'https://esports-api.lolesports.com/persisted/gw';

const object = (value: unknown): Json => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
);
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function summaryTeam(value: unknown): Json {
  const team = object(value);
  return {
    keys: Object.keys(team).sort(),
    id: text(team.id ?? team.teamId),
    slug: text(team.slug),
    code: text(team.code ?? team.acronym),
    name: text(team.name),
    imagePresent: Boolean(text(team.image ?? team.imageUrl ?? team.logo)),
    playerCount: array(team.players).length,
    record: object(team.record)
  };
}

function summaryEvent(value: unknown): Json {
  const event = object(value);
  const match = object(event.match);
  return {
    eventKeys: Object.keys(event).sort(),
    eventId: text(event.id),
    startTime: text(event.startTime),
    league: object(event.league),
    matchKeys: Object.keys(match).sort(),
    matchId: text(match.id),
    teams: array(match.teams).map(summaryTeam)
  };
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function persisted(
  path: string,
  apiKey: string,
  values: readonly string[] = []
): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${PERSISTED_BASE}/${path}`);
  url.searchParams.set('hl', 'en-US');
  for (const value of values) url.searchParams.append('id', value);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'x-api-key': apiKey },
    cache: 'no-store'
  });
  const raw = await response.text();
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { nonJson: true }; }
  return { status: response.status, body };
}

function scheduleEvents(payload: unknown): readonly unknown[] {
  const root = object(payload);
  return array(object(object(root.data).schedule ?? root.schedule).events);
}

function eventDetails(payload: unknown): Json {
  const root = object(payload);
  return object(object(root.data).event ?? root.event ?? object(root.data));
}

function teamResponseSummary(result: { status: number; body: unknown }): Json {
  const root = object(result.body);
  const teams = array(object(root.data).teams ?? root.teams);
  return {
    status: result.status,
    topLevelKeys: Object.keys(root).sort(),
    dataKeys: Object.keys(object(root.data)).sort(),
    teamCount: teams.length,
    teams: teams.slice(0, 4).map(summaryTeam)
  };
}

export async function riotTeamDiagnostic(apiKey: string): Promise<Response> {
  if (!apiKey) {
    return Response.json({ error: 'missing_worker_secret' }, { status: 503 });
  }

  const scheduleResult = await persisted('getSchedule', apiKey);
  const events = scheduleEvents(scheduleResult.body);
  const preferred = events.find(value => {
    const league = object(object(value).league);
    return text(league.name)?.toLowerCase() === 'lck';
  }) ?? events[0];
  const event = object(preferred);
  const match = object(event.match);
  const eventId = text(event.id);
  const matchId = text(match.id);

  const detailAttempts: Json[] = [];
  for (const identifier of [eventId, matchId].filter((value): value is string => Boolean(value))) {
    const result = await persisted('getEventDetails', apiKey, [identifier]);
    const details = eventDetails(result.body);
    detailAttempts.push({
      identifier,
      status: result.status,
      event: summaryEvent(details)
    });
  }

  const scheduleTeams = array(match.teams).map(object);
  const detailsTeams = detailAttempts.flatMap(attempt => {
    const eventSummary = object(attempt.event);
    return array(eventSummary.teams).map(object);
  });

  const groups = new Map<string, string[]>();
  const addGroup = (name: string, values: readonly (string | null)[]): void => {
    const unique = [...new Set(values.filter((value): value is string => Boolean(value)))];
    if (unique.length) groups.set(name, unique);
  };

  addGroup('raw_ids', scheduleTeams.map(team => text(team.id ?? team.teamId)));
  addGroup('raw_slugs', scheduleTeams.map(team => text(team.slug)));
  addGroup('raw_codes', scheduleTeams.map(team => text(team.code ?? team.acronym)));
  addGroup('lower_codes', scheduleTeams.map(team => text(team.code ?? team.acronym)?.toLowerCase() ?? null));
  addGroup('slugified_names', scheduleTeams.map(team => {
    const name = text(team.name);
    return name ? slugify(name) : null;
  }));
  addGroup('detail_ids', detailsTeams.map(team => text(team.id ?? team.teamId)));
  addGroup('detail_slugs', detailsTeams.map(team => text(team.slug)));

  const lookups: Json[] = [];
  const noFilter = await persisted('getTeams', apiKey);
  lookups.push({ candidate: 'no_filter', values: [], result: teamResponseSummary(noFilter) });
  for (const [candidate, values] of groups) {
    const result = await persisted('getTeams', apiKey, values);
    lookups.push({ candidate, values, result: teamResponseSummary(result) });
  }

  return Response.json({
    generatedAt: new Date().toISOString(),
    scheduleStatus: scheduleResult.status,
    event: summaryEvent(event),
    detailAttempts,
    lookups
  }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
