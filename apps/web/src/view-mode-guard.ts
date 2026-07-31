const activeList = document.querySelector<HTMLElement>('#schedule-list');
const activeHeader = document.querySelector<HTMLElement>('.analysis-header');
const seriesHistory = document.querySelector<HTMLElement>('#series-history');
const qualityBanner = document.querySelector<HTMLElement>('#quality-banner');
const gameContent = document.querySelector<HTMLElement>('#game-content');

const style = document.createElement('style');
style.textContent = `
  body[data-view-mode="match-history"] #schedule-list,
  body[data-view-mode="match-history"] .analysis-header,
  body[data-view-mode="match-history"] #series-history,
  body[data-view-mode="match-history"] #quality-banner,
  body[data-view-mode="match-history"] #game-content {
    display: none !important;
  }

  body[data-view-mode="match-history"] #completed-match-list:not([hidden]) {
    display: grid !important;
  }

  body[data-view-mode="match-history"] #completed-match-detail:not([hidden]) {
    display: grid !important;
  }
`;
document.head.append(style);

function resultButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-mode="results"]');
}

function completedList(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#completed-match-list');
}

function completedDetail(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#completed-match-detail');
}

function inMatchHistoryMode(): boolean {
  return resultButton()?.classList.contains('active') ?? false;
}

function hideActiveSurface(): void {
  activeList?.setAttribute('hidden', '');
  activeHeader?.setAttribute('hidden', '');
  seriesHistory?.setAttribute('hidden', '');
  qualityBanner?.setAttribute('hidden', '');
  gameContent?.setAttribute('hidden', '');
}

function applyViewMode(): void {
  const historyMode = inMatchHistoryMode();
  document.body.dataset.viewMode = historyMode ? 'match-history' : 'active';

  if (historyMode) {
    hideActiveSurface();
    completedList()?.removeAttribute('hidden');
    completedDetail()?.removeAttribute('hidden');
  }
}

function bindModeButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    if (button.dataset.viewGuardBound === 'true') return;
    button.dataset.viewGuardBound = 'true';
    button.addEventListener('click', () => {
      queueMicrotask(applyViewMode);
      requestAnimationFrame(applyViewMode);
    });
  });
  applyViewMode();
}

const controlsObserver = new MutationObserver(() => bindModeButtons());
controlsObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});

for (const element of [activeHeader, seriesHistory, qualityBanner, gameContent]) {
  if (!element) continue;
  new MutationObserver(() => {
    if (inMatchHistoryMode() && !element.hidden) element.hidden = true;
  }).observe(element, { attributes: true, attributeFilter: ['hidden'] });
}

bindModeButtons();
