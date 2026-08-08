import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

type Side = 'blue' | 'red';

const media = window.matchMedia('(max-width: 760px)');

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active #completed-match-detail .mobile-final-recovery{
    width:calc(100% + 18px)!important;
    max-width:none!important;
    margin-right:-9px!important;
    margin-left:-9px!important;
    justify-self:center
  }

  body.mobile-demo-active #completed-match-detail .mobile-completed-team-names{
    grid-template-columns:minmax(0,1fr) 36px minmax(0,1fr)!important;
    gap:5px!important;
    padding:12px 6px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name:not(.trailing){
    grid-template-columns:minmax(0,1fr)!important;
    grid-template-areas:"side" "name"!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name:last-child:not(.trailing){
    grid-template-columns:minmax(0,1fr)!important;
    grid-template-areas:"side" "name"!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-gold.deficit{
    color:#f5cf79!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-completed-objectives-title{
    font-size:.60rem!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-objective>span{
    font-size:.56rem!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-objective strong{
    font-size:.74rem!important
  }
}`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compactGold(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${(absolute / 1_000).toFixed(0)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function deficitMarkup(side: Side, trailingSide: Side | null, difference: number | null, teamName: string): string {
  if (side !== trailingSide || difference === null) return '';
  const amount = compactGold(difference);
  return `<span class="mobile-completed-team-gold deficit" aria-label="${escapeHtml(teamName)} trails by ${amount} gold">−${amount}</span>`;
}

function showTrailingDeficit(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!media.matches || !snapshot.stats || !root.closest('#completed-match-detail')) return;

  const blueGold = snapshot.stats.blue.gold;
  const redGold = snapshot.stats.red.gold;
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const trailingSide: Side | null = difference === null || difference === 0
    ? null
    : difference > 0 ? 'red' : 'blue';

  const strip = root.querySelector<HTMLElement>('.mobile-completed-team-names');
  if (!strip) return;

  const blueName = snapshot.stats.blue.name;
  const redName = snapshot.stats.red.name;
  const stateLabel = difference === null
    ? 'Gold difference unavailable'
    : difference === 0
      ? 'Gold is even'
      : `${trailingSide === 'blue' ? blueName : redName} trails by ${compactGold(difference)} gold`;

  strip.dataset.trailingSide = trailingSide ?? 'none';
  strip.setAttribute('aria-label', `Teams and overall gold comparison. ${stateLabel}.`);
  strip.innerHTML = `
    <div class="mobile-completed-team-name blue${trailingSide === 'blue' ? ' trailing' : ''}">
      <small>Blue side</small>
      <strong>${escapeHtml(blueName)}</strong>
      ${deficitMarkup('blue', trailingSide, difference, blueName)}
    </div>
    <span class="mobile-completed-team-vs">GOLD</span>
    <div class="mobile-completed-team-name red${trailingSide === 'red' ? ' trailing' : ''}">
      <small>Red side</small>
      <strong>${escapeHtml(redName)}</strong>
      ${deficitMarkup('red', trailingSide, difference, redName)}
    </div>`;
}

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) showTrailingDeficit(detail.snapshot, detail.root);
});

export {};
