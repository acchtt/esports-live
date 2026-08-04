import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const media = window.matchMedia('(max-width: 760px)');

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active #completed-match-detail .completed-final-game,
  body.mobile-demo-active #completed-match-detail .mobile-final-recovery{
    gap:0!important;
    padding:0!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important;
    box-shadow:none!important
  }

  body.mobile-demo-active #completed-match-detail .completed-final-game-header{
    min-height:34px!important;
    padding:4px 4px 9px!important;
    border:0!important;
    background:transparent!important
  }
  body.mobile-demo-active #completed-match-detail .completed-final-game-header strong{
    font-size:.76rem!important;
    line-height:1.2!important
  }
  body.mobile-demo-active #completed-match-detail .completed-final-game-header span{
    font-size:.55rem!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-completed-team-names{
    grid-template-columns:minmax(0,1fr) 42px minmax(0,1fr)!important;
    gap:7px!important;
    padding:12px 8px!important;
    border:0!important;
    border-radius:0!important;
    background:linear-gradient(90deg,rgba(14,165,233,.10),rgba(2,6,23,.18) 46%,rgba(2,6,23,.18) 54%,rgba(244,63,94,.10))!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name{
    display:grid;
    grid-template-columns:minmax(0,1fr) auto;
    grid-template-areas:"side gold" "name gold";
    align-items:center;
    gap:2px 6px
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name:last-child{
    grid-template-columns:auto minmax(0,1fr);
    grid-template-areas:"gold side" "gold name";
    text-align:right
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name small{
    grid-area:side;
    margin:0!important;
    font-size:.45rem!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-name strong{
    grid-area:name;
    font-size:.70rem!important;
    line-height:1.15!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-gold{
    grid-area:gold;
    align-self:stretch;
    display:grid;
    place-items:center;
    min-width:44px;
    padding:0 4px;
    font-size:.62rem;
    font-weight:950;
    font-variant-numeric:tabular-nums
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-gold.blue{color:#38bdf8}
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-gold.red{color:#fb7185}
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-gold.even,
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-gold.unknown{color:#a5b4c8}
  body.mobile-demo-active #completed-match-detail .mobile-completed-team-vs{
    display:grid;
    place-items:center;
    color:#718096!important;
    font-size:.42rem!important;
    letter-spacing:.08em
  }

  body.mobile-demo-active #completed-match-detail .mobile-final-recovery-summary{
    display:none!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-completed-objectives{
    gap:7px!important;
    margin:0!important;
    padding:11px 4px!important;
    border:0!important;
    border-radius:0!important;
    background:rgba(2,6,23,.30)!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-objectives-title{
    font-size:.48rem!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-objective>span{
    font-size:.43rem!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-objective strong{
    font-size:.62rem!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-matchups,
  body.mobile-demo-active #completed-match-detail .completed-final-matchups{
    overflow:hidden!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-row,
  body.mobile-demo-active #completed-match-detail .role-matchup-row{
    min-height:66px!important;
    border:0!important;
    border-bottom:1px solid rgba(148,163,184,.10)!important;
    background:transparent!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-row:last-child,
  body.mobile-demo-active #completed-match-detail .role-matchup-row:last-child{
    border-bottom:0!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-player,
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red,
  body.mobile-demo-active #completed-match-detail .role-player,
  body.mobile-demo-active #completed-match-detail .role-player.red{
    padding:10px 8px!important;
    border:0!important;
    background:transparent!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-portrait,
  body.mobile-demo-active #completed-match-detail .role-player-portrait,
  body.mobile-demo-active #completed-match-detail .history-champion{
    width:38px!important;
    height:38px!important;
    flex-basis:38px!important;
    border-radius:9px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player,
  body.mobile-demo-active #completed-match-detail .role-player{
    grid-template-columns:38px minmax(0,1fr)!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-player.red,
  body.mobile-demo-active #completed-match-detail .role-player.red{
    grid-template-columns:minmax(0,1fr) 38px!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-identity strong,
  body.mobile-demo-active #completed-match-detail .role-player-name strong{
    font-size:.68rem!important;
    line-height:1.12!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-recovery-stats,
  body.mobile-demo-active #completed-match-detail .role-player-stats strong{
    color:#d6dfec!important;
    font-size:.58rem!important;
    line-height:1.1!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta,
  body.mobile-demo-active #completed-match-detail .role-gold-delta{
    min-width:0!important;
    margin:0!important;
    padding:0 2px!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important;
    font-size:.58rem!important
  }
}`;
document.head.append(style);

function compactGold(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${(absolute / 1_000).toFixed(0)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function teamGold(value: number | null, side: 'blue' | 'red'): { className: string; text: string; label: string } {
  if (value === null) return { className: 'unknown', text: '—', label: 'Gold difference unavailable' };
  if (value === 0) return { className: 'even', text: 'EVEN', label: 'Gold is even' };
  const sideLeads = side === 'blue' ? value > 0 : value < 0;
  const text = `${sideLeads ? '+' : '−'}${compactGold(value)}`;
  return {
    className: sideLeads ? side : 'deficit',
    text,
    label: sideLeads ? `Leads by ${compactGold(value)} gold` : `Trails by ${compactGold(value)} gold`
  };
}

function mergeTeamHeaderAndLead(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!root.closest('#completed-match-detail')) return;
  if (!snapshot.stats) return;
  root.querySelector('.mobile-final-recovery-summary')?.remove();

  const blueGold = snapshot.stats.blue.gold;
  const redGold = snapshot.stats.red.gold;
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const blue = teamGold(difference, 'blue');
  const red = teamGold(difference, 'red');

  const strip = root.querySelector<HTMLElement>('.mobile-completed-team-names');
  if (!strip) return;
  strip.setAttribute('aria-label', 'Teams and overall gold comparison');
  strip.innerHTML = `
    <div class="mobile-completed-team-name blue">
      <small>Blue side</small>
      <strong>${snapshot.stats.blue.name}</strong>
      <span class="mobile-completed-team-gold ${blue.className}" aria-label="${blue.label}">${blue.text}</span>
    </div>
    <span class="mobile-completed-team-vs">GOLD</span>
    <div class="mobile-completed-team-name red">
      <small>Red side</small>
      <strong>${snapshot.stats.red.name}</strong>
      <span class="mobile-completed-team-gold ${red.className}" aria-label="${red.label}">${red.text}</span>
    </div>`;
}

window.addEventListener('esports-live:ended-snapshot', event => {
  if (!media.matches) return;
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) mergeTeamHeaderAndLead(detail.snapshot, detail.root);
});

export {};
