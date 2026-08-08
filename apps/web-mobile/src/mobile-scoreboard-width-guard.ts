const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  html,
  body.mobile-demo-active{
    max-width:100%!important;
    overflow-x:clip!important
  }

  body.mobile-demo-active[data-mobile-view="live"] .workspace .analysis-panel{
    padding:0!important
  }

  body.mobile-demo-active #game-content,
  body.mobile-demo-active #completed-match-detail{
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow-x:hidden!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active #game-content>[data-mobile-scoreboard-renderer="shared-v1"],
  body.mobile-demo-active #completed-match-detail [data-mobile-scoreboard-renderer="shared-v1"]{
    display:grid!important;
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    margin-right:0!important;
    margin-left:0!important;
    overflow:hidden!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active #game-content>[data-mobile-scoreboard-renderer="shared-v1"]>*,
  body.mobile-demo-active #completed-match-detail [data-mobile-scoreboard-renderer="shared-v1"]>*{
    max-width:100%!important;
    min-width:0!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .completed-final-game-header{
    display:grid!important;
    grid-template-columns:minmax(66px,auto) minmax(0,1fr)!important;
    align-items:center!important;
    gap:10px!important;
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-game-label{
    display:block!important;
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-unified-scoreboard-comparison,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-live-parity-team-strip,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-live-parity-objectives,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-unified-scoreboard-matchups,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .completed-final-matchups{
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-live-parity-team-strip{
    grid-template-columns:minmax(0,1fr) minmax(76px,82px) minmax(0,1fr)!important;
    gap:5px!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-gold{
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team-name{
    display:-webkit-box!important;
    overflow:hidden!important;
    max-width:100%!important;
    min-width:0!important;
    line-height:1.12!important;
    overflow-wrap:anywhere!important;
    text-overflow:ellipsis!important;
    white-space:normal!important;
    -webkit-box-orient:vertical!important;
    -webkit-line-clamp:2!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team-kills{
    max-width:100%!important;
    overflow:hidden!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-grid{
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective{
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-matchup-row{
    grid-template-columns:minmax(0,1fr) minmax(58px,72px) minmax(0,1fr)!important;
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player.red,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-heading,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-name,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-stats,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-gold-delta{
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    box-sizing:border-box!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-name strong{
    display:block!important;
    overflow:hidden!important;
    max-width:100%!important;
    min-width:0!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-stats{
    grid-template-columns:repeat(3,minmax(0,1fr))!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-stats span,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-stats strong{
    max-width:100%!important;
    min-width:0!important;
    overflow:hidden!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
}
`;
document.head.append(style);
document.documentElement.dataset.mobileScoreboardWidthGuard = 'shared-v28';

export {};
