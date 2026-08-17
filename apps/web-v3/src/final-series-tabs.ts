interface SeriesGameState {
  id?: string;
  state?: string;
}

interface SeriesState {
  id?: string;
  state?: string;
  games?: readonly SeriesGameState[];
}

interface StoredSeriesState {
  completed: boolean;
  games: Map<string, string>;
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return new URL(input.href);
    return new URL(String(input), window.location.href);
  } catch {
    return null;
  }
}

function relevantResponse(url: URL): boolean {
  return url.pathname.endsWith('/v1/lol/schedule')
    || /\/v1\/lol\/games\/[^/]+\/live$/.test(url.pathname);
}

function currentSeriesId(): string | null {
  const match = window.location.pathname.match(/(?:^|\/)match\/([^/]+)(?:\/|$)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function installFinalSeriesTabs(root: HTMLElement): () => void {
  const nativeFetch = window.fetch.bind(window);
  const seriesStates = new Map<string, StoredSeriesState>();
  let syncQueued = false;

  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      sync();
    });
  };

  const rememberSeries = (series: SeriesState | null | undefined): void => {
    const id = String(series?.id ?? '').trim();
    if (!id) return;

    const previous = seriesStates.get(id);
    const completed = previous?.completed === true || series?.state === 'completed';
    const games = new Map(previous?.games ?? []);
    series?.games?.forEach(game => {
      const gameId = String(game?.id ?? '').trim();
      const state = String(game?.state ?? '').trim();
      if (!gameId || !state) return;
      if (games.get(gameId) === 'completed') return;
      games.set(gameId, state);
    });
    seriesStates.set(id, { completed, games });
    queueSync();
  };

  const rememberPayload = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const payload = value as {
      events?: readonly { series?: SeriesState }[];
      series?: SeriesState;
    };
    payload.events?.forEach(event => rememberSeries(event.series));
    rememberSeries(payload.series);
  };

  function sync(): void {
    const tabs = root.querySelector<HTMLElement>('#game-tabs');
    if (!tabs) return;

    const seriesId = currentSeriesId();
    const finalSeries = seriesId ? seriesStates.get(seriesId) : null;
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('[data-game-id]')];

    if (!finalSeries?.completed) {
      buttons.forEach(button => {
        if (button.dataset.finalSeriesHidden === 'true') button.hidden = false;
        delete button.dataset.finalSeriesHidden;
      });
      return;
    }

    buttons.forEach(button => {
      const gameId = button.dataset.gameId ?? '';
      const state = finalSeries.games.get(gameId);
      const hide = Boolean(state && state !== 'completed');
      button.hidden = hide;
      if (hide) button.dataset.finalSeriesHidden = 'true';
      else delete button.dataset.finalSeriesHidden;
    });

    const visibleCount = buttons.filter(button => !button.hidden).length;
    tabs.hidden = visibleCount <= 1;
    tabs.style.setProperty('--game-tab-count', String(Math.max(1, visibleCount)));
  }

  const wrappedFetch: typeof window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const url = requestUrl(input);
    if (response.ok && url && relevantResponse(url)) {
      void response.clone().json().then(rememberPayload).catch(() => undefined);
    }
    return response;
  };

  window.fetch = wrappedFetch;

  const observer = new MutationObserver(queueSync);
  observer.observe(root, { childList: true, subtree: true });
  window.addEventListener('popstate', queueSync);
  queueSync();

  return () => {
    observer.disconnect();
    window.removeEventListener('popstate', queueSync);
    if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
  };
}
