import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const ROLE_ORDER = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
type Role = typeof ROLE_ORDER[number];

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-context="history"] .mobile-context-title{font-size:0!important}
  body.mobile-demo-active[data-mobile-context="history"] .mobile-context-title::after{
    content:"Match History";
    font-size:.72rem;
    font-weight:850
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-identity small,
  body.mobile-demo-active #completed-match-detail .role-player-name small,
  body.mobile-demo-active #completed-match-detail .history-copy span,
  body.mobile-demo-active #completed-match-detail .role-chip,
  body.mobile-demo-active #completed-match-detail .role-gold-delta small,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-role,
  body.mobile-demo-active #completed-match-detail .role-match-team-metrics>span:nth-child(2){display:none!important}

  body.mobile-demo-active #completed-match-detail .mobile-recovery-portrait,
  body.mobile-demo-active #completed-match-detail .role-player-portrait,
  body.mobile-demo-active #completed-match-detail .history-champion{
    display:block!important;
    width:34px!important;
    height:34px!important;
    flex:0 0 34px!important;
    border-radius:8px!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-final-recovery-summary{
    grid-template-columns:repeat(2,minmax(0,1fr))!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-final-recovery-summary>div:first-child{display:none!important}

  body.mobile-demo-active #completed-match-detail .mobile-completed-team-names{
    display:grid;
    grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
    align-items:center;
    gap:8px;
    padding:10px 11px;
    border:1px solid rgba(148,163,184,.16);
    border-radius:12px;
    background:rgba(2,6,23,.58)
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name{min-width:0}
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name:last-child{text-align:right}
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name small{
    display:block;
    margin-bottom:3px;
    color:#7f91aa;
    font-size:.44rem;
    font-weight:900;
    letter-spacing:.08em;
    text-transform:uppercase
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name strong{
    display:block;
    overflow:hidden;
    color:#f1f5f9;
    font-size:.68rem;
    line-height:1.15;
    text-overflow:ellipsis;
    white-space:nowrap
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name.blue strong{color:#bae6fd}
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name.red strong{color:#fecdd3}
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-vs{
    color:#526177;
    font-size:.48rem;
    font-weight:900
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-player,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red{
    grid-template-areas:"portrait identity"!important;
    grid-template-columns:34px minmax(0,1fr)!important;
    grid-template-rows:auto!important;
    align-items:center!important;
    gap:7px!important;
    padding:9px 8px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red{
    grid-template-areas:"identity portrait"!important;
    grid-template-columns:minmax(0,1fr) 34px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-identity{display:grid;gap:5px}
  body.mobile-demo-active #completed-match-detail .mobile-recovery-identity strong{
    color:#f1f5f9;
    font-size:.64rem!important;
    line-height:1.1!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-stats{
    display:block!important;
    color:#cbd5e1!important;
    font-size:.54rem!important;
    line-height:1!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red .mobile-recovery-stats{text-align:right}

  body.mobile-demo-active #completed-match-detail .mobile-recovery-row{
    grid-template-columns:minmax(0,1fr) 52px minmax(0,1fr)!important;
    min-height:62px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta,
  body.mobile-demo-active #completed-match-detail .role-gold-delta{
    display:grid!important;
    place-items:center;
    min-width:0;
    min-height:30px;
    margin:auto 4px;
    padding:5px 2px;
    border:1px solid rgba(148,163,184,.12);
    border-radius:8px;
    background:rgba(15,23,42,.62);
    font-size:.54rem;
    font-weight:950;
    font-variant-numeric:tabular-nums;
    text-align:center
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.blue,
  body.mobile-demo-active #completed-match-detail .role-gold-delta.blue strong{color:#38bdf8}
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.red,
  body.mobile-demo-active #completed-match-detail .role-gold-delta.red strong{color:#fb7185}
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.even,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.unknown{color:#a5b4c8}

  body.mobile-demo-active #completed-match-detail .role-matchup-row{min-height:62px!important}
  body.mobile-demo-active #completed-match-detail .role-player,
  body.mobile-demo-active #completed-match-detail .role-player.red{
    grid-template-areas:"portrait heading" "portrait stats"!important;
    grid-template-columns:34px minmax(0,1fr)!important;
    grid-template-rows:auto auto!important;
    align-items:center!important;
    gap:3px 7px!important;
    padding:8px!important
  }
  body.mobile-demo-active #completed-match-detail .role-player.red{
    grid-template-areas:"heading portrait" "stats portrait"!important;
    grid-template-columns:minmax(0,1fr) 34px!important
  }
  body.mobile-demo-active #completed-match-detail .role-player-heading{grid-area:heading!important}
  body.mobile-demo-active #completed-match-detail .role-player-stats{
    grid-area:stats!important;
    display:block!important
  }
  body.mobile-demo-active #completed-match-detail .role-player-stats strong{font-size:.54rem!important}
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

function contextTitle(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.mobile-context-title');
}

function matchNavButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.mobile-app-nav [data-mobile-view="live"]');
}

function matchNavLabel(): HTMLElement | null {
  return matchNavButton()?.querySelector<HTMLElement>('span') ?? null;
}

function selectedLiveTitle(): string {
  return document.querySelector<HTMLElement>('#selected-series')?.textContent?.trim() || 'Selected match';
}

function completedDetailVisible(): boolean {
  const detail = document.querySelector<HTMLElement>('#completed-match-detail');
  return Boolean(detail && !detail.hidden && getComputedStyle(detail).display !== 'none');
}

function setHistoryNavigation(): void {
  body.dataset.mobileContext = 'history';
  const title = contextTitle();
  const button = matchNavButton();
  const label = matchNavLabel();
  if (title && title.textContent !== 'Match History') title.textContent = 'Match History';
  if (label && label.textContent !== 'History') label.textContent = 'History';
  if (button?.getAttribute('aria-label') !== 'Show match history') {
    button?.setAttribute('aria-label', 'Show match history');
  }
}

function setLiveNavigation(): void {
  delete body.dataset.mobileContext;
  const title = contextTitle();
  const button = matchNavButton();
  const label = matchNavLabel();
  const liveTitle = selectedLiveTitle();
  if (title && title.textContent !== liveTitle) title.textContent = liveTitle;
  if (label && label.textContent !== 'Match') label.textContent = 'Match';
  if (button?.getAttribute('aria-label') !== 'Show selected match') {
    button?.setAttribute('aria-label', 'Show selected match');
  }
}

function roleOf(value: string | null): Role | null {
  const role = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
  if (role.includes('top')) return 'top';
  if (role.includes('jung')) return 'jungle';
  if (role.includes('mid')) return 'mid';
  if (role.includes('bot') || role.includes('adc') || role.includes('carry')) return 'bottom';
  if (role.includes('sup') || role.includes('utility')) return 'support';
  return null;
}

function orderedPlayers(team: LolTeamState): readonly (LolPlayerState | null)[] {
  const assigned = new Map<Role, LolPlayerState>();
  const extras: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = roleOf(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else extras.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? extras.shift() ?? null);
}

function deltaValue(blue: LolPlayerState | null, red: LolPlayerState | null): {
  side: 'blue' | 'red' | 'even' | 'unknown';
  text: string;
  label: string;
} {
  const blueGold = blue?.totalGold ?? null;
  const redGold = red?.totalGold ?? null;
  if (blueGold === null || redGold === null) {
    return { side: 'unknown', text: '—', label: 'Gold comparison unavailable' };
  }
  const difference = blueGold - redGold;
  if (difference === 0) return { side: 'even', text: 'EVEN', label: 'Gold is even' };
  const side = difference > 0 ? 'blue' : 'red';
  const magnitude = Math.abs(difference).toLocaleString();
  return {
    side,
    text: `+${magnitude}`,
    label: `${side === 'blue' ? 'Blue' : 'Red'} leads by ${magnitude} gold`
  };
}

function simplifyCompletedStats(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.mobile-recovery-stats').forEach(stats => {
    Array.from(stats.children).slice(1).forEach(element => element.remove());
  });

  root.querySelectorAll<HTMLElement>('.role-player-stats>span,.history-stats>.history-stat,.role-match-team-metrics>span').forEach(element => {
    const label = element.querySelector('small,span')?.textContent?.trim().toLowerCase() ?? '';
    if (label === 'cs' || label === 'gold' || label === 'total gold') element.remove();
  });

  root.querySelectorAll<HTMLElement>('.mobile-final-recovery-summary>div').forEach(element => {
    const label = element.querySelector('span')?.textContent?.trim().toLowerCase() ?? '';
    if (label === 'gold') element.remove();
  });
}

function installTeamNames(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!snapshot.stats) return;
  root.querySelector('.mobile-completed-team-names')?.remove();
  const strip = document.createElement('section');
  strip.className = 'mobile-completed-team-names';
  strip.setAttribute('aria-label', 'Teams');
  strip.innerHTML = `
    <div class="mobile-completed-team-name blue"><small>Blue side</small><strong>${escapeHtml(snapshot.stats.blue.name)}</strong></div>
    <span class="mobile-completed-team-vs">VS</span>
    <div class="mobile-completed-team-name red"><small>Red side</small><strong>${escapeHtml(snapshot.stats.red.name)}</strong></div>`;
  const header = root.querySelector('.completed-final-game-header');
  if (header) header.insertAdjacentElement('afterend', strip);
  else root.prepend(strip);
}

function installRoleGoldComparisons(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!snapshot.stats) return;
  const bluePlayers = orderedPlayers(snapshot.stats.blue);
  const redPlayers = orderedPlayers(snapshot.stats.red);

  root.querySelectorAll<HTMLElement>('.mobile-recovery-row').forEach((row, index) => {
    const role = ROLE_ORDER[index];
    if (!role) return;
    const delta = deltaValue(bluePlayers[index] ?? null, redPlayers[index] ?? null);
    const center = row.querySelector<HTMLElement>('.mobile-recovery-role,.mobile-recovery-gold-delta');
    if (!center) return;
    center.className = `mobile-recovery-gold-delta ${delta.side}`;
    center.textContent = delta.text;
    center.setAttribute('aria-label', `${role} ${delta.label}`);
    center.title = `${role} · ${delta.label}`;
    row.dataset.role = role;
  });

  root.querySelectorAll<HTMLElement>('.role-matchup-row').forEach((row, index) => {
    const role = ROLE_ORDER[index];
    if (!role) return;
    const delta = deltaValue(bluePlayers[index] ?? null, redPlayers[index] ?? null);
    const center = row.querySelector<HTMLElement>('.role-gold-delta');
    if (!center) return;
    center.classList.remove('blue', 'red', 'even', 'unknown');
    center.classList.add(delta.side);
    center.querySelector('small')?.remove();
    let strong = center.querySelector<HTMLElement>('strong');
    if (!strong) {
      strong = document.createElement('strong');
      center.prepend(strong);
    }
    strong.textContent = delta.text;
    center.setAttribute('aria-label', `${role} ${delta.label}`);
    center.title = `${role} · ${delta.label}`;
    row.dataset.role = role;
  });
}

function refineCompletedBoard(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!media.matches || !snapshot.stats) return;
  simplifyCompletedStats(root);
  installTeamNames(snapshot, root);
  installRoleGoldComparisons(snapshot, root);
}

window.addEventListener('esports-live:completed-selection', () => {
  if (media.matches) setHistoryNavigation();
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) refineCompletedBoard(detail.snapshot, detail.root);
});

window.addEventListener('esports-live:selection', () => {
  if (!media.matches) return;
  if (body.dataset.mobileContext === 'history' || completedDetailVisible()) setHistoryNavigation();
  else setLiveNavigation();
});

document.addEventListener('click', event => {
  if (!media.matches) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-mode="results"],[data-completed-series-id]')) {
    queueMicrotask(setHistoryNavigation);
    return;
  }
  if (target?.closest('[data-mode="active"],[data-series-id]')) queueMicrotask(setLiveNavigation);
}, true);

const navigationObserver = new MutationObserver(() => {
  if (!media.matches) return;
  if (body.dataset.mobileContext === 'history') setHistoryNavigation();
});
navigationObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

window.addEventListener('pageshow', () => {
  if (!media.matches) return;
  if (body.dataset.mobileContext === 'history' || completedDetailVisible()) setHistoryNavigation();
  else setLiveNavigation();
});

window.addEventListener('beforeunload', () => navigationObserver.disconnect());

export {};
