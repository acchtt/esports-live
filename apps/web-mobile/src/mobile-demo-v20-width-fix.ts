const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"]) #game-content>.mobile-live-history-board[data-mobile-live-design="history-current"]{
    width:calc(100% - 4px)!important;
    margin-left:2px!important;
    margin-right:2px!important
  }
}`;
document.head.append(style);
document.documentElement.dataset.mobileLiveHistoryWidth = 'full-card';

export {};
