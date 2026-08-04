import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active #completed-match-detail .role-player-items,
  body.mobile-demo-active #completed-match-detail .history-items,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-items,
  body.mobile-demo-active #completed-match-detail .completed-final-items{display:none!important}

  body.mobile-demo-active .completed-final-matchups .role-player,
  body.mobile-demo-active .completed-final-matchups .role-player.red{
    grid-template-areas:"heading" "stats"!important;
    grid-template-rows:18px 16px!important;
    min-height:0!important
  }
  body.mobile-demo-active .completed-final-matchups .role-matchup-row{min-height:45px!important}

  body.mobile-demo-active .completed-final-player.history-player-board{
    grid-template-areas:"profile stats"!important;
    grid-template-columns:minmax(0,1fr) minmax(92px,auto)!important;
    min-height:40px!important
  }

  body.mobile-demo-active .mobile-recovery-player,
  body.mobile-demo-active .mobile-recovery-player.red{
    grid-template-areas:"portrait identity"!important;
    grid-template-rows:30px!important;
    min-height:0!important
  }
  body.mobile-demo-active .mobile-recovery-player.red{
    grid-template-areas:"identity portrait"!important
  }
  body.mobile-demo-active .mobile-recovery-row{min-height:48px!important}

  body.mobile-demo-active .mobile-completed-objectives{
    display:grid;
    gap:5px;
    padding:7px;
    border:1px solid rgba(148,163,184,.14);
    border-radius:10px;
    background:rgba(2,6,23,.5)
  }
  body.mobile-demo-active .mobile-completed-objectives-title{
    color:#8290a5;
    font-size:.46rem;
    font-weight:900;
    letter-spacing:.08em;
    text-align:center;
    text-transform:uppercase
  }
  body.mobile-demo-active .mobile-completed-objectives-grid{
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:3px
  }
  body.mobile-demo-active .mobile-completed-objective{
    min-width:0;
    padding:4px 2px;
    border-left:1px solid rgba(148,163,184,.1);
    text-align:center
  }
  body.mobile-demo-active .mobile-completed-objective:first-child{border-left:0}
  body.mobile-demo-active .mobile-completed-objective>span{
    display:block;
    overflow:hidden;
    color:#8290a5;
    font-size:.4rem;
    font-weight:800;
    text-overflow:ellipsis;
    text-transform:uppercase;
    white-space:nowrap
  }
  body.mobile-demo-active .mobile-completed-objective strong{
    display:grid;
    grid-template-columns:1fr auto 1fr;
    align-items:center;
    gap:2px;
    margin-top:2px;
    font-size:.57rem;
    font-variant-numeric:tabular-nums
  }
  body.mobile-demo-active .mobile-completed-objective b:first-child{color:#7dd3fc;text-align:right}
  body.mobile-demo-active .mobile-completed-objective b:last-child{color:#fda4af;text-align:left}
  body.mobile-demo-active .mobile-completed-objective i{color:#526177;font-style:normal}
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

function setHistoryNavigation(): void {
  body.dataset.mobileContext = 'history';
  const title = contextTitle();
  const button = matchNavButton();
  const label = matchNavLabel();
  if (title) title.textContent = 'Match History';
  if (label) label.textContent = 'History';
  button?.setAttribute('aria-label', 'Show match history');
}

function setLiveNavigation(): void {
  delete body.dataset.mobileContext;
  const title = contextTitle();
  const button = matchNavButton();
  const label = matchNavLabel();
  if (title) title.textContent = selectedLiveTitle();
  if (label) label.textContent = 'Match';
  button?.setAttribute('aria-label', 'Show selected match');
}

function objectiveCount(team: LolTeamState, key: 'towers' | 'dragons' | 'barons' | 'inhibitors'): number | null {
  if (key === 'dragons') return team.objectives.dragons?.length ?? null;
  return team.objectives[key];
}

function metric(label: string, blue: number | null, red: number | null): string {
  const value = (entry: number | null): string => entry === null ? '—' : entry.toLocaleString();
  return `<div class="mobile-completed-objective"><span>${label}</span><strong><b>${value(blue)}</b><i>–</i><b>${value(red)}</b></strong></div>`;
}

function installObjectives(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!media.matches || !snapshot.stats) return;
  root.querySelector('.mobile-completed-objectives')?.remove();
  const { blue, red } = snapshot.stats;
  const strip = document.createElement('section');
  strip.className = 'mobile-completed-objectives';
  strip.setAttribute('aria-label', 'Objective counts');
  strip.innerHTML = `
    <span class="mobile-completed-objectives-title">Objectives · Blue – Red</span>
    <div class="mobile-completed-objectives-grid">
      ${metric('Towers', objectiveCount(blue, 'towers'), objectiveCount(red, 'towers'))}
      ${metric('Dragons', objectiveCount(blue, 'dragons'), objectiveCount(red, 'dragons'))}
      ${metric('Barons', objectiveCount(blue, 'barons'), objectiveCount(red, 'barons'))}
      ${metric('Inhibitors', objectiveCount(blue, 'inhibitors'), objectiveCount(red, 'inhibitors'))}
    </div>`;
  const summary = root.querySelector('.mobile-final-recovery-summary');
  const header = root.querySelector('.completed-final-game-header');
  (summary ?? header)?.insertAdjacentElement('afterend', strip);
}

window.addEventListener('esports-live:completed-selection', () => {
  if (media.matches) setHistoryNavigation();
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) installObjectives(detail.snapshot, detail.root);
});

window.addEventListener('esports-live:selection', () => {
  if (media.matches) setLiveNavigation();
});

document.addEventListener('click', event => {
  if (!media.matches) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('[data-mode="results"]')) queueMicrotask(setHistoryNavigation);
  if (target?.closest('[data-mode="active"], [data-series-id]')) queueMicrotask(setLiveNavigation);
}, true);

window.addEventListener('pageshow', () => {
  if (!media.matches) return;
  const historySelected = Boolean(document.querySelector('.completed-result-card.selected'));
  if (historySelected) setHistoryNavigation();
  else setLiveNavigation();
});

export {};
