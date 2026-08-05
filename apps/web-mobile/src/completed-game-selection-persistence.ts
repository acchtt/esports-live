const gameSelector = document.querySelector<HTMLElement>('#game-selector');
const historyPanel = document.querySelector<HTMLElement>('#series-history');

let pinnedGameId: string | null = null;
let reconcileQueued = false;
let restoringSelection = false;

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

function buttonFor(gameId: string): HTMLButtonElement | null {
  return gameSelector?.querySelector<HTMLButtonElement>(
    `[data-game-id="${CSS.escape(gameId)}"]`
  ) ?? null;
}

function publishPin(): void {
  if (pinnedGameId) document.documentElement.dataset.mobilePinnedGameId = pinnedGameId;
  else delete document.documentElement.dataset.mobilePinnedGameId;
}

function setPinnedGame(gameId: string | null): void {
  pinnedGameId = gameId;
  publishPin();
}

function intendedGameId(): string | null {
  const active = activeGameId();
  if (active) return active;
  if (pinnedGameId && buttonFor(pinnedGameId)) return pinnedGameId;
  return null;
}

function syncVisibleCards(): void {
  const intended = intendedGameId();
  historyPanel?.querySelectorAll<HTMLElement>('[data-history-game-id]').forEach(card => {
    const selected = Boolean(intended) && card.dataset.historyGameId === intended;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-current', selected ? 'true' : 'false');
  });
}

function restorePinnedSelection(): void {
  if (!pinnedGameId || restoringSelection) return;
  const button = buttonFor(pinnedGameId);
  if (!button || button.classList.contains('active')) return;

  restoringSelection = true;
  try {
    button.click();
  } finally {
    queueMicrotask(() => {
      restoringSelection = false;
      queueReconcile();
    });
  }
}

function reconcile(): void {
  restorePinnedSelection();
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
    setPinnedGame(null);
    queueReconcile();
    return;
  }

  const historyCard = target.closest<HTMLElement>('[data-history-game-id]');
  if (historyCard?.dataset.historyGameId) {
    setPinnedGame(historyCard.dataset.historyGameId);
    queueReconcile();
    return;
  }

  const gameButton = target.closest<HTMLButtonElement>('[data-game-id]');
  if (gameButton?.dataset.gameId) {
    setPinnedGame(gameButton.dataset.gameId);
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

window.addEventListener('pageshow', queueReconcile);
document.documentElement.dataset.completedGameSelectionPersistence = 'explicit-pin-v2';
document.documentElement.dataset.gameSelectionPersistence = 'active-selector-contract-v27';
queueReconcile();

export {};
