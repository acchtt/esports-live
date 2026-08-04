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
const snapshots = new Map<string, LiveSnapshot<LolStats>>();
let applyQueued = false;

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
  return board.querySelector<HTMLElement>(`.mobile-live-parity-team.${side} strong, .history-v2-team.${side} strong, .mobile-completed-team-names .${side} strong`)?.textContent?.trim()
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
  const leadLabel = difference === null
    ? 'Gold lead unavailable'
    : difference === 0
      ? 'Gold is even'
      : `${difference > 0 ? blueName : redName} leads by ${Math.abs(difference).toLocaleString()} gold`;

  return `<header class="mobile-live-parity-team-strip">
    <div class="mobile-live-parity-team blue"><span>BLUE SIDE</span><strong title="${esc(blueName)}">${esc(blueName)}</strong></div>
    <div class="mobile-live-parity-gold ${leadClass}" data-leading-side="${leadSide}" aria-label="${esc(leadLabel)}"><span>GOLD LEAD</span><strong>${lead}</strong></div>
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

function applyBoard(board: HTMLElement): void {
  if (!liveModeActive() || board.dataset.mobileHistoryCopy !== 'true') return;
  const gameId = board.dataset.mobileUnifiedGameId ?? board.dataset.liveHistoryGameId ?? '';
  const snapshot = snapshots.get(gameId) ?? null;
  const comparison = board.querySelector<HTMLElement>('.completed-team-comparison');
  if (!comparison) return;

  comparison.className = 'completed-team-comparison completed-history-dashboard-v2 objective-text-only mobile-live-parity-comparison';
  comparison.dataset.historyDashboardV2 = 'true';
  comparison.dataset.mobileLiveParity = 'current-history';
  comparison.innerHTML = comparisonMarkup(board, snapshot);
  board.dataset.mobileLiveDesign = 'history-current';
  board.dataset.mobileLiveDesignKey = `${gameId}|${snapshot?.quality.sourceTimestamp ?? snapshot?.quality.observedAt ?? board.dataset.liveBoardState ?? 'pending'}`;
  board.querySelector<HTMLElement>('.player-board-toolbar')?.setAttribute('data-mobile-live-toolbar', 'hidden');
}

function applyCurrentBoard(): void {
  applyQueued = false;
  if (!gameContent || !liveModeActive()) return;
  const board = gameContent.querySelector<HTMLElement>('.mobile-live-history-board[data-mobile-history-copy="true"]');
  if (board) applyBoard(board);
}

function queueApply(): void {
  if (applyQueued) return;
  applyQueued = true;
  queueMicrotask(applyCurrentBoard);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (snapshot?.game?.id && snapshot.stats) snapshots.set(snapshot.game.id, snapshot);
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot?.game?.id && detail.snapshot.stats) snapshots.set(detail.snapshot.game.id, detail.snapshot);
  if (detail?.root) queueMicrotask(() => applyBoard(detail.root!));
});

if (gameContent) {
  new MutationObserver(records => {
    const insertedBoard = records.some(record => [...record.addedNodes].some(node => (
      node instanceof HTMLElement
      && (node.matches('.mobile-live-history-board') || Boolean(node.querySelector('.mobile-live-history-board')))
    )));
    if (insertedBoard) queueApply();
  }).observe(gameContent, { childList: true });
}

new MutationObserver(queueApply).observe(body, {
  attributes: true,
  attributeFilter: ['data-mobile-view', 'data-mobile-context']
});
window.addEventListener('pageshow', queueApply);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueApply);
else if (typeof media.addListener === 'function') media.addListener(queueApply);

queueApply();
document.documentElement.dataset.mobileLiveBoardOwnerV20 = 'direct-child';

export {};
