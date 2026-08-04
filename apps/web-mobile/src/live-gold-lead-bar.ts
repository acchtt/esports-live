import './live-gold-lead-bar.css';
import './live-summary-compact.css';

export {};

const gameContent = document.querySelector<HTMLElement>('#game-content');
const selectedSeries = document.querySelector<HTMLElement>('#selected-series');
const scheduleList = document.querySelector<HTMLElement>('#schedule-list');

let cleanupQueued = false;
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

function compactBoardHeader(header: HTMLElement): void {
  if (header.classList.contains('compact-matchup-header')) return;

  const teamNames = header.querySelectorAll<HTMLElement>(':scope > strong');
  const blueStats = header.querySelector<HTMLElement>(':scope > span.blue');
  const redStats = header.querySelector<HTMLElement>(':scope > span.red');
  if (teamNames.length < 2 || !blueStats || !redStats) return;

  const blueName = teamNames[0]?.textContent?.trim() || 'Blue team';
  const redName = teamNames[1]?.textContent?.trim() || 'Red team';

  header.classList.add('compact-matchup-header');
  header.innerHTML = `
    <div class="v2-board-side blue">
      <span class="v2-board-side-label">BLUE</span>
      <strong>${blueName}</strong>
      <span class="v2-board-side-stats">${blueStats.innerHTML}</span>
    </div>
    <div class="v2-board-center" aria-hidden="true">
      <small>LIVE BOARD</small>
      <b>VS</b>
    </div>
    <div class="v2-board-side red">
      <span class="v2-board-side-stats">${redStats.innerHTML}</span>
      <strong>${redName}</strong>
      <span class="v2-board-side-label">RED</span>
    </div>`;
}

function applyLiveSummaryLayout(): void {
  cleanupQueued = false;

  document.querySelectorAll<HTMLElement>('.live-dashboard-v2 .v2-summary-row')
    .forEach(row => row.classList.remove('gold-lead-removed'));

  document.querySelectorAll<HTMLElement>('.live-dashboard-v2 .v2-gold-bars')
    .forEach(bar => bar.remove());

  document.querySelectorAll<HTMLElement>('.live-dashboard-v2 .v2-board-head')
    .forEach(compactBoardHeader);
}

function queueLiveSummaryLayout(): void {
  if (cleanupQueued) return;
  cleanupQueued = true;
  queueMicrotask(applyLiveSummaryLayout);
}

const gameObserver = gameContent
  ? new MutationObserver(queueLiveSummaryLayout)
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
});

captureStableSeriesScore();
queueLiveSummaryLayout();
