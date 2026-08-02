type ViewMode = 'active' | 'match-history';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const modeTabs = requiredElement<HTMLElement>('.schedule-mode-tabs');
const resultsButton = requiredElement<HTMLButtonElement>('[data-mode="results"]');
const historyPanel = requiredElement<HTMLElement>('#series-history');
const completedDetail = requiredElement<HTMLElement>('#completed-match-detail');

const style = document.createElement('style');
style.textContent = `
  body[data-esports-view-mode='match-history'] #series-history {
    display: none !important;
  }
`;
document.head.append(style);

let publishedMode: ViewMode | null = null;
let syncQueued = false;

function selectedMode(): ViewMode {
  return resultsButton.classList.contains('active') || !completedDetail.hidden
    ? 'match-history'
    : 'active';
}

function syncViewOwnership(): void {
  syncQueued = false;
  const mode = selectedMode();
  document.body.dataset.esportsViewMode = mode;

  if (mode === 'match-history' && !historyPanel.hidden) {
    historyPanel.hidden = true;
  }

  if (publishedMode === mode) return;
  publishedMode = mode;
  window.dispatchEvent(new CustomEvent<{ mode: ViewMode }>('esports-live:view-mode', {
    detail: { mode }
  }));
}

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(syncViewOwnership);
}

const observer = new MutationObserver(queueSync);
observer.observe(modeTabs, {
  attributes: true,
  subtree: true,
  attributeFilter: ['class']
});
observer.observe(completedDetail, {
  attributes: true,
  attributeFilter: ['hidden']
});
observer.observe(historyPanel, {
  attributes: true,
  attributeFilter: ['hidden']
});

document.addEventListener('click', event => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('.schedule-mode[data-mode]')
    : null;
  if (target) queueSync();
});

window.addEventListener('beforeunload', () => observer.disconnect());

syncViewOwnership();
