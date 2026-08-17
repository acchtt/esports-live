const RECENT_HISTORY_LIMIT = 24;

function scheduleUrl(input: RequestInfo | URL): URL | null {
  try {
    const value = input instanceof Request ? input.url : String(input);
    return new URL(value, window.location.href);
  } catch {
    return null;
  }
}

function rewrittenInput(input: RequestInfo | URL, fullHistory: boolean): RequestInfo | URL {
  const url = scheduleUrl(input);
  if (!url || !url.pathname.endsWith('/v1/lol/schedule')) return input;
  if (url.searchParams.get('states') !== 'completed') return input;

  if (fullHistory) url.searchParams.delete('limit');
  else url.searchParams.set('limit', String(RECENT_HISTORY_LIMIT));

  return input instanceof Request
    ? new Request(url.toString(), input)
    : url.toString();
}

export function installHomeDataPolicy(root: ParentNode): () => void {
  const upstreamFetch = window.fetch.bind(window);
  let fullHistory = false;
  document.documentElement.dataset.v3HistoryMode = 'recent';

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (
    upstreamFetch(rewrittenInput(input, fullHistory), init)
  )) as typeof window.fetch;

  const handleClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const filter = target?.closest<HTMLElement>('[data-match-filter]')?.dataset.matchFilter;
    if (!filter) return;

    if (filter === 'ended') {
      const shouldRefresh = !fullHistory;
      fullHistory = true;
      document.documentElement.dataset.v3HistoryMode = 'full';
      if (shouldRefresh) {
        queueMicrotask(() => root.querySelector<HTMLButtonElement>('#refresh-data')?.click());
      }
      return;
    }

    fullHistory = false;
    document.documentElement.dataset.v3HistoryMode = 'recent';
  };

  root.addEventListener('click', handleClick, true);
  return () => {
    root.removeEventListener('click', handleClick, true);
    window.fetch = upstreamFetch;
    delete document.documentElement.dataset.v3HistoryMode;
  };
}
