const completedDetail = document.querySelector<HTMLElement>('#completed-match-detail');

let cachedSeriesId: string | null = null;
let cachedTelemetryMarkup: string | null = null;
let syncQueued = false;
let restoring = false;

function selectedSeriesId(): string | null {
  return document.querySelector<HTMLElement>('[data-completed-series-id].selected')
    ?.dataset.completedSeriesId ?? null;
}

function inHistoryMode(): boolean {
  return document.body.dataset.viewMode === 'match-history'
    || document.querySelector<HTMLElement>('[data-mode="results"]')?.classList.contains('active') === true;
}

function captureTelemetry(): void {
  if (!completedDetail) return;
  const host = completedDetail.querySelector<HTMLElement>('#completed-final-telemetry');
  if (!host || host.querySelector('.completed-telemetry-loading')) return;
  const seriesId = selectedSeriesId();
  if (!seriesId) return;
  cachedSeriesId = seriesId;
  cachedTelemetryMarkup = host.outerHTML;
}

function bindRestoredTabs(host: HTMLElement): void {
  if (host.dataset.focusRestoreTabsBound === 'true') return;
  host.dataset.focusRestoreTabsBound = 'true';
  host.removeAttribute('data-final-game-tabs-bound');
  host.addEventListener('click', event => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-final-game-tab]')
      : null;
    if (!target || !host.contains(target)) return;
    const selected = target.dataset.finalGameTab;
    if (!selected) return;
    host.dataset.selectedFinalGame = selected;
    host.querySelectorAll<HTMLElement>('.completed-final-game').forEach((game, index) => {
      const number = game.querySelector('.completed-final-game-header strong')
        ?.textContent
        ?.match(/Game\s+(\d+)/i)?.[1] ?? String(index + 1);
      game.dataset.boardHidden = String(number !== selected);
    });
    host.querySelectorAll<HTMLButtonElement>('[data-final-game-tab]').forEach(button => {
      button.classList.toggle('active', button.dataset.finalGameTab === selected);
    });
  });
}

function restoreTelemetry(): void {
  syncQueued = false;
  if (!completedDetail || restoring || document.hidden || !inHistoryMode()) return;

  const existing = completedDetail.querySelector<HTMLElement>('#completed-final-telemetry');
  if (existing) {
    captureTelemetry();
    return;
  }

  const seriesId = selectedSeriesId();
  const detailReady = completedDetail.querySelector('.completed-games');
  if (!seriesId || !detailReady || seriesId !== cachedSeriesId || !cachedTelemetryMarkup) return;

  restoring = true;
  completedDetail.insertAdjacentHTML('beforeend', cachedTelemetryMarkup);
  const restored = completedDetail.querySelector<HTMLElement>('#completed-final-telemetry');
  if (restored) bindRestoredTabs(restored);
  restoring = false;
}

function queueRestore(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(restoreTelemetry);
}

if (completedDetail) {
  new MutationObserver(queueRestore).observe(completedDetail, { childList: true, subtree: true });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    captureTelemetry();
    return;
  }
  queueRestore();
  requestAnimationFrame(queueRestore);
  window.setTimeout(queueRestore, 250);
});

window.addEventListener('esports-live:completed-selection', event => {
  const seriesId = (event as CustomEvent<{ seriesId?: string }>).detail?.seriesId ?? null;
  if (seriesId && cachedSeriesId && seriesId !== cachedSeriesId) {
    cachedSeriesId = null;
    cachedTelemetryMarkup = null;
  }
  queueRestore();
});

captureTelemetry();
queueRestore();

export {};
