import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

type Side = 'blue' | 'red';

interface GoldLeadState {
  side: Side | null;
  className: 'blue' | 'red' | 'even' | 'unknown';
  value: string;
  label: string;
}

const media = window.matchMedia('(max-width: 760px)');
const nav = document.querySelector<HTMLElement>('.mobile-app-nav');

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  html{
    scroll-padding-bottom:calc(var(--mobile-demo-nav-height,68px) + 16px)!important
  }
  body.mobile-demo-active{
    padding-bottom:calc(var(--mobile-demo-nav-height,68px) + 16px)!important
  }

  body.mobile-demo-active .mobile-app-nav{
    right:0!important;
    bottom:0!important;
    left:0!important;
    gap:6px!important;
    min-height:60px!important;
    padding:6px 10px calc(6px + env(safe-area-inset-bottom))!important;
    border:0!important;
    border-top:1px solid rgba(112,151,196,.22)!important;
    border-radius:0!important;
    background:rgba(5,12,24,.97)!important;
    box-shadow:0 -12px 34px rgba(0,0,0,.42)!important;
    backdrop-filter:blur(20px)!important
  }
  body.mobile-demo-active .mobile-app-nav button{
    min-height:48px!important;
    border-radius:12px!important
  }
  body.mobile-demo-active .mobile-app-nav button.active{
    background:linear-gradient(180deg,rgba(56,189,248,.15),rgba(56,189,248,.06))!important;
    box-shadow:inset 0 0 0 1px rgba(56,189,248,.24)!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-completed-team-names{
    grid-template-columns:minmax(0,1fr) 86px minmax(0,1fr)!important;
    gap:8px!important;
    min-height:88px!important;
    padding:13px 10px!important;
    background:
      linear-gradient(90deg,rgba(14,165,233,.14),transparent 43%,transparent 57%,rgba(244,63,94,.14)),
      rgba(2,6,23,.54)!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name,
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name:last-child{
    display:flex!important;
    flex-direction:column!important;
    justify-content:center!important;
    align-items:flex-start!important;
    gap:4px!important;
    min-width:0!important;
    text-align:left!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name.red,
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name.red:last-child{
    align-items:flex-end!important;
    text-align:right!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name small{
    margin:0!important;
    color:#8191a8!important;
    font-size:.48rem!important;
    line-height:1!important;
    letter-spacing:.10em!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name strong{
    display:-webkit-box!important;
    overflow:hidden!important;
    color:#dce9f7!important;
    font-size:.78rem!important;
    line-height:1.18!important;
    overflow-wrap:anywhere!important;
    white-space:normal!important;
    -webkit-box-orient:vertical!important;
    -webkit-line-clamp:2!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name.blue.leading strong{
    color:#8bd4ff!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name.red.leading strong{
    color:#ff9cad!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-completed-gold-lead{
    display:grid!important;
    place-items:center!important;
    align-content:center!important;
    gap:4px!important;
    min-width:0!important;
    min-height:56px!important;
    padding:7px 4px!important;
    border:1px solid rgba(148,163,184,.15)!important;
    border-radius:11px!important;
    background:rgba(7,16,30,.82)!important;
    text-align:center!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-gold-lead small{
    color:#8797ad!important;
    font-size:.42rem!important;
    font-weight:900!important;
    line-height:1!important;
    letter-spacing:.09em!important;
    text-transform:uppercase!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-gold-lead strong{
    font-size:.88rem!important;
    font-weight:950!important;
    font-variant-numeric:tabular-nums!important;
    line-height:1!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-gold-lead.blue{
    border-color:rgba(56,189,248,.28)!important;
    background:rgba(14,116,144,.14)!important;
    color:#55c4ff!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-gold-lead.red{
    border-color:rgba(251,113,133,.28)!important;
    background:rgba(159,18,57,.13)!important;
    color:#ff7f95!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-gold-lead.even,
  body.mobile-demo-active #completed-match-detail .mobile-completed-gold-lead.unknown{
    color:#c2cedc!important
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

function goldLeadState(
  blueGold: number | null,
  redGold: number | null,
  blueName: string,
  redName: string
): GoldLeadState {
  if (blueGold === null || redGold === null) {
    return { side: null, className: 'unknown', value: '—', label: 'Gold lead unavailable' };
  }

  const difference = blueGold - redGold;
  if (difference === 0) {
    return { side: null, className: 'even', value: 'EVEN', label: 'Gold is even' };
  }

  const side: Side = difference > 0 ? 'blue' : 'red';
  const amount = compactGold(difference);
  const leader = side === 'blue' ? blueName : redName;
  return {
    side,
    className: side,
    value: `+${amount}`,
    label: `${leader} leads by ${amount} gold`
  };
}

function renderTeamGoldLead(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!media.matches || !snapshot.stats) return;

  const strip = root.querySelector<HTMLElement>('.mobile-completed-team-names');
  if (!strip) return;

  const blueName = snapshot.stats.blue.name;
  const redName = snapshot.stats.red.name;
  const lead = goldLeadState(snapshot.stats.blue.gold, snapshot.stats.red.gold, blueName, redName);

  strip.removeAttribute('data-trailing-side');
  strip.dataset.leadingSide = lead.side ?? lead.className;
  strip.setAttribute('aria-label', `Teams and overall gold comparison. ${lead.label}.`);
  strip.innerHTML = `
    <div class="mobile-completed-team-name blue${lead.side === 'blue' ? ' leading' : ''}">
      <small>Blue side</small>
      <strong title="${escapeHtml(blueName)}">${escapeHtml(blueName)}</strong>
    </div>
    <span class="mobile-completed-gold-lead ${lead.className}" aria-label="${escapeHtml(lead.label)}">
      <small>Gold lead</small>
      <strong>${lead.value}</strong>
    </span>
    <div class="mobile-completed-team-name red${lead.side === 'red' ? ' leading' : ''}">
      <small>Red side</small>
      <strong title="${escapeHtml(redName)}">${escapeHtml(redName)}</strong>
    </div>`;
}

function syncNavigationSpace(): void {
  if (!nav || !media.matches) {
    document.documentElement.style.removeProperty('--mobile-demo-nav-height');
    return;
  }
  const height = Math.ceil(nav.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--mobile-demo-nav-height', `${height}px`);
}

function observeNavigationSpace(): void {
  if (!nav) return;
  nav.dataset.mobileNavVersion = '0.11';

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncNavigationSpace).observe(nav);
  }
}

function observeMobileBreakpoint(): void {
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', syncNavigationSpace);
    return;
  }

  if (typeof media.addListener === 'function') {
    media.addListener(syncNavigationSpace);
  }
}

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) renderTeamGoldLead(detail.snapshot, detail.root);
});

observeNavigationSpace();
observeMobileBreakpoint();
window.addEventListener('resize', syncNavigationSpace);
window.addEventListener('pageshow', syncNavigationSpace);
syncNavigationSpace();

export {};
