import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const ROLE_ORDER = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
type Role = typeof ROLE_ORDER[number];

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-context="history"] .mobile-context-title{
    font-size:0!important
  }
  body.mobile-demo-active[data-mobile-context="history"] .mobile-context-title::after{
    content:"Match History";
    font-size:.72rem;
    font-weight:850
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-portrait,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-identity small,
  body.mobile-demo-active #completed-match-detail .role-player-name small,
  body.mobile-demo-active #completed-match-detail .role-player-portrait,
  body.mobile-demo-active #completed-match-detail .history-champion,
  body.mobile-demo-active #completed-match-detail .history-copy span,
  body.mobile-demo-active #completed-match-detail .role-chip,
  body.mobile-demo-active #completed-match-detail .role-gold-delta small,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-role,
  body.mobile-demo-active #completed-match-detail .role-player-stats>span:nth-child(3),
  body.mobile-demo-active #completed-match-detail .history-stats>.history-stat:nth-child(3),
  body.mobile-demo-active #completed-match-detail .mobile-recovery-stats>b:nth-child(3),
  body.mobile-demo-active #completed-match-detail .role-match-team-metrics>span:nth-child(2){
    display:none!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-final-recovery-summary{
    grid-template-columns:repeat(2,minmax(0,1fr))!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-final-recovery-summary>div:first-child{
    display:none!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-player,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red{
    grid-template-areas:"identity"!important;
    grid-template-columns:minmax(0,1fr)!important;
    grid-template-rows:auto!important;
    gap:3px!important;
    padding:7px 6px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-identity{
    display:grid;
    gap:4px
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-stats{
    display:grid!important;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:4px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red .mobile-recovery-stats{
    justify-content:stretch!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red .mobile-recovery-stats b{
    text-align:right
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-row{
    grid-template-columns:minmax(0,1fr) 44px minmax(0,1fr)!important;
    min-height:48px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta,
  body.mobile-demo-active #completed-match-detail .role-gold-delta{
    display:grid!important;
    place-items:center;
    min-width:0;
    padding:3px 1px;
    font-size:.48rem;
    font-weight:900;
    font-variant-numeric:tabular-nums;
    text-align:center
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.blue,
  body.mobile-demo-active #completed-match-detail .role-gold-delta.blue strong{color:#38bdf8}
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.red,
  body.mobile-demo-active #completed-match-detail .role-gold-delta.red strong{color:#fb7185}
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.even,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta.unknown{color:#8fa0b5}

  body.mobile-demo-active #completed-match-detail .role-player-stats{
    grid-template-columns:repeat(2,minmax(0,1fr))!important
  }
}`;
document.head.append(style);

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

function removeTotalsAndChampionDetails(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(
    '.mobile-recovery-portrait,.mobile-recovery-identity small,.role-player-name small,.role-player-portrait,.history-champion,.history-copy span'
  ).forEach(element => element.remove());

  root.querySelectorAll<HTMLElement>('.mobile-recovery-stats b:nth-child(3)').forEach(element => element.remove());

  root.querySelectorAll<HTMLElement>('.role-player-stats>span,.history-stats>.history-stat,.role-match-team-metrics>span').forEach(element => {
    const label = element.querySelector('small,span')?.textContent?.trim().toLowerCase() ?? '';
    if (label === 'gold' || label === 'total gold') element.remove();
  });

  root.querySelectorAll<HTMLElement>('.mobile-final-recovery-summary>div').forEach(element => {
    const label = element.querySelector('span')?.textContent?.trim().toLowerCase() ?? '';
    if (label === 'gold') element.remove();
  });
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
  removeTotalsAndChampionDetails(root);
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
  if (target?.closest('[data-mode="active"],[data-series-id]')) {
    queueMicrotask(setLiveNavigation);
  }
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
