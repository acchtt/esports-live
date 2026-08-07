import type {
  LiveSnapshot,
  SeriesContext,
  SeriesGameHistoryRef,
  SeriesGameRef,
  TeamRef
} from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const FINALITY_PROBE_MS = 5_000;
const CONTEXT_TIMEOUT_MS = 4_000;
const FOREGROUND_DEBOUNCE_MS = 250;

interface CachedContext {
  checkedAt: number;
  value: SeriesContext;
}

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.href);
  if (input instanceof URL) return new URL(input.href);
  return new URL(input.url, window.location.href);
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) return init.signal;
  return input instanceof Request ? input.signal : null;
}

function rewrittenInput(input: RequestInfo | URL, url: URL): RequestInfo | URL {
  if (input instanceof Request) return new Request(url.toString(), input);
  if (input instanceof URL) return url;
  return url.toString();
}

function gameIdFromPath(pathname: string): string | null {
  const match = pathname.match(/\/v1\/lol\/games\/([^/]+)\/live$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function isSchedulePath(pathname: string): boolean {
  return pathname.endsWith('/v1/lol/schedule');
}

function jsonResponse(response: Response, value: unknown): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function contextGame(
  context: SeriesContext,
  snapshot: LiveSnapshot<LolStats>
): SeriesGameHistoryRef | null {
  const games = context.history?.games ?? [];
  return games.find(game => game.id === snapshot.game.id)
    ?? games.find(game => game.number === snapshot.game.number)
    ?? null;
}

function mergedGames(
  snapshot: LiveSnapshot<LolStats>,
  context: SeriesContext
): readonly SeriesGameRef[] {
  const historyGames = context.history?.games ?? [];
  if (!historyGames.length) return snapshot.series.games;

  const used = new Set<string>();
  const merged: SeriesGameRef[] = snapshot.series.games.map(game => {
    const history = historyGames.find(candidate => candidate.id === game.id)
      ?? historyGames.find(candidate => candidate.number === game.number);
    if (!history) return game;
    used.add(history.id);
    return { id: game.id, number: game.number, state: history.state };
  });

  historyGames.forEach(game => {
    if (used.has(game.id) || merged.some(candidate => candidate.number === game.number)) return;
    merged.push({ id: game.id, number: game.number, state: game.state });
  });

  return merged.sort((left, right) => left.number - right.number);
}

function seriesIsCompleted(context: SeriesContext): boolean {
  const history = context.history;
  if (!history) return false;
  return history.score.some(entry => entry.wins >= history.winsRequired);
}

function applyContextFinality(
  snapshot: LiveSnapshot<LolStats>,
  context: SeriesContext
): LiveSnapshot<LolStats> {
  if (snapshot.game.state === 'completed') return snapshot;
  const game = contextGame(context, snapshot);
  if (!game || game.state !== 'completed') return snapshot;

  return {
    ...snapshot,
    series: {
      ...snapshot.series,
      state: seriesIsCompleted(context) ? 'completed' : snapshot.series.state,
      games: mergedGames(snapshot, context)
    },
    game: {
      ...snapshot.game,
      state: 'completed'
    },
    quality: {
      ...snapshot.quality,
      advancing: false,
      safeForLiveAnalysis: false
    }
  };
}

async function requestContext(
  nativeFetch: typeof window.fetch,
  seriesId: string,
  outerSignal: AbortSignal | null
): Promise<SeriesContext> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Lifecycle context request timed out.')),
    CONTEXT_TIMEOUT_MS
  );
  const abort = (): void => controller.abort(outerSignal?.reason);
  outerSignal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await nativeFetch(
      `${API_BASE}/v1/lol/series/${encodeURIComponent(seriesId)}/context?final=lifecycle-${Date.now()}`,
      { cache: 'no-store', signal: controller.signal }
    );
    if (!response.ok) throw new Error(`Lifecycle context request returned ${response.status}.`);
    return await response.json() as SeriesContext;
  } finally {
    window.clearTimeout(timeout);
    outerSignal?.removeEventListener('abort', abort);
  }
}

function teamKeys(team: TeamRef): readonly string[] {
  return [team.id, team.name, team.code]
    .map(normalized)
    .filter(Boolean);
}

