import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';

type ObjectiveKey = 'towers' | 'dragons' | 'barons' | 'inhibitors';
type Side = 'blue' | 'red';

const OBJECTIVES: readonly [ObjectiveKey, string][] = [
  ['towers', 'Towers'],
  ['dragons', 'Dragons'],
  ['barons', 'Barons'],
  ['inhibitors', 'Inhibitors']
];

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');
const verifiedSnapshots = new Map<string, LiveSnapshot<LolStats>>();
let renderQueued = false;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"]) #game-content>.mobile-live-history-board[data-mobile-live-design="history-current"]{
    display:grid!important;
    gap:0!important;
    width:calc(100% - 12px)!important;
    max-width:none!important;
    margin:0 6px!important;
    padding:0!important;
    overflow:hidden!important;
    border:1px solid rgba(112,151,196,.18)!important;
    border-radius:16px!important;
    background:rgba(5,14,27,.96)!important;
    box-shadow:0 16px 36px rgba(0,0,0,.18)!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board[data-mobile-live-design="history-current"] .completed-final-game-header{
    min-height:36px!important;
    padding:7px 11px!important;
    border-bottom:1px solid rgba(112,151,196,.12)!important;
    color:#e8f3ff!important;
    background:rgba(8,19,35,.9)!important;
    font-size:.61rem!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board[data-mobile-live-design="history-current"] .completed-final-game-header span{
    color:#8192a9!important;
    font-size:.48rem!important;
    font-weight:800!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board[data-mobile-live-design="history-current"] .completed-team-comparison.mobile-live-parity-comparison{
    display:block!important;
    width:100%!important;
    min-width:0!important;
    padding:0!important;
    overflow:hidden!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important;
    box-shadow:none!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-team-strip{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) 78px minmax(0,1fr)!important;
    align-items:center!important;
    gap:7px!important;
    min-height:78px!important;
    padding:10px 9px!important;
    background:
      linear-gradient(90deg,rgba(3,105,161,.19),transparent 43%,transparent 57%,rgba(190,24,93,.18)),
      rgba(4,13,27,.74)!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-team{
    display:grid!important;
    gap:3px!important;
    min-width:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-team.red{
    text-align:right!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-team span{
    color:#38bdf8!important;
    font-size:.42rem!important;
    font-weight:900!important;
    letter-spacing:.07em!important;
    text-transform:uppercase!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-team.red span{
    color:#f472b6!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-team strong{
    display:block!important;
    overflow:hidden!important;
    color:#f2f7ff!important;
    font-size:.68rem!important;
    line-height:1.12!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-gold{
    display:grid!important;
    place-items:center!important;
    align-content:center!important;
    gap:3px!important;
    min-width:76px!important;
    min-height:54px!important;
    padding:6px 5px!important;
    border:1px solid rgba(56,189,248,.34)!important;
    border-radius:11px!important;
    background:rgba(7,30,49,.82)!important;
    box-shadow:inset 0 0 22px rgba(56,189,248,.04)!important;
    text-align:center!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-gold.red{
    border-color:rgba(244,114,182,.34)!important;
    background:rgba(54,14,38,.72)!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-gold.neutral{
    border-color:rgba(148,163,184,.26)!important;
    background:rgba(15,23,42,.72)!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-gold span{
    color:#8ca0b7!important;
    font-size:.39rem!important;
    font-weight:900!important;
    letter-spacing:.06em!important;
    text-transform:uppercase!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-gold strong{
    color:#38bdf8!important;
    font-size:.79rem!important;
    font-weight:950!important;
    line-height:1!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-gold.red strong{
    color:#fb7185!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-gold.neutral strong{
    color:#d6e0ec!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objectives{
    display:grid!important;
    gap:7px!important;
    min-height:70px!important;
    padding:9px 9px 10px!important;
    border-top:1px solid rgba(112,151,196,.09)!important;
    border-bottom:1px solid rgba(112,151,196,.09)!important;
    background:rgba(4,13,27,.66)!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective-title{
    color:#7998c7!important;
    font-size:.45rem!important;
    font-weight:950!important;
    letter-spacing:.06em!important;
    text-align:center!important;
    text-transform:uppercase!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective-grid{
    display:grid!important;
    grid-template-columns:repeat(4,minmax(0,1fr))!important;
    min-width:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective{
    display:grid!important;
    place-items:center!important;
    gap:4px!important;
    min-width:0!important;
    min-height:37px!important;
    padding:0 3px!important;
    border-left:1px solid rgba(112,151,196,.10)!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective:first-child{
    border-left:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective>span{
    overflow:hidden!important;
    width:100%!important;
    color:#8090a6!important;
    font-size:.39rem!important;
    font-weight:900!important;
    letter-spacing:.04em!important;
    text-align:center!important;
    text-overflow:ellipsis!important;
    text-transform:uppercase!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective-values{
    display:flex!important;
    align-items:center!important;
    justify-content:center!important;
    gap:3px!important;
    font-size:.66rem!important;
    font-weight:950!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective-values .blue{
    color:#38bdf8!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective-values .red{
    color:#fb7185!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-objective-values i{
    color:#708198!important;
    font-style:normal!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board[data-mobile-live-design="history-current"] .player-board-toolbar{
    display:none!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board[data-mobile-live-design="history-current"] .mobile-live-board-notice{
    border-top:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board[data-mobile-live-design="history-current"] .completed-final-matchups{
    border-top:0!important
  }
}
`;
document.head.append(style);

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function number(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function compact(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${Math.round(absolute / 1_000)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function objectiveValue(team: LolTeamState, key: ObjectiveKey): number | null {
  if (key === 'dragons') return Array.isArray(team.objectives.dragons) ? team.objectives.dragons.length : null;
  return team.objectives[key] as number | null;
}

function liveModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext !== 'history';
}

function fallbackName(board: HTMLElement, side: Side): string {
  return board.querySelector<HTMLElement>(`.history-v2-team.${side} strong, .mobile-completed-team-names .${side} strong`)?.textContent?.trim()
    || (side === 'blue' ? 'Blue team' : 'Red team');
}

function comparisonMarkup(board: HTMLElement, snapshot: LiveSnapshot<LolStats> | null): string {
  const stats = snapshot?.stats ?? null;
  const blueName = stats?.blue.name ?? fallbackName(board, 'blue');
  const redName = stats?.red.name ?? fallbackName(board, 'red');
  const difference = stats?.blue.gold === null || stats?.red.gold === null || !stats
    ? null
    : stats.blue.gold - stats.red.gold;
  const leadClass = difference === null || difference === 0 ? 'neutral' : difference > 0 ? 'blue' : 'red';
  const leadSide = difference === null || difference === 0 ? 'none' : difference > 0 ? 'blue' : 'red';
  const lead = difference === null ? '—' : difference === 0 ? 'EVEN' : `+${compact(difference)}`;

  return `<header class="mobile-live-parity-team-strip">
    <div class="mobile-live-parity-team blue"><span>BLUE SIDE</span><strong title="${esc(blueName)}">${esc(blueName)}</strong></div>
    <div class="mobile-live-parity-gold ${leadClass}" data-leading-side="${leadSide}" aria-label="${difference === null ? 'Gold lead unavailable' : difference === 0 ? 'Gold is even' : `${difference > 0 ? blueName : redName} leads by ${Math.abs(difference).toLocaleString()} gold`}"><span>GOLD LEAD</span><strong>${lead}</strong></div>
    <div class="mobile-live-parity-team red"><span>RED SIDE</span><strong title="${esc(redName)}">${esc(redName)}</strong></div>
  </header>
  <section class="mobile-live-parity-objectives" aria-label="Objectives, blue versus red">
    <div class="mobile-live-parity-objective-title">OBJECTIVES · BLUE – RED</div>
    <div class="mobile-live-parity-objective-grid">
      ${OBJECTIVES.map(([key, label]) => {
        const blueValue = stats ? objectiveValue(stats.blue, key) : null;
        const redValue = stats ? objectiveValue(stats.red, key) : null;
        return `<div class="mobile-live-parity-objective objective-${key}" aria-label="${label}: blue ${number(blueValue)}, red ${number(redValue)}"><span>${label}</span><div class="mobile-live-parity-objective-values"><strong class="blue">${number(blueValue)}</strong><i>–</i><strong class="red">${number(redValue)}</strong></div></div>`;
      }).join('')}
    </div>
  </section>`;
}

function applyCurrentHistoryDesign(board: HTMLElement, snapshot: LiveSnapshot<LolStats> | null): void {
  if (!liveModeActive()) return;
  const gameId = board.dataset.mobileUnifiedGameId ?? board.dataset.liveHistoryGameId ?? '';
  const usableSnapshot = snapshot?.game.id === gameId ? snapshot : verifiedSnapshots.get(gameId) ?? null;
  const comparison = board.querySelector<HTMLElement>('.completed-team-comparison');
  if (!comparison) return;

  const key = JSON.stringify({
    gameId,
    source: usableSnapshot?.quality.sourceTimestamp ?? usableSnapshot?.quality.observedAt ?? null,
    state: board.dataset.liveBoardState ?? null,
    blue: usableSnapshot?.stats?.blue.name ?? fallbackName(board, 'blue'),
    red: usableSnapshot?.stats?.red.name ?? fallbackName(board, 'red')
  });
  const currentMarkupPresent = Boolean(comparison.querySelector('.mobile-live-parity-team-strip'));
  if (board.dataset.mobileLiveDesignKey === key && currentMarkupPresent) return;

  comparison.className = 'completed-team-comparison completed-history-dashboard-v2 objective-text-only mobile-live-parity-comparison';
  comparison.dataset.historyDashboardV2 = 'true';
  comparison.dataset.mobileLiveParity = 'current-history';
  comparison.innerHTML = comparisonMarkup(board, usableSnapshot);
  board.dataset.mobileLiveDesign = 'history-current';
  board.dataset.mobileLiveDesignKey = key;
  board.querySelector<HTMLElement>('.player-board-toolbar')?.setAttribute('data-mobile-live-toolbar', 'hidden');
}

function applyAllBoards(): void {
  renderQueued = false;
  if (!gameContent || !liveModeActive()) return;
  gameContent.querySelectorAll<HTMLElement>('.mobile-live-history-board[data-mobile-history-copy="true"]').forEach(board => {
    const gameId = board.dataset.mobileUnifiedGameId ?? board.dataset.liveHistoryGameId ?? '';
    applyCurrentHistoryDesign(board, verifiedSnapshots.get(gameId) ?? null);
  });
}

function queueApply(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(applyAllBoards);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (snapshot?.game?.id && snapshot.stats) verifiedSnapshots.set(snapshot.game.id, snapshot);
  queueApply();
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot?.stats) verifiedSnapshots.set(detail.snapshot.game.id, detail.snapshot);
  if (detail?.root) queueMicrotask(() => applyCurrentHistoryDesign(detail.root!, detail.snapshot ?? null));
});

if (gameContent) {
  new MutationObserver(queueApply).observe(gameContent, { childList: true, subtree: true });
}
new MutationObserver(queueApply).observe(body, { attributes: true, attributeFilter: ['data-mobile-view', 'data-mobile-context'] });
window.addEventListener('pageshow', queueApply);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueApply);
else if (typeof media.addListener === 'function') media.addListener(queueApply);

queueApply();
document.documentElement.dataset.mobileLiveHistoryDesign = 'v20';

export {};
