import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

interface MobileScoreboardRenderedDetail {
  root: HTMLElement;
  snapshot: LiveSnapshot<LolStats> | null;
  mode: 'live' | 'history';
}

const appliedKeys = new WeakMap<HTMLElement, string>();
const BOARD_SELECTOR = [
  '.mobile-live-history-board[data-mobile-scoreboard-renderer="shared-v1"]',
  '#completed-match-detail [data-mobile-scoreboard-renderer="shared-v1"]'
].join(', ');
const OBJECTIVE_TITLE_SELECTOR = [
  '.mobile-scoreboard-objective-title',
  '.mobile-live-parity-objective-title'
].join(', ');

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .completed-final-game-header{
    display:flex!important;
    align-items:center!important;
    justify-content:space-between!important;
    gap:12px!important;
    min-height:42px!important;
    padding:8px 12px!important;
    color:#dce8f7!important;
    background:rgba(6,18,34,.82)!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .completed-final-game-header strong{
    overflow:hidden!important;
    min-width:0!important;
    color:#f4f8ff!important;
    font-size:.72rem!important;
    font-weight:900!important;
    line-height:1.15!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-game-clock{
    display:block!important;
    flex:0 0 auto!important;
    min-width:42px!important;
    color:#9fcaf4!important;
    font-size:.74rem!important;
    font-weight:900!important;
    font-variant-numeric:tabular-nums!important;
    letter-spacing:.02em!important;
    text-align:right!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-title,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-live-parity-objective-title{
    display:none!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objectives{
    padding:11px 9px 12px!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-grid{
    display:grid!important;
    grid-template-columns:repeat(4,minmax(0,1fr))!important;
    gap:6px!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective{
    display:grid!important;
    align-content:center!important;
    justify-items:center!important;
    gap:6px!important;
    min-width:0!important;
    min-height:58px!important;
    padding:8px 3px!important;
    border:1px solid rgba(126,165,209,.12)!important;
    border-radius:8px!important;
    background:rgba(11,26,45,.56)!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective>span{
    overflow:visible!important;
    width:100%!important;
    color:#a9bad0!important;
    font-size:.56rem!important;
    font-weight:900!important;
    line-height:1.05!important;
    letter-spacing:.02em!important;
    text-align:center!important;
    text-overflow:clip!important;
    white-space:normal!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-values{
    display:flex!important;
    align-items:baseline!important;
    justify-content:center!important;
    gap:4px!important;
    width:100%!important;
    font-variant-numeric:tabular-nums!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-values strong{
    font-size:.92rem!important;
    font-weight:950!important;
    line-height:1!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-values i{
    color:#617188!important;
    font-size:.62rem!important;
    font-style:normal!important;
    font-weight:800!important
  }
}
`;
document.head.append(style);

function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function stateLabel(detail: MobileScoreboardRenderedDetail): string {
  if (detail.mode === 'history' || detail.snapshot?.game.state === 'completed') return 'Final';
  if (detail.snapshot?.game.state === 'paused') return 'Paused';
  if (detail.snapshot?.game.state === 'draft') return 'Draft';
  const boardState = detail.root.dataset.liveBoardState;
  if (boardState === 'pending') return 'Telemetry pending';
  if (boardState === 'stale') return 'Last verified';
  return 'Live';
}

function directHeader(root: HTMLElement): HTMLElement {
  const existing = [...root.children].find(
    child => child instanceof HTMLElement && child.matches('.completed-final-game-header')
  );
  if (existing instanceof HTMLElement) return existing;
  const header = document.createElement('div');
  header.className = 'completed-final-game-header';
  root.prepend(header);
  return header;
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

function setAttribute(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function removeObjectiveTitles(root: HTMLElement): boolean {
  const titles = root.querySelectorAll<HTMLElement>(OBJECTIVE_TITLE_SELECTOR);
  titles.forEach(element => element.remove());
  return titles.length > 0;
}

function applyReadability(detail: MobileScoreboardRenderedDetail): void {
  const { root, snapshot, mode } = detail;
  if (!(root instanceof HTMLElement) || root === document.documentElement) return;

  const clockText = formatClock(snapshot?.stats?.gameClockSeconds);
  const key = JSON.stringify({
    mode,
    gameId: snapshot?.game.id ?? root.dataset.finalGameId ?? '',
    gameNumber: snapshot?.game.number ?? null,
    gameState: snapshot?.game.state ?? '',
    boardState: root.dataset.liveBoardState ?? '',
    clockText
  });
  const hasObjectiveTitle = Boolean(root.querySelector(OBJECTIVE_TITLE_SELECTOR));
  if (
    appliedKeys.get(root) === key
    && !hasObjectiveTitle
    && root.dataset.mobileScoreboardReadability === 'v24'
  ) return;

  const header = directHeader(root);
  let heading = header.querySelector<HTMLElement>(':scope > strong');
  if (!heading) {
    heading = document.createElement('strong');
    header.append(heading);
  }
  let clock = header.querySelector<HTMLElement>(':scope > span');
  if (!clock) {
    clock = document.createElement('span');
    header.append(clock);
  }

  if (snapshot?.game.number !== undefined) {
    setText(heading, `Game ${snapshot.game.number} · ${stateLabel(detail)}`);
  }
  if (!clock.classList.contains('mobile-scoreboard-game-clock')) {
    clock.classList.add('mobile-scoreboard-game-clock');
  }
  if (mode === 'live') {
    if (clock.id !== 'live-game-clock') clock.id = 'live-game-clock';
  } else if (clock.hasAttribute('id')) {
    clock.removeAttribute('id');
  }
  setText(clock, clockText);
  setAttribute(clock, 'aria-label', `Game time ${clockText}`);
  removeObjectiveTitles(root);
  if (root.dataset.mobileScoreboardReadability !== 'v24') {
    root.dataset.mobileScoreboardReadability = 'v24';
  }
  appliedKeys.set(root, key);
}

window.addEventListener('esports-live:mobile-scoreboard-rendered', event => {
  const detail = (event as CustomEvent<MobileScoreboardRenderedDetail>).detail;
  if (!detail?.root) return;
  applyReadability(detail);
});

function cleanExistingBoards(): void {
  document.querySelectorAll<HTMLElement>(BOARD_SELECTOR).forEach(root => {
    removeObjectiveTitles(root);
    if (root.dataset.mobileScoreboardReadability !== 'v24') {
      root.dataset.mobileScoreboardReadability = 'v24';
    }
  });
  document.documentElement.dataset.mobileScoreboardReadability = 'game-clock-objectives-v24';
}

queueMicrotask(cleanExistingBoards);
window.addEventListener('pageshow', cleanExistingBoards);
document.documentElement.dataset.mobileScoreboardReadability = 'game-clock-objectives-v24';

export {};
