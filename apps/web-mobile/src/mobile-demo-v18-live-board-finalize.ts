import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

type Side = 'blue' | 'red';
type ObjectiveKey = 'towers' | 'dragons' | 'barons' | 'inhibitors';

const OBJECTIVES: readonly [ObjectiveKey, string][] = [
  ['towers', 'Towers'],
  ['dragons', 'Dragons'],
  ['barons', 'Barons'],
  ['inhibitors', 'Inhibitors']
];

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-gold-delta,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-gold-delta strong{
    font-size:.74rem!important;
    font-weight:950!important;
    line-height:1!important
  }
}`;
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

function compact(value: number | null): string {
  if (value === null) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${Math.round(absolute / 1_000)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function objectiveValue(stats: LolStats, side: Side, key: ObjectiveKey): number | null {
  const value = stats[side].objectives[key];
  return key === 'dragons' ? (Array.isArray(value) ? value.length : null) : value as number | null;
}

function objectiveSide(stats: LolStats, side: Side): string {
  return `<div class="history-v2-objective-side ${side}" aria-label="${side === 'blue' ? 'Blue' : 'Red'} team objectives">
    ${OBJECTIVES.map(([key, label]) => {
      const value = objectiveValue(stats, side, key);
      return `<div class="history-v2-objective-stat objective-${key}" aria-label="${label}: ${number(value)}"><span class="history-v2-objective-label">${label}</span><strong>${number(value)}</strong></div>`;
    }).join('')}
  </div>`;
}

function comparisonMarkup(snapshot: LiveSnapshot<LolStats>): string {
  const stats = snapshot.stats!;
  const difference = stats.blue.gold === null || stats.red.gold === null
    ? null
    : stats.blue.gold - stats.red.gold;
  const leaderClass = difference === null || difference === 0 ? 'neutral' : difference > 0 ? 'blue' : 'red';
  const leader = difference === null
    ? 'Gold unavailable'
    : difference === 0
      ? 'Gold even'
      : `${difference > 0 ? stats.blue.name : stats.red.name} +${compact(Math.abs(difference))}`;
  const centerLabel = snapshot.game.state === 'paused' ? 'PAUSED' : 'LIVE';

  return `
    <header class="history-v2-team-header mobile-completed-team-names">
      <div class="history-v2-team blue"><span>BLUE SIDE</span><strong title="${esc(stats.blue.name)}">${esc(stats.blue.name)}</strong></div>
      <div class="history-v2-final">${centerLabel}</div>
      <div class="history-v2-team red"><span>RED SIDE</span><strong title="${esc(stats.red.name)}">${esc(stats.red.name)}</strong></div>
    </header>
    <div class="history-v2-summary">
      <article class="history-v2-gold-card"><span>GOLD LEAD</span><strong class="${leaderClass}">${esc(leader)}</strong><small>${compact(stats.blue.gold)} vs ${compact(stats.red.gold)}</small></article>
      <article class="history-v2-quick-stats">
        <div><span>KILLS</span><strong class="blue">${number(stats.blue.kills)}</strong><i>–</i><strong class="red">${number(stats.red.kills)}</strong></div>
        <div><span>TOWERS</span><strong class="blue">${number(stats.blue.objectives.towers)}</strong><i>–</i><strong class="red">${number(stats.red.objectives.towers)}</strong></div>
      </article>
    </div>
    <section class="history-v2-objectives mobile-completed-objectives" aria-label="Objective counts">
      <div class="history-v2-objective-title"><i></i><span>OBJECTIVES</span><i></i></div>
      <div class="history-v2-objective-hud">${objectiveSide(stats, 'blue')}<span class="history-v2-objective-center" aria-hidden="true"></span>${objectiveSide(stats, 'red')}</div>
    </section>`;
}

function removeLegacyStrips(root: HTMLElement, comparison: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.mobile-completed-team-names, .mobile-completed-objectives').forEach(element => {
    if (!comparison.contains(element)) element.remove();
  });
}

function finalizeLiveBoard(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!snapshot.stats || root.dataset.mobileHistoryCopy !== 'true') return;

  let comparison = root.querySelector<HTMLElement>('.completed-team-comparison');
  if (!comparison) {
    comparison = document.createElement('section');
    root.querySelector('.completed-final-game-header')?.insertAdjacentElement('afterend', comparison);
  }
  if (!comparison) return;

  comparison.className = 'completed-team-comparison completed-history-dashboard-v2 objective-text-only';
  comparison.dataset.historyDashboardV2 = 'true';
  comparison.innerHTML = comparisonMarkup(snapshot);
  removeLegacyStrips(root, comparison);
  root.dataset.mobileLiveBoardFinalized = 'true';
}

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) finalizeLiveBoard(detail.snapshot, detail.root);
});

document.documentElement.dataset.mobileLiveBoardFinalizer = 'loaded';

export {};