export function installLiveLifecycle(root: HTMLElement): () => void {
  const nativeFetch = window.fetch.bind(window);
  const contexts = new Map<string, CachedContext>();
  const teamLogos = new Map<string, { name: string; imageUrl: string }>();
  let forceFreshGameId = '';
  let lastForegroundSignalAt = 0;
  let logoSyncQueued = false;

  const queueLogoSync = (): void => {
    if (logoSyncQueued) return;
    logoSyncQueued = true;
    queueMicrotask(() => {
      logoSyncQueued = false;
      syncTeamLogos();
    });
  };

  const rememberTeam = (team: TeamRef): void => {
    const imageUrl = team.imageUrl?.trim();
    if (!imageUrl) return;
    const value = { name: team.name, imageUrl };
    teamKeys(team).forEach(key => teamLogos.set(key, value));
  };

  const rememberSeriesTeams = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const payload = value as {
      events?: readonly { series?: { teams?: readonly TeamRef[] } }[];
      series?: { teams?: readonly TeamRef[] };
    };
    payload.events?.forEach(event => event.series?.teams?.forEach(rememberTeam));
    payload.series?.teams?.forEach(rememberTeam);
    queueLogoSync();
  };

  const logoForName = (name: string): { name: string; imageUrl: string } | null => {
    const key = normalized(name);
    return key ? teamLogos.get(key) ?? null : null;
  };

  const ensureLogo = (side: 'blue' | 'red'): HTMLImageElement | null => {
    const article = root.querySelector<HTMLElement>(`.team-side.${side}`);
    if (!article) return null;
    const id = `${side}-logo`;
    let image = article.querySelector<HTMLImageElement>(`#${id}`);
    if (image) return image;

    image = document.createElement('img');
    image.id = id;
    image.className = 'team-logo';
    image.alt = '';
    image.loading = 'eager';
    image.decoding = 'async';
    image.hidden = true;
    image.addEventListener('error', () => {
      image!.hidden = true;
    });

    const sideLabel = [...article.children].find(child => (
      child instanceof HTMLElement
      && child.tagName === 'SPAN'
      && /^(BLUE|RED) SIDE$/i.test(child.textContent?.trim() ?? '')
    ));
    if (sideLabel) sideLabel.replaceWith(image);
    else article.prepend(image);
    return image;
  };

  const syncTeamLogos = (): void => {
    (['blue', 'red'] as const).forEach(side => {
      const name = root.querySelector<HTMLElement>(`#${side}-name`)?.textContent?.trim() ?? '';
      const image = ensureLogo(side);
      if (!image) return;
      const logo = logoForName(name);
      if (!logo) {
        image.hidden = true;
        image.removeAttribute('src');
        image.alt = '';
        return;
      }
      if (image.getAttribute('src') !== logo.imageUrl) image.src = logo.imageUrl;
      image.alt = `${logo.name} logo`;
      image.hidden = false;
    });
  };

  const reconcileFinality = async (
    snapshot: LiveSnapshot<LolStats>,
    signal: AbortSignal | null,
    force: boolean
  ): Promise<LiveSnapshot<LolStats>> => {
    if (snapshot.game.state === 'completed') return snapshot;
    const seriesId = snapshot.series.id?.trim();
    if (!seriesId) return snapshot;

    const now = Date.now();
    const cached = contexts.get(seriesId);
    if (!force && cached && now - cached.checkedAt < FINALITY_PROBE_MS) {
      return applyContextFinality(snapshot, cached.value);
    }

    try {
      const context = await requestContext(nativeFetch, seriesId, signal);
      contexts.set(seriesId, { checkedAt: now, value: context });
      return applyContextFinality(snapshot, context);
    } catch {
      return cached ? applyContextFinality(snapshot, cached.value) : snapshot;
    }
  };

  const wrappedFetch: typeof window.fetch = async (input, init) => {
    let url = requestUrl(input);
    const gameId = gameIdFromPath(url.pathname);
    let forceFinalityProbe = false;
    let nextInput = input;

    if (gameId && forceFreshGameId && gameId === forceFreshGameId) {
      url = new URL(url.toString());
      url.searchParams.delete('after');
      url.searchParams.set('final', `foreground-${Date.now()}`);
      nextInput = rewrittenInput(input, url);
      forceFreshGameId = '';
      forceFinalityProbe = true;
    } else if (gameId && !url.searchParams.has('after')) {
      forceFinalityProbe = true;
    }

    const response = await nativeFetch(nextInput, init);
    if (!response.ok) return response;
    if (!gameId && !isSchedulePath(url.pathname)) return response;

    let value: unknown;
    try {
      value = await response.clone().json();
    } catch {
      return response;
    }

    rememberSeriesTeams(value);
    if (!gameId) return response;

    const snapshot = value as LiveSnapshot<LolStats>;
    if (!snapshot?.game?.id || !snapshot?.series?.id) return response;
    const reconciled = await reconcileFinality(
      snapshot,
      requestSignal(nextInput, init),
      forceFinalityProbe
    );
    return reconciled === snapshot ? response : jsonResponse(response, reconciled);
  };

  window.fetch = wrappedFetch;

  const activeGameId = (): string => (
    root.querySelector<HTMLElement>('#scoreboard')?.dataset.gameId?.trim() ?? ''
  );

  const markForeground = (dispatchVisibility: boolean): void => {
    if (document.hidden) return;
    const now = Date.now();
    if (now - lastForegroundSignalAt < FOREGROUND_DEBOUNCE_MS) return;
    lastForegroundSignalAt = now;
    forceFreshGameId = activeGameId();
    if (dispatchVisibility && forceFreshGameId) {
      document.dispatchEvent(new Event('visibilitychange'));
    }
  };

  const visibilityChanged = (): void => {
    if (!document.hidden) markForeground(false);
  };
  const focused = (): void => markForeground(true);
  const pageShown = (): void => markForeground(true);

  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('focus', focused);
  window.addEventListener('pageshow', pageShown);

  const observer = new MutationObserver(queueLogoSync);
  observer.observe(root, {
    childList: true,
    subtree: true,
    characterData: true
  });
  queueLogoSync();

  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('focus', focused);
    window.removeEventListener('pageshow', pageShown);
    if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
  };
}
