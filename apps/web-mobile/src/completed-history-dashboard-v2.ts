import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { applyMobileScoreboard } from './mobile-scoreboard-renderer.ts';

const media = window.matchMedia('(max-width: 760px)');
const detail = document.querySelector<HTMLElement>('#completed-match-detail');
const snapshots = new Map<string, LiveSnapshot<LolStats>>();
let scanQueued = false;

function historyRoot(root: HTMLElement): boolean {
  return media.matches && Boolean(root.closest('#completed-match-detail'));
}

function gameIdFor(root: HTMLElement): string {
  return root.dataset.finalGameId
    ?? root.dataset.mobileUnifiedGameId
    ?? root.dataset.liveHistoryGameId
    ?? '';
}

function applyHistoryBoard(root: HTMLElement, suppliedSnapshot: LiveSnapshot<LolStats> | null = null): void {
  if (!historyRoot(root)) return;
  const gameId = gameIdFor(root);
  const snapshot = suppliedSnapshot?.game.id === gameId
    ? suppliedSnapshot
    : snapshots.get(gameId) ?? suppliedSnapshot;
  if (!snapshot) return;
  applyMobileScoreboard(root, snapshot, { mode: 'history' });
}

function scanHistoryBoards(): void {
  scanQueued = false;
  if (!detail || !media.matches) return;
  detail.querySelectorAll<HTMLElement>(
    '.completed-final-game[data-final-game-id], .mobile-final-recovery[data-final-game-id]'
  ).forEach(root => applyHistoryBoard(root));
}

function queueScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(scanHistoryBoards);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (snapshot?.game?.id) snapshots.set(snapshot.game.id, snapshot);
  if (document.body.dataset.mobileContext === 'history') queueScan();
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detailEvent = (event as CustomEvent<{
    snapshot?: LiveSnapshot<LolStats>;
    root?: HTMLElement;
  }>).detail;
  if (detailEvent?.snapshot?.game?.id) {
    snapshots.set(detailEvent.snapshot.game.id, detailEvent.snapshot);
  }
  if (detailEvent?.root && historyRoot(detailEvent.root)) {
    queueMicrotask(() => applyHistoryBoard(detailEvent.root!, detailEvent.snapshot ?? null));
  }
});

if (detail) {
  new MutationObserver(queueScan).observe(detail, {
    childList: true,
    subtree: true
  });
}
window.addEventListener('pageshow', queueScan);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueScan);
else if (typeof media.addListener === 'function') media.addListener(queueScan);

queueScan();
document.documentElement.dataset.demoHistoryDashboardV2 = 'shared-renderer';
document.documentElement.dataset.mobileHistoryDashboardOwner = 'shared-v1';
document.documentElement.dataset.mobileScoreboardRenderer = 'shared-v1';

export {};
