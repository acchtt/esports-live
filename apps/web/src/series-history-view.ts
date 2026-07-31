import type {
  SeriesContext,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const LIVE_REFRESH_MS = 15_000;
const IDLE_REFRESH_MS = 60_000;
const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const scheduleList = requiredElement<HTMLElement>('#schedule-list');
const historyPanel = requiredElement<HTMLElement>('#series-history');

let activeSeriesId: string | null = null;
let requestId = 0;
let loading = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const style = document.createElement('style');
style.textContent = `
  .series-history {
    display: grid;
    gap: 14px;
    margin: 0 24px 18px;
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.018);
  }
  .series-history[hidden] { display: none; }
  .series-history-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  .series-history-heading h3 { margin: 2px 0 0; font-size: 0.96rem; }
  .series-history-heading span,
  .history-game-state {
    color: var(--muted);
    font-size: 0.65rem;
    font-weight: 800;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }
  .series-score {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
    padding: 14px;
    border: 1px solid rgba(148, 163, 184, 0.13);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.018);
  }
  .series-score-team { min-width: 0; }
  .series-score-team:last-child { text-align: right; }
  .series-score-team strong { display: block; overflow-wrap: anywhere; font-size: 0.84rem; }
  .series-score-team small { color: var(--muted); }
  .series-score-value {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 1.55rem;
    font-weight: 900;
  }
  .series-score-value span { color: #475569; font-size: 0.9rem; }
  .history-games {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 10px;
  }
  .history-game {
    display: grid;
    gap: 9px;
    min-width: 0;
    padding: 13px;
    border: 1px solid rgba(148, 163, 184, 0.13);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.016);
  }
  .history-game.completed { border-color: rgba(34, 197, 94, 0.2); }
  .history-game.live,
  .history-game.draft,
  .history-game.paused { border-color: rgba(56, 189, 248, 0.3); }
  .history-game-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .history-game-top strong { font-size: 0.8rem; }
  .history-sides { display: grid; gap: 5px; }
  .history-side {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    color: var(--muted);
    font-size: 0.7rem;
  }
  .history-side b { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
  .history-side.blue span { color: #7dd3fc; }
  .history-side.red span { color: #fda4af; }
  .history-result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.1);
    font-size: 0.7rem;
  }
  .history-result strong { overflow-wrap: anywhere; color: #bbf7d0; }
  .history-result span { color: var(--muted); white-space: nowrap; }
  .series-history-message {
    color: var(--muted);
    font-size: 0.76rem;
    line-height: 1.5;
  }
  .series-history-message.warning { color: #fcd34d; }
  @media (max-width: 720px) {
    .series-history { margin: 0 14px 14px; padding: 14px; }
    .series-history-heading { display: grid; }
    .series-score { grid-template-columns: 1fr auto 1fr; padding: 12px; }
    .series-score-value { gap: 6px; font-size: 1.25rem; }
    .history-games { grid-template-columns: 1fr; }
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

function selectedSeriesIdentifier(): string | null {
  return scheduleList.querySelector<HTMLButtonElement>('.match-card.selected')?.dataset.seriesId ?? null;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Duration unavailable';
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function teamName(team: TeamRef | null): string {
  return team?.name ?? 'Unavailable';
}

function stateLabel(game: SeriesGameHistoryRef): string {
  switch (game.state) {
    case 'unstarted': return 'Pending';
    case 'draft': return 'Draft';
    case 'live': return 'Live';
    case 'paused': return 'Paused';
    case 'completed': return 'Final';
    default: return 'Unknown';
  }
}

function resultLabel(game: SeriesGameHistoryRef): string {
  if (game.winner) return `Winner · ${game.winner.name}`;
  if (game.state === 'completed') return 'Winner unavailable';
  return 'Result pending';
}

function gameMarkup(game: SeriesGameHistoryRef): string {
  return `
    <article class="history-game ${escapeHtml(game.state)}">
      <div class="history-game-top">
        <strong>Game ${escapeHtml(game.number)}</strong>
        <span class="history-game-state">${escapeHtml(stateLabel(game))}</span>
      </div>
      <div class="history-sides">
        <div class="history-side blue"><span>BLUE</span><b>${escapeHtml(teamName(game.blueTeam))}</b></div>
        <div class="history-side red"><span>RED</span><b>${escapeHtml(teamName(game.redTeam))}</b></div>
      </div>
      <div class="history-result">
        <strong>${escapeHtml(resultLabel(game))}</strong>
        <span>${escapeHtml(formatDuration(game.durationSeconds))}</span>
      </div>
    </article>`;
}

function formatDescription(history: SeriesHistoryRef): string {
  const draw = history.drawPossible ? ' · Draw possible' : '';
  return `Best of ${history.bestOf} · First to ${history.winsRequired}${draw}`;
}

function historyMarkup(history: SeriesHistoryRef): string {
  const [left, right] = history.score;
  return `
    <div class="series-history-heading">
      <div><span>Series game history</span><h3>${escapeHtml(formatDescription(history))}</h3></div>
      <span>${escapeHtml(history.games.filter(game => game.state === 'completed').length)} completed</span>
    </div>
    <div class="series-score">
      <div class="series-score-team"><strong>${escapeHtml(left.team.name)}</strong><small>${escapeHtml(left.team.code ?? '')}</small></div>
      <div class="series-score-value"><b>${escapeHtml(left.wins)}</b><span>–</span><b>${escapeHtml(right.wins)}</b></div>
      <div class="series-score-team"><strong>${escapeHtml(right.team.name)}</strong><small>${escapeHtml(right.team.code ?? '')}</small></div>
    </div>
    <div class="history-games">${history.games.map(gameMarkup).join('')}</div>`;
}

function showMessage(message: string, warning = false): void {
  historyPanel.hidden = false;
  historyPanel.innerHTML = `<div class="series-history-message ${warning ? 'warning' : ''}">${escapeHtml(message)}</div>`;
}

function clearTimer(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function nextRefreshDelay(): number {
  return /(^|\s)(LIVE|PAUSED)(\s|$)/i.test(selectedMeta.textContent ?? '')
    ? LIVE_REFRESH_MS
    : IDLE_REFRESH_MS;
}

function scheduleRefresh(seriesId: string): void {
  clearTimer();
  refreshTimer = setTimeout(() => {
    if (activeSeriesId === seriesId) void loadHistory(seriesId);
  }, nextRefreshDelay());
}

async function loadHistory(seriesId: string): Promise<void> {
  if (loading && activeSeriesId === seriesId) return;
  const currentRequest = ++requestId;
  loading = true;
  showMessage('Loading series score and game results…');

  try {
    const response = await fetch(
      `${API_BASE}/v1/lol/series/${encodeURIComponent(seriesId)}/context?history=${Date.now()}`,
      { cache: 'no-store' }
    );
    const body = await response.json().catch(() => null) as SeriesContext | { message?: string } | null;
    if (!response.ok) {
      const message = body && 'message' in body ? body.message : null;
      throw new Error(message ?? `History API returned ${response.status}.`);
    }
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    const context = body as SeriesContext;
    if (!context.history) {
      showMessage('Riot has not published game-history details for this series.', true);
    } else {
      historyPanel.hidden = false;
      historyPanel.innerHTML = historyMarkup(context.history);
    }
  } catch (error) {
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    showMessage(error instanceof Error ? error.message : 'Series history is unavailable.', true);
  } finally {
    if (currentRequest === requestId && activeSeriesId === seriesId) {
      loading = false;
      scheduleRefresh(seriesId);
    }
  }
}

function syncSelection(): void {
  const seriesId = selectedSeriesIdentifier();
  const title = selectedSeries.textContent?.trim() ?? '';
  const validSelection = Boolean(seriesId && title.includes(' vs '));
  if (!validSelection) {
    activeSeriesId = null;
    requestId += 1;
    loading = false;
    clearTimer();
    historyPanel.hidden = true;
    historyPanel.replaceChildren();
    return;
  }

  if (seriesId === activeSeriesId) return;
  activeSeriesId = seriesId;
  requestId += 1;
  loading = false;
  clearTimer();
  void loadHistory(seriesId);
}

const observer = new MutationObserver(() => queueMicrotask(syncSelection));
observer.observe(selectedSeries, { childList: true, characterData: true, subtree: true });
observer.observe(selectedMeta, { childList: true, characterData: true, subtree: true });
observer.observe(scheduleList, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});

syncSelection();
