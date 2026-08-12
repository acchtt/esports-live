type V3Route =
  | { kind: 'catalogue' }
  | { kind: 'platform' }
  | { kind: 'match'; seriesId: string; gameId: string | null };

const MATCH_SCHEDULE_CACHE_MS = 120_000;
const HISTORY_SCHEDULE_CACHE_MS = 300_000;

function routeBase(pathname = window.location.pathname): '' | '/v3' {
  return pathname === '/v3' || pathname.startsWith('/v3/') ? '/v3' : '';
}

function stripRouteBase(pathname: string): string {
  const base = routeBase(pathname);
  if (!base) return pathname || '/';
  const stripped = pathname.slice(base.length);
  return stripped || '/';
}

function decodeSegment(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function currentV3Route(pathname = window.location.pathname): V3Route {
  const path = stripRouteBase(pathname).replace(/\/+$/, '') || '/';
  if (path === '/platform') return { kind: 'platform' };
  const match = path.match(/^\/match\/([^/]+)(?:\/([^/]+))?$/);
  const seriesId = decodeSegment(match?.[1]);
  if (!seriesId) return { kind: 'catalogue' };
  return {
    kind: 'match',
    seriesId,
    gameId: decodeSegment(match?.[2])
  };
}

function routePath(seriesId: string, gameId: string | null = null): string {
  const base = routeBase();
  const series = encodeURIComponent(seriesId);
  const game = gameId ? `/${encodeURIComponent(gameId)}` : '';
  return `${base}/match/${series}${game}`;
}

function cataloguePath(): string {
  const base = routeBase();
  return `${base}/`;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function scheduleView(input: RequestInfo | URL): 'matches' | 'history' | null {
  try {
    const url = new URL(requestUrl(input), window.location.href);
    if (!/\/v1\/lol\/schedule$/.test(url.pathname)) return null;
    return url.searchParams.get('states') === 'completed' ? 'history' : 'matches';
  } catch {
    return null;
  }
}

export function installV3RouteFetchPolicy(): void {
  if (currentV3Route().kind !== 'match') return;
  const nativeFetch = window.fetch.bind(window);
  const scheduleCache = new Map<string, { response: Response; storedAt: number; view: 'matches' | 'history' }>();

  window.fetch = async (...args) => {
    const view = scheduleView(args[0]);
    if (!view) return nativeFetch(...args);

    const key = requestUrl(args[0]);
    const cached = scheduleCache.get(key);
    const maxAge = view === 'history' ? HISTORY_SCHEDULE_CACHE_MS : MATCH_SCHEDULE_CACHE_MS;
    if (cached && Date.now() - cached.storedAt < maxAge) {
      return cached.response.clone();
    }

    const response = await nativeFetch(...args);
    if (response.ok) {
      scheduleCache.set(key, { response: response.clone(), storedAt: Date.now(), view });
    }
    return response;
  };
}

function matchingSeriesCard(root: HTMLElement, seriesId: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[data-series-id][data-source-view]')]
    .find(card => card.dataset.seriesId === seriesId) ?? null;
}

function matchingGameButton(root: HTMLElement, gameId: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('#game-tabs [data-game-id]')]
    .find(button => button.dataset.gameId === gameId) ?? null;
}

function withCommitQuery(path: string): string {
  const search = new URLSearchParams(window.location.search);
  const commit = search.get('commit');
  return commit ? `${path}?commit=${encodeURIComponent(commit)}` : path;
}

export function installV3Routing(root: HTMLElement): () => void {
  let applyingRoute = false;
  let scheduled = false;

  document.documentElement.dataset.arenaRoute = currentV3Route().kind;
  const build = root.querySelector<HTMLElement>('.build-pill');
  if (build) build.textContent = build.textContent?.replace(/^V2\s*·\s*/, 'V3 · ROUTED · ') ?? 'V3 · ROUTED';

  const applyRoute = (): void => {
    scheduled = false;
    const route = currentV3Route();
    document.documentElement.dataset.arenaRoute = route.kind;
    if (route.kind !== 'match') return;

    const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
    const currentSeriesTitle = root.querySelector<HTMLElement>('#detail-title')?.textContent?.trim() ?? '';
    const card = matchingSeriesCard(root, route.seriesId);
    const matchPanel = root.querySelector<HTMLElement>('#match-panel');

    if (card && matchPanel?.hidden !== false) {
      applyingRoute = true;
      card.click();
      applyingRoute = false;
      queueApply();
      return;
    }

    if (route.gameId && scoreboard?.dataset.gameId !== route.gameId) {
      const gameButton = matchingGameButton(root, route.gameId);
      if (gameButton) {
        applyingRoute = true;
        gameButton.click();
        applyingRoute = false;
        queueApply();
        return;
      }
    }

    const selectedGameId = scoreboard?.dataset.gameId?.trim() ?? '';
    if (selectedGameId && currentSeriesTitle) {
      const canonical = routePath(route.seriesId, selectedGameId);
      if (window.location.pathname !== canonical) {
        window.history.replaceState({ arenaV3: true }, '', withCommitQuery(canonical));
      }
    }
  };

  const queueApply = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(applyRoute);
  };

  const onClick = (event: MouseEvent): void => {
    if (applyingRoute) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const route = currentV3Route();
    const card = target.closest<HTMLElement>('[data-series-id][data-source-view]');
    if (card?.dataset.seriesId && route.kind !== 'match') {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(withCommitQuery(routePath(card.dataset.seriesId)));
      return;
    }

    const matchesNav = target.closest<HTMLElement>('[data-app-view="matches"]');
    if (matchesNav && route.kind === 'match') {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(withCommitQuery(cataloguePath()));
      return;
    }

    const game = target.closest<HTMLElement>('#game-tabs [data-game-id]');
    if (game?.dataset.gameId && route.kind === 'match') {
      const next = routePath(route.seriesId, game.dataset.gameId);
      if (window.location.pathname !== next) {
        window.history.pushState({ arenaV3: true }, '', withCommitQuery(next));
      }
    }
  };

  const onPopState = (): void => queueApply();
  const observer = new MutationObserver(queueApply);
  root.addEventListener('click', onClick, true);
  window.addEventListener('popstate', onPopState);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-game-id', 'hidden']
  });
  queueApply();

  return () => {
    observer.disconnect();
    root.removeEventListener('click', onClick, true);
    window.removeEventListener('popstate', onPopState);
  };
}
