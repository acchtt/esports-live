import './completed-board-merge-view.css';

export {};

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const completedDetail = requiredElement<HTMLElement>('#completed-match-detail');

function gameNumber(element: Element, fallbackIndex = 0): string {
  return element.querySelector('.completed-game-top strong, .completed-final-game-header strong')
    ?.textContent
    ?.match(/Game\s+(\d+)/i)?.[1] ?? String(fallbackIndex + 1);
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
    return;
  }
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function activateGame(number: string): void {
  const tab = [...completedDetail.querySelectorAll<HTMLButtonElement>('[data-final-game-tab]')]
    .find(button => button.dataset.finalGameTab === number);
  if (!tab) return;
  if (!tab.classList.contains('active')) tab.click();
  queueSync();
}

function sync(): void {
  syncScheduled = false;
  const host = completedDetail.querySelector<HTMLElement>('#completed-final-telemetry');
  const loading = host?.querySelector('.completed-telemetry-loading');
  setAttribute(completedDetail, 'data-completed-board-merged', host && !loading ? 'true' : 'false');

  const tabs = [...completedDetail.querySelectorAll<HTMLButtonElement>('[data-final-game-tab]')];
  const tabsByNumber = new Map(tabs.map(button => [button.dataset.finalGameTab ?? '', button]));
  const boards = [...completedDetail.querySelectorAll<HTMLElement>('.completed-final-game')];
  const boardsByNumber = new Map(boards.map((board, index) => [gameNumber(board, index), board]));

  completedDetail.querySelectorAll<HTMLElement>('.completed-games > .completed-game').forEach((card, index) => {
    const number = gameNumber(card, index);
    const tab = tabsByNumber.get(number);
    const board = boardsByNumber.get(number);
    const available = Boolean(tab && board);
    const selected = Boolean(tab?.classList.contains('active'));

    card.classList.toggle('scoreboard-selector', available);
    card.classList.toggle('scoreboard-selected', selected);
    setAttribute(card, 'data-final-game-summary', available ? number : null);
    setAttribute(card, 'role', available ? 'button' : null);
    setAttribute(card, 'tabindex', available ? '0' : null);
    setAttribute(card, 'aria-pressed', available ? String(selected) : null);
    setAttribute(card, 'aria-label', available ? `Show Game ${number} scoreboard` : null);
    setAttribute(card, 'aria-disabled', available ? null : 'true');

    if (available && board) {
      if (!board.id) board.id = `completed-final-scoreboard-${number}`;
      setAttribute(card, 'aria-controls', board.id);
    } else {
      setAttribute(card, 'aria-controls', null);
    }
  });
}

let syncScheduled = false;
function queueSync(): void {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(sync);
}

completedDetail.addEventListener('click', event => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-final-game-summary]')
    : null;
  if (!target || !completedDetail.contains(target)) return;
  const number = target.dataset.finalGameSummary;
  if (!number) return;
  event.preventDefault();
  activateGame(number);
});

completedDetail.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-final-game-summary]')
    : null;
  if (!target || !completedDetail.contains(target)) return;
  const number = target.dataset.finalGameSummary;
  if (!number) return;
  event.preventDefault();
  activateGame(number);
});

new MutationObserver(queueSync).observe(completedDetail, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'data-board-hidden']
});

window.addEventListener('esports-live:completed-selection', queueSync);
window.addEventListener('esports-live:ended-snapshot', queueSync);
queueSync();
