type V3Route =
  | { kind: 'catalogue' }
  | { kind: 'platform' }
  | { kind: 'match'; seriesId: string; gameId: string | null };

function isV2BaselinePath(pathname = window.location.pathname): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

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
  if (isV2BaselinePath(pathname)) return { kind: 'catalogue' };
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

function withCommitQuery(path: string): string {
  const search = new URLSearchParams(window.location.search);
  const commit = search.get('commit');
  return commit ? `${path}?commit=${encodeURIComponent(commit)}` : path;
}

function matchingSeriesCard(root: ParentNode, seriesId: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[data-series-id][data-source-view]')]
    .find(card => card.dataset.seriesId === seriesId) ?? null;
}

function matchingGameButton(root: HTMLElement, gameId: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('#game-tabs [data-game-id]')]
    .find(button => button.dataset.gameId === gameId) ?? null;
}

export function installV3Routing(root: HTMLElement): () => void {
  // `/v2/` is intentionally kept as an un-routed baseline surface so the inherited
  // V2 regression suite can validate that V3 still preserves every stable board
  // behavior independently of the new page-routing layer.
  if (isV2BaselinePath()) return () => undefined;

  let applyingRoute = false;
  let scheduled = false;
  let focusedScoreboardKey = '';
  let scoreboardFocusFrame: number | null = null;
  const cataloguePanel = root.querySelector<HTMLElement>('#catalogue-panel');
  const matchPanel = root.querySelector<HTMLElement>('#match-panel');

  const restoreCatalogue = (): void => {
    if (!cataloguePanel || cataloguePanel.isConnected) return;
    const parent = matchPanel?.parentNode;
    if (parent) parent.insertBefore(cataloguePanel, matchPanel);
  };

  const detachCatalogue = (): void => {
    if (!cataloguePanel?.isConnected) return;
    cataloguePanel.remove();
  };

  const focusScoreboard = (seriesId: string, gameId: string, scoreboard: HTMLElement): void => {
    const key = `${seriesId}:${gameId}`;
    if (focusedScoreboardKey === key) return;
    focusedScoreboardKey = key;
    if (scoreboardFocusFrame !== null) window.cancelAnimationFrame(scoreboardFocusFrame);
    scoreboardFocusFrame = window.requestAnimationFrame(() => {
      scoreboardFocusFrame = null;
      const route = currentV3Route();
      const activeScoreboard = root.querySelector<HTMLElement>('#scoreboard');
      if (
        route.kind !== 'match'
        || route.seriesId !== seriesId
        || activeScoreboard !== scoreboard
        || scoreboard.dataset.gameId?.trim() !== gameId
      ) return;
      scoreboard.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  };

  document.documentElement.dataset.arenaRoute = currentV3Route().kind;
  const build = root.querySelector<HTMLElement>('.build-pill');
  if (build) {
    build.textContent = build.textContent?.replace(/^V2\s*·\s*/, 'V3 · ROUTED · ') ?? 'V3 · ROUTED';
  }

  const queueApply = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(applyRoute);
  };

  const activateCatalogue = (): void => {
    restoreCatalogue();
    focusedScoreboardKey = '';
    if (scoreboardFocusFrame !== null) {
      window.cancelAnimationFrame(scoreboardFocusFrame);
      scoreboardFocusFrame = null;
    }
    if (matchPanel?.hidden !== false) return;
    const matches = root.querySelector<HTMLElement>('[data-app-view="matches"]');
    if (!matches) return;
    applyingRoute = true;
    matches.click();
    applyingRoute = false;
  };

  const applyRoute = (): void => {
    scheduled = false;
    const route = currentV3Route();
    document.documentElement.dataset.arenaRoute = route.kind;

    if (route.kind !== 'match') {
      activateCatalogue();
      return;
    }

    const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
    const selectedGameId = scoreboard?.dataset.gameId?.trim() ?? '';

    // Keep the catalogue connected only while a direct match route still needs it
    // to resolve/select the series. Once the match panel is active it stays detached
    // until navigation returns to the catalogue, avoiding a MutationObserver loop.
    if (matchPanel?.hidden !== false) {
      restoreCatalogue();
      const card = cataloguePanel ? matchingSeriesCard(cataloguePanel, route.seriesId) : null;
      if (card) {
        applyingRoute = true;
        card.click();
        applyingRoute = false;
        queueApply();
      }
      return;
    }

    if (route.gameId && selectedGameId !== route.gameId) {
      const gameButton = matchingGameButton(root, route.gameId);
      if (gameButton) {
        applyingRoute = true;
        gameButton.click();
        applyingRoute = false;
        queueApply();
        return;
      }
    }

    const currentGameId = scoreboard?.dataset.gameId?.trim() ?? '';
    if (currentGameId && scoreboard) {
      const canonical = routePath(route.seriesId, currentGameId);
      if (window.location.pathname !== canonical) {
        window.history.replaceState({ arenaV3: true }, '', withCommitQuery(canonical));
      }
      detachCatalogue();
      focusScoreboard(route.seriesId, currentGameId, scoreboard);
    }
  };

  const onClick = (event: MouseEvent): void => {
    if (applyingRoute) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const route = currentV3Route();
    const card = target.closest<HTMLElement>('[data-series-id][data-source-view]');
    if (card?.dataset.seriesId && route.kind !== 'match') {
      window.history.pushState(
        { arenaV3: true },
        '',
        withCommitQuery(routePath(card.dataset.seriesId))
      );
      document.documentElement.dataset.arenaRoute = 'match';
      queueApply();
      return;
    }

    const matchesNav = target.closest<HTMLElement>('[data-app-view="matches"]');
    if (matchesNav && route.kind !== 'catalogue') {
      restoreCatalogue();
      window.history.pushState({ arenaV3: true }, '', withCommitQuery(cataloguePath()));
      document.documentElement.dataset.arenaRoute = 'catalogue';
      focusedScoreboardKey = '';
      return;
    }

    const game = target.closest<HTMLElement>('#game-tabs [data-game-id]');
    if (game?.dataset.gameId && route.kind === 'match') {
      const next = routePath(route.seriesId, game.dataset.gameId);
      if (window.location.pathname !== next) {
        window.history.pushState({ arenaV3: true }, '', withCommitQuery(next));
      }
      queueApply();
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
    restoreCatalogue();
    if (scoreboardFocusFrame !== null) window.cancelAnimationFrame(scoreboardFocusFrame);
    observer.disconnect();
    root.removeEventListener('click', onClick, true);
    window.removeEventListener('popstate', onPopState);
  };
}
