const media = window.matchMedia('(max-width: 760px)');
const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
const gameContent = document.querySelector<HTMLElement>('#game-content');

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-view="live"] .analysis-header.series-hero-active{
    gap:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-topline{
    display:none!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-matchup{
    grid-template-columns:minmax(0,1fr) 66px minmax(0,1fr)!important;
    gap:5px!important;
    min-height:92px!important;
    padding:7px 9px 5px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-team{
    gap:5px!important;
    min-height:84px!important;
    padding:6px 4px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-team-logo{
    width:38px!important;
    height:38px!important;
    border-radius:10px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-team-logo img{
    width:31px!important;
    height:31px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-team-copy strong{
    max-width:30vw!important;
    font-size:.64rem!important;
    line-height:1.08!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-score{
    padding:3px 0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-score strong{
    font-size:1.45rem!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-footer{
    grid-template-columns:1fr!important;
    gap:0!important;
    padding:0 9px 7px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-footer>span:not(.series-hero-live-context),
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-footer>time{
    display:none!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .series-hero-live-context{
    grid-column:1!important;
    min-height:30px!important;
    padding:0 9px!important;
    border-radius:8px!important;
    font-size:.55rem!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .analysis-header.series-hero-active #game-selector{
    min-height:42px!important;
    margin:0 9px 7px!important;
    padding:5px!important;
    border-radius:9px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .game-button{
    min-width:52px!important;
    min-height:32px!important;
    padding:3px 7px!important;
    border-radius:8px!important;
    font-size:.54rem!important
  }
  body.mobile-demo-active[data-mobile-view="live"] #quality-banner:not([hidden]),
  body.mobile-demo-active[data-mobile-view="live"] .quality-banner:not([hidden]){
    min-height:30px!important;
    margin:5px 8px!important;
    padding:6px 9px!important;
    overflow:hidden!important;
    border-radius:8px!important;
    font-size:.53rem!important;
    line-height:1.2!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board .player-board-toolbar{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) 38px!important;
    align-items:center!important;
    gap:6px!important;
    min-height:44px!important;
    margin:5px 8px 6px!important;
    padding:5px 6px!important;
    border-radius:8px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board .player-board-toolbar-copy{
    display:flex!important;
    align-items:center!important;
    gap:6px!important;
    min-width:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board .player-board-toolbar-copy strong{
    flex:0 0 auto!important;
    font-size:.56rem!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board .player-board-toolbar-copy small{
    min-width:0!important;
    font-size:.47rem!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board .player-board-refresh-button{
    width:38px!important;
    min-width:38px!important;
    min-height:34px!important;
    padding:0!important;
    border-radius:8px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-history-board .player-board-refresh-button [data-player-board-refresh-label]{
    position:absolute!important;
    width:1px!important;
    height:1px!important;
    margin:-1px!important;
    overflow:hidden!important;
    clip:rect(0,0,0,0)!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .completed-final-game-header{
    min-height:28px!important;
    padding:4px 9px 5px!important;
    font-size:.58rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-matchup-row{
    grid-template-columns:minmax(0,1fr) 60px minmax(0,1fr)!important;
    min-height:76px!important;
    border-bottom:1px solid rgba(148,163,184,.09)!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.red{
    grid-template-columns:34px minmax(0,1fr)!important;
    grid-template-rows:auto auto 14px!important;
    grid-template-areas:
      "portrait heading"
      "portrait stats"
      "items items"!important;
    gap:1px 5px!important;
    min-height:76px!important;
    padding:6px 5px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.red{
    grid-template-columns:minmax(0,1fr) 34px!important;
    grid-template-areas:
      "heading portrait"
      "stats portrait"
      "items items"!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.blue{
    background:linear-gradient(90deg,rgba(14,165,233,.06),transparent)!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.red{
    background:linear-gradient(270deg,rgba(244,63,94,.06),transparent)!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-portrait,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-portrait .telemetry-champion{
    display:grid!important;
    place-items:center!important;
    width:34px!important;
    height:34px!important;
    min-width:34px!important;
    min-height:34px!important;
    overflow:hidden!important;
    border:1px solid rgba(148,163,184,.18)!important;
    border-radius:8px!important;
    background:rgba(15,23,42,.86)!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-portrait img{
    width:100%!important;
    height:100%!important;
    object-fit:cover!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .telemetry-champion-fallback{
    display:grid!important;
    place-items:center!important;
    width:100%!important;
    height:100%!important;
    color:#a9bad0!important;
    font-size:.56rem!important;
    font-weight:900!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .telemetry-champion img:not([hidden])~.telemetry-champion-fallback{
    display:none!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-name strong{
    font-size:.63rem!important;
    line-height:1.08!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-stats strong{
    font-size:.53rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-items .telemetry-inventory{
    gap:2px!important;
    min-height:13px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-items .telemetry-item-slot{
    width:13px!important;
    height:13px!important;
    flex:0 0 13px!important;
    border-radius:3px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-gold-delta{
    min-width:60px!important;
    margin:auto 1px!important
  }

  body.mobile-demo-active[data-mobile-view="live"] #game-content{
    padding-bottom:calc(var(--mobile-live-nav-clearance,76px) + 18px + env(safe-area-inset-bottom))!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-app-nav{
    min-height:56px!important;
    bottom:calc(6px + env(safe-area-inset-bottom))!important;
    padding:4px!important;
    border-radius:16px!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-app-nav button{
    min-height:44px!important;
    border-radius:11px!important
  }
}
`;
document.head.append(style);

function syncNavigationClearance(): void {
  if (!media.matches || !nav) return;
  const height = Math.ceil(nav.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--mobile-live-nav-clearance', `${height + 12}px`);
  nav.dataset.mobileNavClearance = 'measured';
}

function markCompactLayout(): void {
  if (!media.matches || !gameContent) return;
  gameContent.querySelectorAll<HTMLElement>('.mobile-live-history-board[data-mobile-history-copy="true"]').forEach(board => {
    board.dataset.mobileCompactLayout = 'v19';
  });
}

if (nav && typeof ResizeObserver === 'function') new ResizeObserver(syncNavigationClearance).observe(nav);
window.addEventListener('resize', syncNavigationClearance, { passive: true });
window.visualViewport?.addEventListener('resize', syncNavigationClearance, { passive: true });
window.addEventListener('pageshow', () => {
  syncNavigationClearance();
  markCompactLayout();
});
window.addEventListener('esports-live:snapshot', () => queueMicrotask(markCompactLayout));
if (gameContent) new MutationObserver(markCompactLayout).observe(gameContent, { childList: true, subtree: true });
if (typeof media.addEventListener === 'function') media.addEventListener('change', () => {
  syncNavigationClearance();
  markCompactLayout();
});
else if (typeof media.addListener === 'function') media.addListener(() => {
  syncNavigationClearance();
  markCompactLayout();
});

syncNavigationClearance();
markCompactLayout();
document.documentElement.dataset.mobileCompactLiveBoard = 'v19';

export {};
