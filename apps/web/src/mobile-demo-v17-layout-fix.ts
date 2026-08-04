const media = window.matchMedia('(max-width: 760px)');
const gameContent = document.querySelector<HTMLElement>('#game-content');

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active:not([data-mobile-context="history"]) .mobile-live-history-board{
    align-content:start!important
  }

  body.mobile-demo-active:not([data-mobile-context="history"]) .mobile-live-history-board .player-board-toolbar{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) 116px!important;
    align-items:center!important;
    gap:8px!important;
    min-height:58px!important;
    margin:8px 10px 10px!important;
    padding:7px 8px!important;
    border-radius:10px!important
  }
  body.mobile-demo-active:not([data-mobile-context="history"]) .mobile-live-history-board .player-board-toolbar-copy{
    display:grid!important;
    gap:1px!important;
    min-width:0!important
  }
  body.mobile-demo-active:not([data-mobile-context="history"]) .mobile-live-history-board .player-board-toolbar-copy strong{
    font-size:.61rem!important;
    line-height:1.1!important
  }
  body.mobile-demo-active:not([data-mobile-context="history"]) .mobile-live-history-board .player-board-toolbar-copy small{
    overflow:hidden!important;
    font-size:.49rem!important;
    line-height:1.15!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active:not([data-mobile-context="history"]) .mobile-live-history-board .player-board-refresh-button{
    width:100%!important;
    min-height:42px!important;
    padding:0 8px!important;
    font-size:.58rem!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-matchup-row{
    grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr)!important;
    min-height:88px!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-player,
  body.mobile-demo-active .mobile-live-history-board .role-player.red{
    grid-template-columns:38px minmax(0,1fr)!important;
    grid-template-rows:auto auto 17px!important;
    grid-template-areas:
      "portrait heading"
      "portrait stats"
      "items items"!important;
    align-content:center!important;
    align-items:center!important;
    gap:2px 6px!important;
    min-width:0!important;
    min-height:88px!important;
    padding:8px 6px!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player.red{
    grid-template-columns:minmax(0,1fr) 38px!important;
    grid-template-areas:
      "heading portrait"
      "stats portrait"
      "items items"!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-player-heading,
  body.mobile-demo-active .mobile-live-history-board .role-player-name{
    display:block!important;
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-name strong{
    display:block!important;
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    color:#f1f5f9!important;
    font-size:.66rem!important;
    font-weight:850!important;
    line-height:1.12!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important;
    writing-mode:horizontal-tb!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-player-stats{
    display:block!important;
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-stats>span:first-child{
    display:block!important;
    width:100%!important;
    min-width:0!important;
    padding:0!important;
    border:0!important;
    background:transparent!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-stats strong{
    display:block!important;
    overflow:hidden!important;
    font-size:.56rem!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-player-items{
    grid-area:items!important;
    display:block!important;
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-items .telemetry-inventory{
    display:flex!important;
    align-items:center!important;
    justify-content:flex-start!important;
    gap:2px!important;
    width:100%!important;
    min-width:0!important;
    min-height:15px!important;
    padding:0!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player.red .role-player-items .telemetry-inventory{
    justify-content:flex-end!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-items .telemetry-inventory-label{
    display:none!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-items .telemetry-item-slot{
    width:15px!important;
    height:15px!important;
    flex:0 0 15px!important;
    border-color:rgba(148,163,184,.16)!important;
    border-radius:3px!important;
    opacity:.72!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-items .telemetry-item-slot.empty{
    opacity:.42!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-gold-delta{
    min-width:60px!important;
    margin:auto 1px!important
  }
}
`;
document.head.append(style);

function markLayout(): void {
  if (!media.matches || !gameContent) return;
  gameContent.querySelectorAll<HTMLElement>('.mobile-live-history-board').forEach(board => {
    board.dataset.mobileScoreboardLayout = 'identity-items';
  });
}

if (gameContent) {
  new MutationObserver(markLayout).observe(gameContent, { childList: true, subtree: true });
}
window.addEventListener('esports-live:snapshot', () => queueMicrotask(markLayout));
window.addEventListener('pageshow', markLayout);
if (typeof media.addEventListener === 'function') media.addEventListener('change', markLayout);
else if (typeof media.addListener === 'function') media.addListener(markLayout);
markLayout();

export {};
