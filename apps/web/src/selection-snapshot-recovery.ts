import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { apiJson } from './api-client.ts';

export {};

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const RETRY_MS = 1_000;

const scheduleList = document.querySelector<HTMLElement>('#schedule-list');
const gameSelector = document.querySelector<HTMLElement>('#game-selector');
const gameContent = document.querySelector<HTMLElement>('#game-content');

let requestGeneration = 0;
let refreshTimer: number | null = null;
let queued = false;
let activeKey = '';

function clearRefreshTimer(): void {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = null;
}

function selectedSeriesButton(): HTMLButtonElement | null {
  return scheduleList?.querySelector<HTMLButtonElement>('[data-series-id].selected') ?? null;
}

function selectedGameButton(): HTMLButtonElement | null {
  return gameSelector?.querySelector<HTMLButtonElement>('[data-game-id].active') ?? null;
}

function currentSelection(): {
  seriesId: string;
  gameId: string;
  gameState: string;
} | null {
  const series = selectedSeriesButton();
  const game = selectedGameButton();
  if (!series || !game) return null;

  const seriesId = series.dataset.seriesId ?? '';
  const gameId = game.dataset.gameId ?? '';
  if (!seriesId || !gameId) return null;

  const gameState = ['completed', 'live', 'draft', 'unstarted', 'unknown']
    .find(state => game.classList.contains(state)) ?? 'unknown';
  return { seriesId, gameId, gameState };
}

function selectionStillMatches(seriesId: string, gameId: string): boolean {
  const selection = currentSelection();
  return selection?.seriesId === seriesId && selection.gameId === gameId;
}

function renderLoading(): void {
  if (!gameContent) return;
  gameContent.innerHTML = `
    <div class="analysis-empty" data-selection-snapshot-loading>
      <span class="analysis-empty-icon" aria-hidden="true">↻</span>
      <h3>Loading selected game</h3>
      <p>Fetching the latest verified telemetry for this game.</p>
    </div>`;
}

function renderUnavailable(message: string): void {
  if (!gameContent) return;
  gameContent.innerHTML = `
    <div class="analysis-empty" data-selection-snapshot-error>
      <span class="analysis-empty-icon" aria-hidden="true">⌁</span>
      <h3>Selected game unavailable</h3>
      <p>${message.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>
    </div>`;
}

function scheduleRefresh(seriesId: string, gameId: string): void {
  clearRefreshTimer();
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    if (!selectionStillMatches(seriesId, gameId) || document.hidden) return;
    void refreshSelectedSnapshot(true);
  }, RETRY_MS);
}

async function refreshSelectedSnapshot(force = false): Promise<void> {
  const selection = currentSelection();
  if (!selection || document.hidden) return;

  const key = `${selection.seriesId}:${selection.gameId}`;
  if (!force && key === activeKey) return;
  activeKey = key;

  const generation = ++requestGeneration;
  clearRefreshTimer();
  renderLoading();

  try {
    const snapshot = await apiJson<LiveSnapshot<LolStats>>(
      API_BASE,
      `/v1/lol/games/${encodeURIComponent(selection.gameId)}/live?selection=${Date.now()}`
    );
    if (generation !== requestGeneration) return;
    if (!selectionStillMatches(selection.seriesId, selection.gameId)) return;

    if (snapshot.stats) {
      window.dispatchEvent(new CustomEvent<LiveSnapshot<LolStats>>('esports-live:snapshot', {
        detail: snapshot
      }));
    } else {
      const reason = snapshot.quality.reasons.map(item => item.message).join(' ')
        || 'No normalized gameplay frame is available for this game yet.';
      renderUnavailable(reason);
    }
  } catch (error) {
    if (generation !== requestGeneration) return;
    if (!selectionStillMatches(selection.seriesId, selection.gameId)) return;
    renderUnavailable(error instanceof Error ? error.message : 'Unknown snapshot error.');
  } finally {
    if (generation !== requestGeneration) return;
    if (!selectionStillMatches(selection.seriesId, selection.gameId)) return;
    if (selection.gameState !== 'completed') scheduleRefresh(selection.seriesId, selection.gameId);
  }
}

function queueSelectionSync(force = false): void {
  if (force) activeKey = '';
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    void refreshSelectedSnapshot(force);
  });
}

for (const root of [scheduleList, gameSelector]) {
  if (!root) continue;
  new MutationObserver(() => queueSelectionSync()).observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
}

document.addEventListener('click', event => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-series-id], [data-game-id]')
    : null;
  if (!target) return;
  window.setTimeout(() => queueSelectionSync(true), 0);
});

window.addEventListener('esports-live:selection', () => queueSelectionSync(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    requestGeneration += 1;
    clearRefreshTimer();
    return;
  }
  queueSelectionSync(true);
});
window.addEventListener('beforeunload', () => {
  requestGeneration += 1;
  clearRefreshTimer();
});

queueSelectionSync(true);
