import type {
  LiveSnapshot,
  ScheduleEvent,
  SeriesContext,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { apiJson } from './api-client.ts';

interface StoredHistoryState {
  score: [number, number];
  completed: string[];
  winners: Record<string, string>;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const LIVE_REFRESH_MS = 30_000;
const IDLE_REFRESH_MS = 120_000;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const historyPanel = requiredElement<HTMLElement>('#series-history');
const analysisHeader = requiredElement<HTMLElement>('.analysis-header');
const gameSelector = requiredElement<HTMLElement>('#game-selector');

let activeSeriesId: string | null = null;
let requestId = 0;
let loadingSeriesId: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const histories = new Map<string, SeriesHistoryRef>();
const liveClocks = new Map<string, number>();
const finalSnapshots = new Map<string, Promise<LiveSnapshot<LolStats> | null>>();
let historyController: AbortController | null = null;

const style = document.createElement('style');
style.textContent = `
  .analysis-header.history-summary-active {
    align-items: center;
    padding-bottom: 16px;
  }
  .analysis-header.history-summary-active .game-selector { display: none; }
  .analysis-header.history-summary-active #selected-series {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 9px;
  }
  .history-header-team {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .history-header-score {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid rgba(148, 163, 184, 0.15);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.025);
    font-variant-numeric: tabular-nums;
  }
  .history-header-score b { font-size: 1.18rem; }
  .history-header-score i { color: #526178; font-size: 0.78rem; font-style: normal; }
  #series-history.live-series-results {
    display: grid;
    gap: 13px;
    margin: 0 26px 24px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  #series-history.live-series-results .completed-game {
    appearance: none;
    width: 100%;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  #series-history.live-series-results .completed-game:hover {
    border-color: rgba(148, 163, 184, 0.28);
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.038), rgba(255, 255, 255, 0.016));
  }
  #series-history.live-series-results .completed-game:focus-visible {
    outline: 2px solid rgba(56, 189, 248, 0.58);
    outline-offset: 2px;
  }
  #series-history.live-series-results .completed-game.live,
  #series-history.live-series-results .completed-game.draft,
  #series-history.live-series-results .completed-game.paused {
    opacity: 1;
  }
  #series-history.live-series-results .completed-game.live .completed-game-state,
  #series-history.live-series-results .completed-game.draft .completed-game-state,
  #series-history.live-series-results .completed-game.paused .completed-game-state {
    border-color: rgba(56, 189, 248, 0.24);
    color: #7dd3fc;
    background: rgba(56, 189, 248, 0.06);
  }
  .live-series-message-panel {
    margin: 0 24px 18px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.014);
  }
  .live-series-message { color: var(--muted); font-size: 0.76rem; line-height: 1.5; }
  .live-series-message.warning { color: #fcd34d; }
  @media (max-width: 720px) {
    .analysis-header.history-summary-active #selected-series { gap: 7px; }
    .history-header-team { max-width: 34vw; }
    .history-header-score { min-height: 28px; padding: 0 8px; }
    .history-header-score b { font-size: 1rem; }
    #series-history.live-series-results { margin: 0 14px 18px; }
    .live-series-message-panel { margin: 0 14px 14px; padding: 12px; }
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

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function teamName(team: TeamRef | null): string {
  return team?.name ?? 'Unavailable';
}

function stateLabel(game: SeriesGameHistoryRef): string {
  switch (game.state) {
    case 'completed': return 'Final';
    case 'unstarted':
    case 'unknown': return 'Not played';
    case 'draft': return 'Draft';
    case 'live': return 'Live';
    case 'paused': return 'Paused';
  }
}

function resultLabel(game: SeriesGameHistoryRef): string {
  if (game.winner) return `${game.winner.name} won`;
  if (game.state === 'completed') return 'Winner unavailable';
  if (game.state === 'unstarted' || game.state === 'unknown') return 'Not played';
  return 'Result pending';
}

function timeLabel(game: SeriesGameHistoryRef): string {
  if (game.durationSeconds !== null) return formatClock(game.durationSeconds);
  const liveClock = liveClocks.get(game.id);
  if ((game.state === 'live' || game.state === 'paused') && liveClock !== undefined) {
    return `Elapsed ${formatClock(liveClock)}`;
  }
  return 'Duration unavailable';
}

function gameMarkup(game: SeriesGameHistoryRef): string {
  return `
    <button type="button" class="completed-game ${escapeHtml(game.state)}"
      data-history-game-id="${escapeHtml(game.id)}"
      aria-label="Open Game ${escapeHtml(game.number)} scoreboard">
      <div class="completed-game-top">
        <strong>Game ${escapeHtml(game.number)}</strong>
        <span class="completed-game-state">${escapeHtml(stateLabel(game))}</span>
      </div>
      <div class="completed-side blue"><span>BLUE</span><b>${escapeHtml(teamName(game.blueTeam))}</b></div>
      <div class="completed-side red"><span>RED</span><b>${escapeHtml(teamName(game.redTeam))}</b></div>
      <div class="completed-result"><strong>${escapeHtml(resultLabel(game))}</strong><span>${escapeHtml(timeLabel(game))}</span></div>
    </button>`;
}

function formatDescription(history: SeriesHistoryRef): string {
  return `Best of ${history.bestOf} · First to ${history.winsRequired}${history.drawPossible ? ' · Draw possible' : ''}`;
}

function seriesIsComplete(history: SeriesHistoryRef): boolean {
  return Math.max(history.score[0].wins, history.score[1].wins) >= history.winsRequired;
}

function applyHistoryHeader(history: SeriesHistoryRef): void {
  const [left, right] = history.score;
  const titleMarkup = `
    <span class="history-header-team">${escapeHtml(left.team.name)}</span>
    <span class="history-header-score"><b>${left.wins}</b><i>–</i><b>${right.wins}</b></span>
    <span class="history-header-team">${escapeHtml(right.team.name)}</span>`;
  if (selectedSeries.innerHTML !== titleMarkup) selectedSeries.innerHTML = titleMarkup;

  const completed = history.games.filter(game => game.state === 'completed').length;
  const currentState = selectedMeta.textContent?.split('·')[0]?.trim().toUpperCase() ?? '';
  const status = seriesIsComplete(history)
    ? 'FINAL'
    : currentState === 'LIVE' || currentState === 'PAUSED'
      ? currentState
      : 'IN PROGRESS';
  const meta = `${status} · ${formatDescription(history)} · ${completed}/${history.games.length} games completed`;
  if (selectedMeta.textContent !== meta) selectedMeta.textContent = meta;
  analysisHeader.classList.add('history-summary-active');
}

function bindGameNavigation(): void {
  historyPanel.querySelectorAll<HTMLButtonElement>('[data-history-game-id]').forEach(card => {
    card.addEventListener('click', () => {
      const gameId = card.dataset.historyGameId;
      if (!gameId) return;
      const target = [...gameSelector.querySelectorAll<HTMLButtonElement>('[data-game-id]')]
        .find(button => button.dataset.gameId === gameId);
      target?.click();
    });
  });
}

function renderHistory(seriesId: string): void {
  if (activeSeriesId !== seriesId) return;
  const history = histories.get(seriesId);
  if (!history) return;
  applyHistoryHeader(history);
  const completed = history.games.filter(game => game.state === 'completed').length;
  historyPanel.className = 'completed-games-panel live-series-results';
  historyPanel.hidden = false;
  historyPanel.innerHTML = `
    <div class="completed-section-heading">
      <div><span class="eyebrow">SERIES</span><h3>Game results</h3></div>
      <span>${escapeHtml(completed)} of ${escapeHtml(history.games.length)} games played</span>
    </div>
    <div class="completed-games">${history.games.map(gameMarkup).join('')}</div>`;
  bindGameNavigation();
}

function showMessage(message: string, warning = false): void {
  analysisHeader.classList.remove('history-summary-active');
  historyPanel.className = 'live-series-message-panel';
  historyPanel.hidden = false;
  historyPanel.innerHTML = `<div class="live-series-message ${warning ? 'warning' : ''}">${escapeHtml(message)}</div>`;
}

const stateRank: Record<SeriesGameHistoryRef['state'], number> = {
  unknown: 0,
  unstarted: 1,
  draft: 2,
  live: 3,
  paused: 3,
  completed: 4
};

function mergeHistory(previous: SeriesHistoryRef | undefined, incoming: SeriesHistoryRef): SeriesHistoryRef {
  if (!previous) return incoming;
  const previousById = new Map(previous.games.map(game => [game.id, game]));
  const games = incoming.games.map(game => {
    const old = previousById.get(game.id) ?? previous.games.find(item => item.number === game.number);
    if (!old) return game;
    return {
      ...game,
      state: stateRank[old.state] > stateRank[game.state] ? old.state : game.state,
      blueTeam: game.blueTeam ?? old.blueTeam,
      redTeam: game.redTeam ?? old.redTeam,
      winner: game.winner ?? old.winner,
      durationSeconds: game.durationSeconds ?? old.durationSeconds
    };
  });
  return {
    ...incoming,
    score: [
      { team: incoming.score[0].team, wins: Math.max(previous.score[0].wins, incoming.score[0].wins) },
      { team: incoming.score[1].team, wins: Math.max(previous.score[1].wins, incoming.score[1].wins) }
    ],
    games
  };
}

function storageKey(seriesId: string): string {
  return `esports-live:history:${seriesId}`;
}

function readStored(seriesId: string): StoredHistoryState | null {
  try {
    const value = localStorage.getItem(storageKey(seriesId));
    return value ? JSON.parse(value) as StoredHistoryState : null;
  } catch {
    return null;
  }
}

function writeStored(seriesId: string, value: StoredHistoryState): void {
  try {
    localStorage.setItem(storageKey(seriesId), JSON.stringify(value));
  } catch {}
}

function applyObservedWinners(seriesId: string, history: SeriesHistoryRef): SeriesHistoryRef {
  const stored = readStored(seriesId);
  const teams = history.score.map(entry => entry.team);
  const winners = { ...(stored?.winners ?? {}) };
  const completed = history.games.filter(game => game.state === 'completed').map(game => game.id);
  const previousCompleted = new Set(stored?.completed ?? []);
  const newlyCompleted = completed.filter(id => !previousCompleted.has(id));
  const leftDelta = history.score[0].wins - (stored?.score[0] ?? history.score[0].wins);
  const rightDelta = history.score[1].wins - (stored?.score[1] ?? history.score[1].wins);
  if (newlyCompleted.length === 1 && leftDelta === 1 && rightDelta === 0) winners[newlyCompleted[0]!] = teams[0]!.id;
  if (newlyCompleted.length === 1 && rightDelta === 1 && leftDelta === 0) winners[newlyCompleted[0]!] = teams[1]!.id;

  const games = history.games.map(game => {
    if (game.winner) {
      winners[game.id] = game.winner.id;
      return game;
    }
    const winnerId = winners[game.id];
    const winner = teams.find(team => team.id === winnerId) ?? null;
    return winner ? { ...game, winner } : game;
  });
  writeStored(seriesId, {
    score: [history.score[0].wins, history.score[1].wins],
    completed,
    winners
  });
  return { ...history, games };
}

function clearRefreshTimer(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function nextRefreshDelay(): number {
  return /(^|\s)(LIVE|PAUSED)(\s|$)/i.test(selectedMeta.textContent ?? '')
    ? LIVE_REFRESH_MS
    : IDLE_REFRESH_MS;
}

function scheduleRefresh(seriesId: string): void {
  clearRefreshTimer();
  if (document.hidden) return;
  refreshTimer = setTimeout(() => {
    if (activeSeriesId === seriesId) void loadHistory(seriesId);
  }, nextRefreshDelay());
}

async function snapshotFor(gameId: string): Promise<LiveSnapshot<LolStats> | null> {
  const existing = finalSnapshots.get(gameId);
  if (existing) return existing;
  const request = apiJson<LiveSnapshot<LolStats>>(
    API_BASE,
    `/v1/lol/games/${encodeURIComponent(gameId)}/live?historyFinal=${Date.now()}`
  )
    .catch(() => null);
  finalSnapshots.set(gameId, request);
  return request;
}

async function enrichDurations(seriesId: string): Promise<void> {
  const history = histories.get(seriesId);
  if (!history) return;
  let changed = false;
  const games: SeriesGameHistoryRef[] = [];
  for (const game of history.games) {
    if (game.state !== 'completed' || game.durationSeconds !== null) {
      games.push(game);
      continue;
    }
    const snapshot = await snapshotFor(game.id);
    const duration = snapshot?.stats?.gameClockSeconds ?? null;
    if (duration !== null) {
      games.push({ ...game, durationSeconds: duration });
      changed = true;
    } else {
      games.push(game);
    }
  }
  if (!changed || activeSeriesId !== seriesId) return;
  histories.set(seriesId, { ...history, games });
  renderHistory(seriesId);
}

async function loadHistory(seriesId: string): Promise<void> {
  if (loadingSeriesId === seriesId) return;
  const currentRequest = ++requestId;
  historyController?.abort();
  const controller = new AbortController();
  historyController = controller;
  loadingSeriesId = seriesId;
  if (!histories.has(seriesId)) showMessage('Loading series score and game results…');
  try {
    const body = await apiJson<SeriesContext>(
      API_BASE,
      `/v1/lol/series/${encodeURIComponent(seriesId)}/context?history=${Date.now()}`,
      { signal: controller.signal }
    );
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    const context = body;
    if (!context.history) {
      if (!histories.has(seriesId)) showMessage('Riot has not published game-history details for this series.', true);
    } else {
      const observed = applyObservedWinners(seriesId, context.history);
      histories.set(seriesId, mergeHistory(histories.get(seriesId), observed));
      renderHistory(seriesId);
      void enrichDurations(seriesId);
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    if (!histories.has(seriesId)) {
      showMessage(error instanceof Error ? error.message : 'Series history is unavailable.', true);
    }
  } finally {
    if (currentRequest === requestId && activeSeriesId === seriesId) {
      loadingSeriesId = null;
      scheduleRefresh(seriesId);
    }
  }
}

function resetHistoryPanel(): void {
  analysisHeader.classList.remove('history-summary-active');
  historyPanel.className = 'series-history';
  historyPanel.hidden = true;
  historyPanel.replaceChildren();
}

function syncSelection(seriesId: string | null): void {
  if (!seriesId) {
    activeSeriesId = null;
    requestId += 1;
    loadingSeriesId = null;
    clearRefreshTimer();
    historyController?.abort();
    historyController = null;
    resetHistoryPanel();
    return;
  }
  if (seriesId === activeSeriesId) {
    const history = histories.get(seriesId);
    if (history) {
      applyHistoryHeader(history);
      renderHistory(seriesId);
    }
    return;
  }
  activeSeriesId = seriesId;
  requestId += 1;
  loadingSeriesId = null;
  clearRefreshTimer();
  analysisHeader.classList.remove('history-summary-active');
  if (histories.has(seriesId)) renderHistory(seriesId);
  void loadHistory(seriesId);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats || snapshot.series.id !== activeSeriesId) return;
  if (snapshot.stats.gameClockSeconds !== null) {
    liveClocks.set(snapshot.game.id, snapshot.stats.gameClockSeconds);
  }
  const history = histories.get(snapshot.series.id);
  if (!history) return;
  const games = history.games.map(game => game.id === snapshot.game.id
    ? {
      ...game,
      state: snapshot.game.state,
      durationSeconds: snapshot.game.state === 'completed'
        ? snapshot.stats?.gameClockSeconds ?? game.durationSeconds
        : game.durationSeconds
    }
    : game);
  histories.set(snapshot.series.id, { ...history, games });
  renderHistory(snapshot.series.id);
});

window.addEventListener('esports-live:selection', event => {
  const selection = (event as CustomEvent<ScheduleEvent>).detail;
  syncSelection(selection.series.id);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearRefreshTimer();
    return;
  }
  if (activeSeriesId) void loadHistory(activeSeriesId);
});
window.addEventListener('beforeunload', clearRefreshTimer);
