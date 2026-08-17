interface TeamScheduleMetadata {
  name: string;
  code: string;
}

export interface SeriesScheduleMetadata {
  seriesId: string;
  competition: string;
  scheduledStart: string;
  bestOf: number;
  teams: readonly [TeamScheduleMetadata, TeamScheduleMetadata];
}

const seriesMetadata = new Map<string, SeriesScheduleMetadata>();
let lastScheduleUpdateAt = 0;

function isV2BaselinePath(pathname = window.location.pathname): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, window.location.href);
    if (input instanceof URL) return new URL(input.href);
    return new URL(input.url, window.location.href);
  } catch {
    return null;
  }
}

function capture(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const events = (value as {
    events?: readonly {
      series?: {
        id?: string;
        competition?: { name?: string };
        scheduledStart?: string;
        bestOf?: number;
        teams?: readonly { name?: string; code?: string | null }[];
      };
    }[];
  }).events;
  if (!Array.isArray(events)) return;

  let changed = false;
  events.forEach(event => {
    const series = event.series;
    const id = String(series?.id ?? '').trim();
    const start = String(series?.scheduledStart ?? '').trim();
    const teams = series?.teams ?? [];
    if (!id || !start || teams.length < 2) return;

    const next: SeriesScheduleMetadata = {
      seriesId: id,
      competition: String(series?.competition?.name ?? '').trim(),
      scheduledStart: start,
      bestOf: Number(series?.bestOf ?? 3) || 3,
      teams: [
        { name: String(teams[0]?.name ?? 'Team 1'), code: String(teams[0]?.code ?? '').trim() },
        { name: String(teams[1]?.name ?? 'Team 2'), code: String(teams[1]?.code ?? '').trim() }
      ]
    };
    const previous = seriesMetadata.get(id);
    const signature = JSON.stringify(next);
    if (!previous || JSON.stringify(previous) !== signature) {
      seriesMetadata.set(id, next);
      changed = true;
    }
  });

  lastScheduleUpdateAt = Date.now();
  window.dispatchEvent(new CustomEvent('arena:v3-schedule-metadata', {
    detail: { changed, updatedAt: lastScheduleUpdateAt }
  }));
}

export function metadataForSeries(seriesId: string): SeriesScheduleMetadata | null {
  return seriesMetadata.get(seriesId) ?? null;
}

export function scheduleMetadataUpdatedAt(): number {
  return lastScheduleUpdateAt;
}

export function installScheduleMetadataCapture(): () => void {
  if (isV2BaselinePath()) return () => undefined;
  const upstream = window.fetch;

  const wrapped: typeof window.fetch = async (input, init) => {
    const response = await upstream(input, init);
    const url = requestUrl(input);
    if (response.ok && url?.pathname.endsWith('/v1/lol/schedule')) {
      void response.clone().json().then(capture).catch(() => undefined);
    }
    return response;
  };

  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = upstream;
  };
}
