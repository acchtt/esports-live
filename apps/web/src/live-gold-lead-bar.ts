import './live-gold-lead-bar.css';

export {};

const gameContent = document.querySelector<HTMLElement>('#game-content');
const selectedSeries = document.querySelector<HTMLElement>('#selected-series');
const scheduleList = document.querySelector<HTMLElement>('#schedule-list');

let cleanupFrame: number | null = null;
let focusGuardUntil = 0;
let stableSeriesId = '';
let stableSeriesHtml = '';

function currentSeriesId(): string {
  return scheduleList
    ?.querySelector<HTMLElement>('[data-series-id].selected')
    ?.dataset.seriesId ?? '';
}

function captureStableSeriesScore(): void {
  if (!selectedSeries?.querySelector('.history-header-score')) return;
  const seriesId = currentSeriesId();
  if (!seriesId) return;
  stableSeriesId = seriesId;
  stableSeriesHtml = selectedSeries.innerHTML;
}

function restoreTransientSeriesReset(): void {
  if (!selectedSeries) return;

  if (selectedSeries.querySelector('.history-header-score')) {
    captureStableSeriesScore();
    return;
  }

  const seriesId = currentSeriesId();
  const legacyTitle = selectedSeries.textContent ?? '';
  if (
    Date.now() > focusGuardUntil
    || !stableSeriesHtml
    || seriesId !== stableSeriesId
    || !/\s+vs\s+/i.test(legacyTitle)
  ) {
    return;
  }

  selectedSeries.innerHTML = stableSeriesHtml;
}

function simplifyGoldLeadCard(): void {
  cleanupFrame = null;
  document.querySelectorAll<HTMLElement>('.live-dashboard-v2 .v2-summary-row')
    .forEach(row => row.classList.remove('gold-lead-removed'));
  document.querySelectorAll<HTMLElement>('.live-dashboard-v2 .v2-gold-bars')
    .forEach(bar => bar.remove());
}

function queueGoldLeadSimplification(): void {
  if (cleanupFrame !== null) return;
  cleanupFrame = window.requestAnimationFrame(simplifyGoldLeadCard);
}

const gameObserver = gameContent
  ? new MutationObserver(queueGoldLeadSimplification)
  : null;
gameObserver?.observe(gameContent as HTMLElement, { childList: true, subtree: true });

const scoreObserver = selectedSeries
  ? new MutationObserver(restoreTransientSeriesReset)
  : null;
scoreObserver?.observe(selectedSeries as HTMLElement, {
  childList: true,
  subtree: true,
  characterData: true
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    captureStableSeriesScore();
    return;
  }

  focusGuardUntil = Date.now() + 4_000;
  queueMicrotask(restoreTransientSeriesReset);
});

window.addEventListener('esports-live:selection', () => {
  focusGuardUntil = 0;
  queueMicrotask(captureStableSeriesScore);
});

window.addEventListener('beforeunload', () => {
  gameObserver?.disconnect();
  scoreObserver?.disconnect();
  if (cleanupFrame !== null) window.cancelAnimationFrame(cleanupFrame);
});

captureStableSeriesScore();
queueGoldLeadSimplification();
