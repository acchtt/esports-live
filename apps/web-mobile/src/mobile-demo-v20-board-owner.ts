import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { applyMobileScoreboard } from './mobile-scoreboard-renderer.ts';

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');
const snapshots = new Map<string, LiveSnapshot<LolStats>>();
let applyQueued = false;

function liveModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext !== 'history';
}

function gameIdFor(board: HTMLElement): string {
  return board.dataset.mobileUnifiedGameId
    ?? board.dataset.liveHistoryGameId
    ?? board.dataset.finalGameId
    ?? '';
}

function applyBoard(board: HTMLElement, suppliedSnapshot: LiveSnapshot<LolStats> | null = null): void {
  if (!liveModeActive() || board.dataset.mobileHistoryCopy !== 'true') return;
  const gameId = gameIdFor(board);
  const snapshot = suppliedSnapshot?.game.id === gameId
    ? suppliedSnapshot
    : snapshots.get(gameId) ?? suppliedSnapshot;
  applyMobileScoreboard(board, snapshot ?? null, { mode: 'live' });
}

function applyCurrentBoard(): void {
  applyQueued = false;
  if (!gameContent || !liveModeActive()) return;
  gameContent.querySelectorAll<HTMLElement>(
    '.mobile-live-history-board[data-mobile-history-copy="true"]'
  ).forEach(board => applyBoard(board));
}

function queueApply(): void {
  if (applyQueued) return;
  applyQueued = true;
  queueMicrotask(applyCurrentBoard);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (snapshot?.game?.id) snapshots.set(snapshot.game.id, snapshot);
  queueApply();
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{
    snapshot?: LiveSnapshot<LolStats>;
    root?: HTMLElement;
  }>).detail;
  if (detail?.snapshot?.game?.id) snapshots.set(detail.snapshot.game.id, detail.snapshot);
  if (detail?.root) queueMicrotask(() => applyBoard(detail.root!, detail.snapshot ?? null));
});

if (gameContent) {
  new MutationObserver(queueApply).observe(gameContent, {
    childList: true,
    subtree: true
  });
}

new MutationObserver(queueApply).observe(body, {
  attributes: true,
  attributeFilter: ['data-mobile-view', 'data-mobile-context']
});
window.addEventListener('pageshow', queueApply);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueApply);
else if (typeof media.addListener === 'function') media.addListener(queueApply);

queueApply();
document.documentElement.dataset.mobileLiveBoardOwnerV20 = 'shared-renderer';
document.documentElement.dataset.mobileLiveHistoryDesign = 'v20';
document.documentElement.dataset.mobileScoreboardRenderer = 'shared-v1';

export {};
