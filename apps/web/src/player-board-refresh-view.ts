import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const gameContent = requiredElement<HTMLElement>('#game-content');
const REFRESH_TIMEOUT_MS = 12_000;
let refreshing = false;
let lastUpdatedAt: string | null = null;
let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let refreshTimeout: number | null = null;
let injectionQueued = false;

const style = document.createElement('style');
style.textContent = `
  .player-board-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
    padding: 10px 12px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 11px;
    background: rgba(15, 23, 42, 0.42);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.025);
  }

  .player-board-toolbar-copy {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .player-board-toolbar-copy strong {
    color: #dce7f5;
    font-size: 0.7rem;
    letter-spacing: 0.075em;
    text-transform: uppercase;
  }

  .player-board-toolbar-copy small {
    overflow: hidden;
    color: #8190a7;
    font-size: 0.58rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .player-board-toolbar-summary {
    display: grid;
    grid-template-columns: repeat(5, minmax(72px, 1fr));
    min-width: 0;
  }

  .player-board-summary-cell {
    display: grid;
    gap: 3px;
    min-width: 0;
    text-align: center;
  }

  .player-board-summary-cell > span {
    color: #71829a;
    font-size: 0.5rem;
    font-weight: 850;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .player-board-summary-values {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 6px;
  }

  .player-board-summary-values b {
    color: #7dd3fc;
    font-size: 0.72rem;
  }

  .player-board-summary-values b:last-child { color: #fb7185; }
  .player-board-summary-values i { color: #526178; font-size: 0.54rem; font-style: normal; }

  .player-board-refresh-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 34px;
    padding: 0 11px;
    border: 1px solid rgba(56, 189, 248, 0.24);
    border-radius: 9px;
    color: #bae6fd;
    background: rgba(56, 189, 248, 0.07);
    cursor: pointer;
    font-size: 0.65rem;
    font-weight: 850;
    transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
  }

  .player-board-refresh-button:hover:not(:disabled) {
    border-color: rgba(56, 189, 248, 0.44);
    color: #f0f9ff;
    background: rgba(56, 189, 248, 0.12);
  }

  .player-board-refresh-button:focus-visible {
    outline: 2px solid rgba(56, 189, 248, 0.58);
    outline-offset: 2px;
  }

  .player-board-refresh-button:disabled {
    cursor: wait;
    opacity: 0.68;
  }

  .player-board-refresh-icon {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    font-size: 0.86rem;
    line-height: 1;
  }

  .player-board-refresh-button[aria-busy='true'] .player-board-refresh-icon {
    animation: player-board-refresh-spin 700ms linear infinite;
  }

  @keyframes player-board-refresh-spin {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .player-board-refresh-button[aria-busy='true'] .player-board-refresh-icon {
      animation: none;
    }
  }

  @media (max-width: 900px) {
    .player-board-toolbar {
      align-items: stretch;
      flex-direction: column;
      gap: 9px;
    }

    .player-board-toolbar-summary { width: 100%; }
    .player-board-refresh-button { width: 100%; }
  }
`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatCompact(value: number | null): string {
  if (value === null) return '—';
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
}

function summaryCell(label: string, blue: number | null, red: number | null): string {
  return `
    <span class="player-board-summary-cell">
      <span>${escapeHtml(label)}</span>
      <span class="player-board-summary-values">
        <b>${escapeHtml(formatCompact(blue))}</b><i>–</i><b>${escapeHtml(formatCompact(red))}</b>
      </span>
    </span>`;
}

function summaryMarkup(): string {
  const stats = latestSnapshot?.stats;
  if (!stats) {
    return [
      summaryCell('Kills', null, null),
      summaryCell('Gold', null, null),
      summaryCell('Towers', null, null),
      summaryCell('Dragons', null, null),
      summaryCell('Barons', null, null)
    ].join('');
  }

  const blueDragons = stats.blue.objectives.dragons === null
    ? null
    : stats.blue.objectives.dragons.length;
  const redDragons = stats.red.objectives.dragons === null
    ? null
    : stats.red.objectives.dragons.length;

  return [
    summaryCell('Kills', stats.blue.kills, stats.red.kills),
    summaryCell('Gold', stats.blue.gold, stats.red.gold),
    summaryCell('Towers', stats.blue.objectives.towers, stats.red.objectives.towers),
    summaryCell('Dragons', blueDragons, redDragons),
    summaryCell('Barons', stats.blue.objectives.barons, stats.red.objectives.barons)
  ].join('');
}

