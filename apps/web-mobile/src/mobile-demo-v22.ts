const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');
const historyPanel = document.querySelector<HTMLElement>('#series-history');
let cleanupQueued = false;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  html body.mobile-demo-active #completed-match-detail
  [data-mobile-scoreboard-renderer="shared-v1"]{
    width:100%!important;
    max-width:100%!important;
    margin-right:0!important;
    margin-left:0!important;
    box-sizing:border-box!important
  }

  html body.mobile-demo-active #completed-match-detail
  [data-mobile-scoreboard-renderer="shared-v1"]>.mobile-unified-scoreboard-comparison,
  html body.mobile-demo-active[data-mobile-view="live"]
  [data-mobile-scoreboard-renderer="shared-v1"]>.mobile-unified-scoreboard-comparison{
    display:block!important;
    visibility:visible!important;
    opacity:1!important
  }

  html body.mobile-demo-active #completed-match-detail
  [data-mobile-scoreboard-renderer="shared-v1"]>.mobile-unified-scoreboard-matchups,
  html body.mobile-demo-active[data-mobile-view="live"]
  [data-mobile-scoreboard-renderer="shared-v1"]>.mobile-unified-scoreboard-matchups{
    display:block!important;
    visibility:visible!important;
    opacity:1!important
  }

  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.mobile-completed-team-names,
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.mobile-completed-objectives,
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.history-v2-team-header,
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.history-v2-summary,
  body.mobile-demo-active[data-mobile-view="live"]:not([data-mobile-context="history"])
  .mobile-live-history-board[data-mobile-live-design="history-current"]>.history-v2-objectives{
    display:none!important
  }
}
`;
document.head.append(style);

function liveModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext !== 'history';
}

function currentBoard(): HTMLElement | null {
  if (!gameContent || !liveModeActive()) return null;
  return gameContent.querySelector<HTMLElement>(
    '.mobile-live-history-board[data-mobile-history-copy="true"][data-mobile-live-design="history-current"]'
  );
}

function removeLegacyComparisonLayers(board: HTMLElement): void {
  const canonical = board.querySelector<HTMLElement>(
    '.completed-team-comparison.mobile-live-parity-comparison'
  );
  if (!canonical) return;

  board.querySelectorAll<HTMLElement>(
    '.mobile-completed-team-names, .mobile-completed-objectives, .history-v2-team-header, .history-v2-summary, .history-v2-objectives'
  ).forEach(element => {
    if (!canonical.contains(element)) element.remove();
  });

  board.querySelectorAll<HTMLElement>('.mobile-live-parity-objectives').forEach(element => {
    if (!canonical.contains(element)) element.remove();
  });
}

function isTransientContextMessage(): boolean {
  if (!historyPanel?.classList.contains('live-series-message-panel')) return false;
  const text = historyPanel.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return /^Series context enrichment is still loading\.?$/i.test(text)
    || /^Loading series score and game results/i.test(text);
}

function suppressResolvedContextMessage(board: HTMLElement): void {
  if (!historyPanel || board.dataset.liveBoardState === 'pending' || !isTransientContextMessage()) return;
  historyPanel.hidden = true;
  historyPanel.className = 'series-history';
  historyPanel.replaceChildren();
}

function cleanupLiveSurface(): void {
  cleanupQueued = false;
  const board = currentBoard();
  if (!board) return;
  removeLegacyComparisonLayers(board);
  suppressResolvedContextMessage(board);
  board.dataset.mobileLiveCleanup = 'v22';
  document.documentElement.dataset.mobileLiveSurface = 'v22';
}

function queueCleanup(): void {
  if (cleanupQueued) return;
  cleanupQueued = true;
  queueMicrotask(cleanupLiveSurface);
}

if (gameContent) {
  new MutationObserver(queueCleanup).observe(gameContent, {
    childList: true,
    subtree: true
  });
}
if (historyPanel) {
  new MutationObserver(queueCleanup).observe(historyPanel, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'hidden']
  });
}
new MutationObserver(queueCleanup).observe(body, {
  attributes: true,
  attributeFilter: ['data-mobile-view', 'data-mobile-context']
});
window.addEventListener('esports-live:snapshot', queueCleanup);
window.addEventListener('esports-live:ended-snapshot', queueCleanup);
window.addEventListener('pageshow', queueCleanup);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueCleanup);
else if (typeof media.addListener === 'function') media.addListener(queueCleanup);

queueCleanup();

export {};
