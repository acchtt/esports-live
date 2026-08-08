import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');

let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let repairQueued = false;
let dispatchingRepair = false;
let attemptKey = '';
let attempts = 0;

function liveModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext !== 'history';
}

function isCurrentHistoryDesign(board: HTMLElement): boolean {
  return document.documentElement.dataset.mobileLiveHistoryDesign === 'v20'
    && board.dataset.mobileLiveDesign === 'history-current'
    && Boolean(board.querySelector('.completed-team-comparison.mobile-live-parity-comparison'))
    && Boolean(board.querySelector('.mobile-live-parity-team-strip'))
    && Boolean(board.querySelector('.mobile-live-parity-objectives'))
    && board.querySelectorAll('.completed-final-matchups .role-matchup-row').length === 5;
}

function isLegacyHistoryCopy(board: HTMLElement): boolean {
  return Boolean(board.querySelector('.completed-team-comparison.completed-history-dashboard-v2'))
    && Boolean(board.querySelector('.history-v2-team-header'))
    && Boolean(board.querySelector('.history-v2-summary'))
    && Boolean(board.querySelector('.history-v2-objectives'))
    && board.querySelectorAll('.completed-final-matchups .role-matchup-row').length === 5;
}

function isCompleteHistoryCopy(board: HTMLElement): boolean {
  return board.dataset.mobileHistoryCopy === 'true'
    && (isCurrentHistoryDesign(board) || isLegacyHistoryCopy(board));
}

function repairBoard(): void {
  repairQueued = false;
  if (!gameContent || !liveModeActive()) return;

  const board = gameContent.querySelector<HTMLElement>('.mobile-live-history-board');
  if (!board || isCompleteHistoryCopy(board)) return;

  const snapshot = latestSnapshot;
  if (!snapshot?.stats) return;

  const key = `${snapshot.game.id}|${snapshot.quality.sourceTimestamp ?? snapshot.quality.observedAt}`;
  if (key !== attemptKey) {
    attemptKey = key;
    attempts = 0;
  }
  if (attempts >= 4) return;
  attempts += 1;

  board.removeAttribute('data-mobile-render-key');
  dispatchingRepair = true;
  window.dispatchEvent(new CustomEvent<LiveSnapshot<LolStats>>('esports-live:snapshot', {
    detail: snapshot
  }));
  dispatchingRepair = false;

  requestAnimationFrame(queueRepair);
}

function queueRepair(): void {
  if (repairQueued) return;
  repairQueued = true;
  queueMicrotask(repairBoard);
}

window.addEventListener('esports-live:snapshot', event => {
  if (!dispatchingRepair) {
    const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
    if (snapshot?.game?.id) latestSnapshot = snapshot;
  }
  queueRepair();
});

if (gameContent) {
  new MutationObserver(queueRepair).observe(gameContent, {
    childList: true,
    subtree: true
  });
}

new MutationObserver(queueRepair).observe(body, {
  attributes: true,
  attributeFilter: ['data-mobile-view', 'data-mobile-context']
});

window.addEventListener('pageshow', queueRepair);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueRepair);
else if (typeof media.addListener === 'function') media.addListener(queueRepair);
queueRepair();

export {};
