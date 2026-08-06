import type { LiveSnapshot, ScheduleEvent } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

interface MobileScoreboardRenderedDetail {
  root: HTMLElement;
  snapshot?: LiveSnapshot<LolStats> | null;
  mode?: 'live' | 'history';
}

interface EndedSnapshotDetail {
  root?: HTMLElement;
  snapshot?: LiveSnapshot<LolStats>;
}

const BOARD_SELECTOR = '[data-mobile-scoreboard-renderer="shared-v1"]';
const snapshots = new Map<string, LiveSnapshot<LolStats>>();
const endedGameIds = new Set<string>();
let selection: ScheduleEvent | null = null;
let applyQueued = false;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active ${BOARD_SELECTOR} .completed-final-game-header{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;
    align-items:baseline!important;
    column-gap:12px!important
  }
  body.mobile-demo-active ${BOARD_SELECTOR} .mobile-scoreboard-game-clock,
  body.mobile-demo-active ${BOARD_SELECTOR} .mobile-scoreboard-game-label{
    align-self:baseline!important;
    margin:0!important;
    line-height:1!important
  }
  body.mobile-demo-active ${BOARD_SELECTOR} .mobile-scoreboard-game-clock{
    justify-self:start!important
  }
  body.mobile-demo-active ${BOARD_SELECTOR} .mobile-scoreboard-game-label{
    justify-self:end!important
  }
}`;
document.head.append(style);

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function gameIdFor(root: HTMLElement, snapshot: LiveSnapshot<LolStats> | null): string {
  return snapshot?.game.id
    ?? root.dataset.mobileUnifiedGameId
    ?? root.dataset.liveHistoryGameId
    ?? root.dataset.finalGameId
    ?? '';
}

function selectionGame(gameId: string) {
  return selection?.series.games.find(game => game.id === gameId) ?? null;
}

function gameNumberFor(
  root: HTMLElement,
  snapshot: LiveSnapshot<LolStats> | null,
  gameId: string
): number | undefined {
  const selected = selectionGame(gameId);
  if (selected?.number !== undefined) return selected.number;
  if (snapshot?.game.number !== undefined) return snapshot.game.number;

  const datasetNumber = positiveInteger(
    root.dataset.mobileUnifiedGameNumber
      ?? root.dataset.finalGameNumber
      ?? root.dataset.gameNumber
  );
  if (datasetNumber !== undefined) return datasetNumber;

  const headerNumber = positiveInteger(
    root.querySelector<HTMLElement>('.mobile-scoreboard-game-label')
      ?.textContent?.match(/\bGame\s+(\d+)\b/i)?.[1]
  );
  if (headerNumber !== undefined) return headerNumber;

  return positiveInteger(gameId.match(/(?:^|[-_])(\d+)$/)?.[1]);
}

function isCompleted(
  root: HTMLElement,
  snapshot: LiveSnapshot<LolStats> | null,
  gameId: string
): boolean {
  return root.dataset.mobileScoreboardGameState === 'completed'
    || endedGameIds.has(gameId)
    || selectionGame(gameId)?.state === 'completed'
    || snapshot?.game.state === 'completed';
}

function enforceHeaderAlignment(root: HTMLElement): void {
  const header = root.querySelector<HTMLElement>(':scope > .completed-final-game-header');
  const clock = header?.querySelector<HTMLElement>(':scope > .mobile-scoreboard-game-clock');
  const label = header?.querySelector<HTMLElement>(':scope > .mobile-scoreboard-game-label');
  if (!header || !clock || !label) return;

  header.style.setProperty('display', 'grid', 'important');
  header.style.setProperty('grid-template-columns', 'minmax(0, 1fr) minmax(0, 1fr)', 'important');
  header.style.setProperty('align-items', 'baseline', 'important');
  header.style.setProperty('column-gap', '12px', 'important');
  clock.style.setProperty('align-self', 'baseline', 'important');
  clock.style.setProperty('justify-self', 'start', 'important');
  clock.style.setProperty('line-height', '1', 'important');
  label.style.setProperty('align-self', 'baseline', 'important');
  label.style.setProperty('justify-self', 'end', 'important');
  label.style.setProperty('line-height', '1', 'important');
  root.dataset.mobileGameHeaderAlignment = 'baseline-v28';
}

function applyBoard(
  root: HTMLElement,
  suppliedSnapshot: LiveSnapshot<LolStats> | null = null
): void {
  const suppliedGameId = suppliedSnapshot?.game.id ?? '';
  const rootGameId = gameIdFor(root, null);
  const gameId = rootGameId || suppliedGameId;
  const snapshot = suppliedGameId === gameId
    ? suppliedSnapshot
    : snapshots.get(gameId) ?? suppliedSnapshot;

  if (gameId && isCompleted(root, snapshot, gameId)) {
    endedGameIds.add(gameId);
    root.dataset.mobileScoreboardGameState = 'completed';
    root.dataset.mobileEndedState = 'final-v28';
    const label = root.querySelector<HTMLElement>('.mobile-scoreboard-game-label');
    const number = gameNumberFor(root, snapshot, gameId);
    if (label) {
      const value = number === undefined ? 'Final' : `Game ${number} · Final`;
      if (label.textContent !== value) label.textContent = value;
      label.setAttribute('aria-label', value);
    }
  }

  enforceHeaderAlignment(root);
  document.documentElement.dataset.mobileEndedGameStatus = 'terminal-state-v28';
  document.documentElement.dataset.mobileGameHeaderAlignment = 'baseline-v28';
}

function applyAllBoards(): void {
  applyQueued = false;
  document.querySelectorAll<HTMLElement>(BOARD_SELECTOR).forEach(root => applyBoard(root));
}

function queueApply(): void {
  if (applyQueued) return;
  applyQueued = true;
  queueMicrotask(applyAllBoards);
}

window.addEventListener('esports-live:selection', event => {
  selection = (event as CustomEvent<ScheduleEvent>).detail;
  selection?.series.games.forEach(game => {
    if (game.state === 'completed') endedGameIds.add(game.id);
  });
  queueApply();
});

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.game?.id) return;
  snapshots.set(snapshot.game.id, snapshot);
  if (snapshot.game.state === 'completed') endedGameIds.add(snapshot.game.id);
  queueApply();
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<EndedSnapshotDetail>).detail;
  const snapshot = detail?.snapshot ?? null;
  if (snapshot?.game?.id) {
    snapshots.set(snapshot.game.id, snapshot);
    endedGameIds.add(snapshot.game.id);
  }
  if (detail?.root) queueMicrotask(() => applyBoard(detail.root!, snapshot));
  queueApply();
});

window.addEventListener('esports-live:mobile-scoreboard-rendered', event => {
  const detail = (event as CustomEvent<MobileScoreboardRenderedDetail>).detail;
  const snapshot = detail?.snapshot ?? null;
  if (snapshot?.game?.id) {
    snapshots.set(snapshot.game.id, snapshot);
    if (snapshot.game.state === 'completed') endedGameIds.add(snapshot.game.id);
  }
  if (detail?.root) queueMicrotask(() => applyBoard(detail.root, snapshot));
});

const gameContent = document.querySelector<HTMLElement>('#game-content');
if (gameContent) new MutationObserver(queueApply).observe(gameContent, { childList: true, subtree: true });
const completedDetail = document.querySelector<HTMLElement>('#completed-match-detail');
if (completedDetail) new MutationObserver(queueApply).observe(completedDetail, { childList: true, subtree: true });

window.addEventListener('pageshow', queueApply);
queueApply();

export {};
