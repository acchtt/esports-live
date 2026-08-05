const gameSelector = document.querySelector<HTMLElement>('#game-selector');

let pinnedCompletedGameId: string | null = null;
let reconcileQueued = false;
let restoringSelection = false;

function queueReconcile(): void {
  if (!gameSelector || reconcileQueued) return;
  reconcileQueued = true;
  queueMicrotask(() => {
    reconcileQueued = false;
    if (!pinnedCompletedGameId) return;

    const selector = `[data-game-id="${CSS.escape(pinnedCompletedGameId)}"]`;
    const button = gameSelector.querySelector<HTMLButtonElement>(selector);
    if (!button || !button.classList.contains('completed')) {
      pinnedCompletedGameId = null;
      return;
    }
    if (button.classList.contains('active')) return;

    restoringSelection = true;
    try {
      button.click();
    } finally {
      restoringSelection = false;
    }
  });
}

document.addEventListener('click', event => {
  if (restoringSelection) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('[data-series-id]')) {
    pinnedCompletedGameId = null;
    return;
  }

  const gameButton = target.closest<HTMLButtonElement>('[data-game-id]');
  if (!gameButton) return;
  pinnedCompletedGameId = gameButton.classList.contains('completed')
    ? gameButton.dataset.gameId ?? null
    : null;
}, { capture: true });

if (gameSelector) {
  new MutationObserver(queueReconcile).observe(gameSelector, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
}

document.documentElement.dataset.completedGameSelectionPersistence = 'explicit-pin';

export {};
