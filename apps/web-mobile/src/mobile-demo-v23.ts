const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team-kills{
    display:flex!important;
    align-items:baseline!important;
    gap:4px!important;
    min-width:0!important;
    margin:0!important;
    color:#8ca0b7!important;
    font-size:.42rem!important;
    font-weight:900!important;
    line-height:1!important;
    letter-spacing:.04em!important;
    text-transform:uppercase!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team.red .mobile-scoreboard-team-kills{
    justify-content:flex-end!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team-kills b{
    color:#7f91a8!important;
    font:inherit!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team-kills strong{
    display:inline!important;
    overflow:visible!important;
    color:#38bdf8!important;
    font-size:.66rem!important;
    font-weight:950!important;
    line-height:1!important;
    text-overflow:clip!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-team.red .mobile-scoreboard-team-kills strong{
    color:#fb7185!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-matchup-row{
    min-height:64px!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player.red{
    grid-template-columns:34px minmax(0,1fr)!important;
    grid-template-rows:auto auto!important;
    grid-template-areas:
      "portrait heading"
      "portrait stats"!important;
    min-height:64px!important;
    padding-top:7px!important;
    padding-bottom:7px!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player.red{
    grid-template-columns:minmax(0,1fr) 34px!important;
    grid-template-areas:
      "heading portrait"
      "stats portrait"!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .role-player-items,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .telemetry-inventory,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .telemetry-item-slot{
    display:none!important
  }
}
`;
document.head.append(style);
document.documentElement.dataset.mobileScoreboardDetails = 'team-kills-no-items';

export {};
