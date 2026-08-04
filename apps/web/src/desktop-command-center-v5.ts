import './desktop-command-center-v5.css';
import './desktop-command-center-v5-fixes.css';
import './desktop-command-center-v5-hotfix.css';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing desktop command center element: ${selector}`);
  return element;
}

const analysisPanel = requiredElement<HTMLElement>('.analysis-panel');
const analysisHeader = requiredElement<HTMLElement>('.analysis-header');
const historyPanel = requiredElement<HTMLElement>('#series-history');
const gameContent = requiredElement<HTMLElement>('#game-content');

analysisPanel.classList.add('desktop-command-center-v5');

let overview = analysisPanel.querySelector<HTMLElement>(':scope > .command-center-overview');
if (!overview) {
  overview = document.createElement('div');
  overview.className = 'command-center-overview';
  analysisPanel.insertBefore(overview, analysisHeader);
  overview.append(analysisHeader, historyPanel);
}

let normalizeQueued = false;

function normalizeLayout(): void {
  normalizeQueued = false;
  const historyVisible = !historyPanel.hidden && historyPanel.childElementCount > 0;
  overview?.classList.toggle('has-series-history', historyVisible);

  const dashboard = gameContent.querySelector<HTMLElement>('.live-dashboard-v2');
  analysisPanel.classList.toggle('has-live-command-center', Boolean(dashboard));
  if (!dashboard) return;

  const hero = dashboard.querySelector<HTMLElement>(':scope > .v2-hero');
  const toolbar = dashboard.querySelector<HTMLElement>(':scope > .player-board-toolbar');
  if (hero && toolbar && hero.nextElementSibling !== toolbar) {
    hero.insertAdjacentElement('afterend', toolbar);
  }

  const title = toolbar?.querySelector<HTMLElement>('.player-board-toolbar-copy strong');
  if (title && title.textContent !== 'Live player board') title.textContent = 'Live player board';
}

function queueNormalize(): void {
  if (normalizeQueued) return;
  normalizeQueued = true;
  queueMicrotask(normalizeLayout);
}

const observer = new MutationObserver(queueNormalize);
observer.observe(historyPanel, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
observer.observe(gameContent, { childList: true, subtree: true });

window.addEventListener('esports-live:selection', queueNormalize);
window.addEventListener('esports-live:snapshot', queueNormalize);
window.addEventListener('beforeunload', () => observer.disconnect());

queueNormalize();