function clearRefreshTimeout(): void {
  if (refreshTimeout !== null) window.clearTimeout(refreshTimeout);
  refreshTimeout = null;
}

function updatedLabel(): string {
  if (!lastUpdatedAt) return 'Live match data and player performance';
  const date = new Date(lastUpdatedAt);
  if (!Number.isFinite(date.getTime())) return 'Latest verified snapshot received';
  return `Live match data · Updated ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function updateControl(toolbar: HTMLElement): void {
  const detail = toolbar.querySelector<HTMLElement>('[data-player-board-refresh-detail]');
  const summary = toolbar.querySelector<HTMLElement>('[data-player-board-summary]');
  const button = toolbar.querySelector<HTMLButtonElement>('[data-player-board-refresh]');
  const detailText = refreshing ? 'Requesting a fresh verified snapshot…' : updatedLabel();
  if (detail && detail.textContent !== detailText) detail.textContent = detailText;
  if (summary) summary.innerHTML = summaryMarkup();
  if (!button) return;

  button.disabled = refreshing;
  button.setAttribute('aria-busy', String(refreshing));
  const label = button.querySelector<HTMLElement>('[data-player-board-refresh-label]');
  const labelText = refreshing ? 'Refreshing…' : 'Refresh board';
  if (label && label.textContent !== labelText) label.textContent = labelText;
}

function installControl(): void {
  injectionQueued = false;
  const board = gameContent.querySelector<HTMLElement>('[data-live-history-game-id]');
  if (!board) return;

  let toolbar = board.querySelector<HTMLElement>(':scope > .player-board-toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'player-board-toolbar';
    toolbar.innerHTML = `
      <div class="player-board-toolbar-copy">
        <strong>Player board</strong>
        <small data-player-board-refresh-detail></small>
      </div>
      <div class="player-board-toolbar-summary" data-player-board-summary aria-label="Current team comparison"></div>
      <button
        type="button"
        class="player-board-refresh-button"
        data-player-board-refresh
        aria-label="Refresh live player board"
        aria-busy="false"
      >
        <span class="player-board-refresh-icon" aria-hidden="true">↻</span>
        <span data-player-board-refresh-label>Refresh board</span>
      </button>`;
    board.insertBefore(toolbar, board.firstElementChild);
  }
  updateControl(toolbar);
}

function queueControl(): void {
  if (injectionQueued) return;
  injectionQueued = true;
  queueMicrotask(installControl);
}

function finishRefresh(): void {
  refreshing = false;
  clearRefreshTimeout();
  queueControl();
}

function requestRefresh(): void {
  if (refreshing) return;
  const activeGame = document.querySelector<HTMLButtonElement>('#game-selector [data-game-id].active');
  if (!activeGame) return;

  refreshing = true;
  queueControl();
  activeGame.click();
  clearRefreshTimeout();
  refreshTimeout = window.setTimeout(finishRefresh, REFRESH_TIMEOUT_MS);
}

gameContent.addEventListener('click', event => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('[data-player-board-refresh]')
    : null;
  if (!target || !gameContent.contains(target)) return;
  requestRefresh();
});

const observer = new MutationObserver(queueControl);
observer.observe(gameContent, { childList: true, subtree: true });

window.addEventListener('esports-live:snapshot', event => {
  latestSnapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  lastUpdatedAt = latestSnapshot?.quality?.sourceTimestamp
    ?? latestSnapshot?.quality?.observedAt
    ?? new Date().toISOString();
  finishRefresh();
});

window.addEventListener('esports-live:selection', () => {
  refreshing = false;
  lastUpdatedAt = null;
  latestSnapshot = null;
  clearRefreshTimeout();
  queueControl();
});

window.addEventListener('beforeunload', () => {
  observer.disconnect();
  clearRefreshTimeout();
});

queueControl();
