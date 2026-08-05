const gameSelector = document.querySelector<HTMLElement>('#game-selector');
const historyPanel = document.querySelector<HTMLElement>('#series-history');
const gameContent = document.querySelector<HTMLElement>('#game-content');

let pinnedGameId: string | null = null;
let reconcileQueued = false;
let restoringSelection = false;
let restorePending = false;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  #series-history.live-series-results [data-history-game-id].selected{
    border-color:rgba(56,189,248,.48)!important;
    box-shadow:inset 0 0 0 1px rgba(56,189,248,.16)!important
  }
}
`;
document.head.append(style);

function activeGameId(): string | null {
  return gameSelector?.querySelector<HTMLButtonElement>('[data-game-id].active')?.dataset.gameId ?? null;
}

function renderedGameId(): string | null {
  const board = gameContent?.querySelector<HTMLElement>(
    '[data-live-history-game-id], [data-mobile-unified-game-id], [data-live-dashboard-game-id]'
  );
  return board?.dataset.liveHistoryGameId
    ?? board?.dataset.mobileUnifiedGameId
    ?? board?.dataset.liveDashboardGameId
    ?? null;
}

function syncVisibleCards(): void {
  const active = activeGameId();
  historyPanel?.querySelectorAll<HTMLElement>('[data-history-game-id]').forEach(card => {
    const selected = Boolean(active) && card.dataset.historyGameId === active;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-current', selected ? 'true' : 'false');
  });
}

function requestRestore(button: HTMLButtonElement): void {
  if (restorePending) return;
  restorePending = true;
  restoringSelection = true;
  try {
    button.click();
  } finally {
    restoringSelection = false;
    window.setTimeout(() => {
      restorePending = false;
      queueReconcile();
    }, 400);
  }
}

function reconcile(): void {
  if (!gameSelector) return;

  if (pinnedGameId) {
    const selector = `[data-game-id="${CSS.escape(pinnedGameId)}"]`;
    const button = gameSelector.querySelector<HTMLButtonElement>(selector);
    if (button) {
      const active = button.classList.contains('active');
      const rendered = renderedGameId();
      if (!active || (rendered !== null && rendered !== pinnedGameId)) requestRestore(button);
    }
  }

  syncVisibleCards();
}

function queueReconcile(): void {
  if (reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(() => {
    reconcileQueued = false;
    reconcile();
  });
}

document.addEventListener('click', event => {
  if (restoringSelection || !event.isTrusted) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('[data-series-id], [data-completed-series-id]')) {
    pinnedGameId = null;
    queueReconcile();
    return;
  }

  const historyCard = target.closest<HTMLElement>('[data-history-game-id]');
  if (historyCard?.dataset.historyGameId) {
    pinnedGameId = historyCard.dataset.historyGameId;
    queueReconcile();
    return;
  }

  const gameButton = target.closest<HTMLButtonElement>('[data-game-id]');
  if (gameButton?.dataset.gameId) {
    pinnedGameId = gameButton.dataset.gameId;
    queueReconcile();
  }
}, { capture: true });

if (gameSelector) {
  new MutationObserver(queueReconcile).observe(gameSelector, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
}

if (historyPanel) {
  new MutationObserver(queueReconcile).observe(historyPanel, {
    childList: true,
    subtree: true
  });
}

if (gameContent) {
  new MutationObserver(queueReconcile).observe(gameContent, {
    childList: true,
    subtree: true
  });
}

window.addEventListener('esports-live:snapshot', queueReconcile);
window.addEventListener('pageshow', queueReconcile);
document.documentElement.dataset.completedGameSelectionPersistence = 'explicit-pin-all-states';
document.documentElement.dataset.gameSelectionPersistence = 'visible-card-board-sync';
queueReconcile();

export {};
