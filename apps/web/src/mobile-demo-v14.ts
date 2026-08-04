const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const analysisPanel = document.querySelector<HTMLElement>('.analysis-panel');
const contextBar = document.querySelector<HTMLElement>('.mobile-context-bar');

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-context="history"] .analysis-header{
    display:none!important
  }

  body.mobile-demo-active[data-mobile-context="history"] .analysis-panel{
    padding-top:0!important
  }

  body.mobile-demo-active[data-mobile-context="history"] .mobile-context-bar{
    top:64px!important;
    z-index:45!important;
    min-height:46px!important;
    margin:0!important;
    padding:6px 10px!important;
    border-top:0!important;
    background:rgba(7,16,30,.985)!important;
    box-shadow:0 8px 22px rgba(0,0,0,.2)!important
  }

  body.mobile-demo-active[data-mobile-context="history"] .mobile-context-back{
    min-height:34px!important;
    padding:0 10px!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-row,
  body.mobile-demo-active #completed-match-detail .role-matchup-row{
    grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr)!important
  }

  body.mobile-demo-active #completed-match-detail .mobile-recovery-gold-delta,
  body.mobile-demo-active #completed-match-detail .role-gold-delta{
    min-width:60px!important;
    min-height:34px!important;
    margin:auto 2px!important;
    padding:6px 3px!important;
    font-size:.74rem!important;
    font-weight:950!important;
    line-height:1!important;
    letter-spacing:-.015em!important
  }

  body.mobile-demo-active #completed-match-detail .role-gold-delta strong{
    font-size:.74rem!important;
    font-weight:950!important;
    line-height:1!important
  }
}`;
document.head.append(style);

let movingContextBar = false;

function historyModeActive(): boolean {
  return media.matches && body.dataset.mobileContext === 'history';
}

function syncHistoryChrome(): void {
  if (!analysisPanel || !contextBar || !historyModeActive() || movingContextBar) return;
  if (analysisPanel.firstElementChild === contextBar) return;
  movingContextBar = true;
  analysisPanel.prepend(contextBar);
  movingContextBar = false;
}

window.addEventListener('esports-live:completed-selection', () => queueMicrotask(syncHistoryChrome));
window.addEventListener('esports-live:ended-snapshot', () => queueMicrotask(syncHistoryChrome));
window.addEventListener('esports-live:selection', () => queueMicrotask(syncHistoryChrome));
window.addEventListener('pageshow', syncHistoryChrome);

if (analysisPanel) {
  new MutationObserver(syncHistoryChrome).observe(analysisPanel, { childList: true });
}

if (typeof media.addEventListener === 'function') media.addEventListener('change', syncHistoryChrome);
else if (typeof media.addListener === 'function') media.addListener(syncHistoryChrome);

syncHistoryChrome();

const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
if (nav) nav.dataset.mobileNavVersion = '0.14';

export {};
