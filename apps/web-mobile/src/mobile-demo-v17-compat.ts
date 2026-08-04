const gameContent = document.querySelector<HTMLElement>('#game-content');

function syncUnifiedBoardAliases(): void {
  if (!gameContent) return;
  gameContent.querySelectorAll<HTMLElement>('[data-live-dashboard-game-id]').forEach(board => {
    const gameId = board.dataset.liveDashboardGameId;
    if (gameId && board.dataset.liveHistoryGameId !== gameId) {
      board.dataset.liveHistoryGameId = gameId;
    }
  });
}

if (gameContent) {
  new MutationObserver(syncUnifiedBoardAliases).observe(gameContent, {
    childList: true,
    subtree: true
  });
}

window.addEventListener('esports-live:snapshot', () => queueMicrotask(syncUnifiedBoardAliases));
window.addEventListener('pageshow', syncUnifiedBoardAliases);
syncUnifiedBoardAliases();

export {};
