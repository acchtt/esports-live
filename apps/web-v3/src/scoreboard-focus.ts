function isMatchRoute(): boolean {
  return document.documentElement.dataset.arenaRoute === 'match';
}

export function installScoreboardFocus(root: HTMLElement): () => void {
  const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
  const gameTabs = root.querySelector<HTMLElement>('#game-tabs');
  const gameLabel = root.querySelector<HTMLElement>('#game-label');
  if (!scoreboard || !gameTabs || !gameLabel) return () => undefined;

  let stopped = false;
  const closeMenu = (): void => {
    gameTabs.dataset.menuOpen = 'false';
    gameLabel.setAttribute('aria-expanded', 'false');
  };

  const gameChoices = (): HTMLElement[] => [
    ...gameTabs.querySelectorAll<HTMLElement>('[data-game-id]')
  ];

  const canSelectGame = (): boolean => !gameTabs.hidden && gameChoices().length > 1;

  const syncTrigger = (): void => {
    if (stopped) return;
    const selectable = canSelectGame();
    gameLabel.classList.toggle('game-selector-trigger', selectable);
    gameLabel.setAttribute('role', selectable ? 'button' : 'status');
    gameLabel.setAttribute('aria-controls', 'game-tabs');
    gameLabel.setAttribute('aria-haspopup', selectable ? 'menu' : 'false');
    gameLabel.setAttribute('aria-disabled', String(!selectable));
    gameLabel.tabIndex = selectable ? 0 : -1;
    if (!selectable || !isMatchRoute()) closeMenu();
  };

  const toggleMenu = (): void => {
    if (!isMatchRoute() || !canSelectGame()) return;
    const nextOpen = gameTabs.dataset.menuOpen !== 'true';
    gameTabs.dataset.menuOpen = String(nextOpen);
    gameLabel.setAttribute('aria-expanded', String(nextOpen));
  };

  const onRootClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('#game-label')) {
      event.preventDefault();
      toggleMenu();
      return;
    }
    if (target.closest('#game-tabs [data-game-id]')) closeMenu();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== gameLabel || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    toggleMenu();
  };

  const onDocumentClick = (event: MouseEvent): void => {
    if (gameTabs.dataset.menuOpen !== 'true') return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('#game-label') || target.closest('#game-tabs')) return;
    closeMenu();
  };

  const tabsObserver = new MutationObserver(syncTrigger);
  tabsObserver.observe(gameTabs, {
    childList: true,
    attributes: true,
    attributeFilter: ['hidden']
  });
  const routeObserver = new MutationObserver(syncTrigger);
  routeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-arena-route']
  });

  gameTabs.dataset.menuOpen = 'false';
  gameTabs.setAttribute('role', 'menu');
  root.addEventListener('click', onRootClick, true);
  root.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onDocumentClick);
  syncTrigger();

  return () => {
    stopped = true;
    tabsObserver.disconnect();
    routeObserver.disconnect();
    root.removeEventListener('click', onRootClick, true);
    root.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onDocumentClick);
    closeMenu();
  };
}
