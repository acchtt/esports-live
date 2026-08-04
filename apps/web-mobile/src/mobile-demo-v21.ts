const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');
let markQueued = false;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-view="live"] #workspace.workspace,
  body.mobile-demo-active[data-mobile-view="live"] #workspace.workspace.platform-collapsed,
  body.mobile-demo-active[data-mobile-view="live"] #workspace.dashboard-v2-active{
    margin-top:0!important;
    padding-top:0!important;
    row-gap:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] #workspace>.analysis-panel{
    align-self:start!important;
    margin-top:0!important;
    padding-top:0!important
  }
  body.mobile-demo-active[data-mobile-view="live"] .mobile-context-bar{
    position:static!important;
    top:auto!important;
    inset-block-start:auto!important;
    margin-top:0!important;
    margin-bottom:0!important
  }

  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  #game-content:has(>.mobile-live-history-board[data-mobile-live-design="history-current"])>.live-dashboard-v2,
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  #game-content:has(>.mobile-live-history-board[data-mobile-live-design="history-current"])>.v2-objectives-card,
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  #game-content:has(>.mobile-live-history-board[data-mobile-live-design="history-current"])>.objective-hud-v3,
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  #game-content:has(>.mobile-live-history-board[data-mobile-live-design="history-current"])>.mobile-live-parity-objectives{
    display:none!important
  }

  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.history-v2-objectives,
  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.v2-objectives-card,
  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.objective-hud-v3,
  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.mobile-live-parity-objectives,
  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"] .completed-team-comparison>.history-v2-objectives,
  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"] .completed-team-comparison>.v2-objectives-card,
  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"] .completed-team-comparison>.objective-hud-v3{
    display:none!important
  }

  body.mobile-demo-active[data-mobile-view="live"]
  .mobile-live-history-board[data-mobile-live-design="history-current"]
  .mobile-live-parity-comparison>.mobile-live-parity-objectives{
    display:grid!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .mobile-live-parity-team strong{
    display:-webkit-box!important;
    max-height:2.3em!important;
    overflow:hidden!important;
    line-height:1.12!important;
    text-overflow:ellipsis!important;
    white-space:normal!important;
    -webkit-box-orient:vertical!important;
    -webkit-line-clamp:2!important
  }
}
`;
document.head.append(style);

function markCurrentBoard(): void {
  markQueued = false;
  if (!media.matches || body.dataset.mobileView !== 'live' || body.dataset.mobileContext === 'history') return;
  const board = gameContent?.querySelector<HTMLElement>('.mobile-live-history-board[data-mobile-live-design="history-current"]');
  if (!board) return;
  board.dataset.mobileLiveCleanup = 'v21';
  document.documentElement.dataset.mobileLiveSurface = 'v21';
}

function queueMark(): void {
  if (markQueued) return;
  markQueued = true;
  queueMicrotask(markCurrentBoard);
}

if (gameContent) new MutationObserver(queueMark).observe(gameContent, { childList: true });
new MutationObserver(queueMark).observe(body, {
  attributes: true,
  attributeFilter: ['data-mobile-view', 'data-mobile-context']
});
window.addEventListener('esports-live:snapshot', queueMark);
window.addEventListener('pageshow', queueMark);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueMark);
else if (typeof media.addListener === 'function') media.addListener(queueMark);

queueMark();

export {};
