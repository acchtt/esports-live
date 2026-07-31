import type {
  LiveSnapshot,
  SeriesContext,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

interface StoredHistoryState {
  score: [number, number];
  completed: string[];
  winners: Record<string, string>;
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
let loadingSeriesId: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const histories = new Map<string, SeriesHistoryRef>();
const liveClocks = new Map<string, number>();
const finalSnapshots = new Map<string, Promise<LiveSnapshot<LolStats> | null>>();

const style = document.createElement('style');
style.textContent = `
  .series-history { display: grid; gap: 14px; margin: 0 24px 18px; padding: 18px; border: 1px solid var(--border); border-radius: 16px; background: rgba(255,255,255,.018); }
  .series-history[hidden] { display: none; }
  .series-history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .series-history-heading h3 { margin: 2px 0 0; font-size: .96rem; }
  .series-history-heading span, .history-game-state { color: var(--muted); font-size: .65rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
  .series-score { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 14px; padding: 14px; border: 1px solid rgba(148,163,184,.13); border-radius: 13px; background: rgba(255,255,255,.018); }
  .series-score-team { min-width: 0; }
  .series-score-team:last-child { text-align: right; }
  .series-score-team strong { display: block; overflow-wrap: anywhere; font-size: .84rem; }
  .series-score-team small { color: var(--muted); }
  .series-score-value { display: flex; align-items: center; gap: 9px; font-size: 1.55rem; font-weight: 900; }
  .series-score-value span { color: #475569; font-size: .9rem; }
  .history-games { display: grid; grid-template-columns: repeat(auto-fit,minmax(170px,1fr)); gap: 10px; }
  .history-game { display: grid; gap: 9px; min-width: 0; padding: 13px; border: 1px solid rgba(148,163,184,.13); border-radius: 12px; background: rgba(255,255,255,.016); }
  .history-game.completed { border-color: rgba(34,197,94,.2); }
  .history-game.live, .history-game.draft, .history-game.paused { border-color: rgba(56,189,248,.3); }
  .history-game-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .history-game-top strong { font-size: .8rem; }
  .history-sides { display: grid; gap: 5px; }
  .history-side { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; color: var(--muted); font-size: .7rem; }
  .history-side b { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
  .history-side.blue span { color: #7dd3fc; }
  .history-side.red span { color: #fda4af; }
  .history-result { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(148,163,184,.1); font-size: .7rem; }
  .history-result strong { overflow-wrap: anywhere; color: #bbf7d0; }
  .history-result span { color: var(--muted); white-space: nowrap; }
  .series-history-message { color: var(--muted); font-size: .76rem; line-height: 1.5; }
  .series-history-message.warning { color: #fcd34d; }
  @media (max-width:720px) { .series-history { margin:0 14px 14px; padding:14px; } .series-history-heading { display:grid; } .series-score { grid-template-columns:1fr auto 1fr; padding:12px; } .series-score-value { gap:6px; font-size:1.25rem; } .history-games { grid-template-columns:1fr; } }
`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function selectedSeriesIdentifier(): string | null {
  return scheduleList.querySelector<HTMLButtonElement>('.match-card.selected')?.dataset.seriesId ?? null;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function teamName(team: TeamRef | null): string { return team?.name ?? 'Unavailable'; }

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
  if (game.state === 'completed') return 'Winner not published';
  return 'Result pending';
}

function timeLabel(game: SeriesGameHistoryRef): string {
  if (game.durationSeconds !== null) return formatClock(game.durationSeconds);
  const live = liveClocks.get(game.id);
  if ((game.state === 'live' || game.state === 'paused') && live !== undefined) return `Elapsed ${formatClock(live)}`;
  return game.state === 'completed' ? 'Duration loading…' : 'Duration unavailable';
}

function gameMarkup(game: SeriesGameHistoryRef): string {
  return `
    <article class="history-game ${escapeHtml(game.state)}">
      <div class="history-game-top"><strong>Game ${escapeHtml(game.number)}</strong><span class="history-game-state">${escapeHtml(stateLabel(game))}</span></div>
      <div class="history-sides">
        <div class="history-side blue"><span>BLUE</span><b>${escapeHtml(teamName(game.blueTeam))}</b></div>
        <div class="history-side red"><span>RED</span><b>${escapeHtml(teamName(game.redTeam))}</b></div>
      </div>
      <div class="history-result"><strong>${escapeHtml(resultLabel(game))}</strong><span>${escapeHtml(timeLabel(game))}</span></div>
    </article>`;
}

function formatDescription(history: SeriesHistoryRef): string {
  return `Best of ${history.bestOf} · First to ${history.winsRequired}${history.drawPossible ? ' · Draw possible' : ''}`;
}

function historyMarkup(history: SeriesHistoryRef): string {
  const [left, right] = history.score;
  return `
    <div class="series-history-heading"><div><span>Series game history</span><h3>${escapeHtml(formatDescription(history))}</h3></div><span>${history.games.filter(game => game.state === 'completed').length} completed</span></div>
    <div class="series-score">
      <div class="series-score-team"><strong>${escapeHtml(left.team.name)}</strong><small>${escapeHtml(left.team.code ?? '')}</small></div>
      <div class="series-score-value"><b>${left.wins}</b><span>–</span><b>${right.wins}</b></div>
      <div class="series-score-team"><strong>${escapeHtml(right.team.name)}</strong><small>${escapeHtml(right.team.code ?? '')}</small></div>
    </div>
    <div class="history-games">${history.games.map(gameMarkup).join('')}</div>`;
}

function showMessage(message: string, warning = false): void {
  historyPanel.hidden = false;
  historyPanel.innerHTML = `<div class="series-history-message ${warning ? 'warning' : ''}">${escapeHtml(message)}</div>`;
}

function renderHistory(seriesId: string): void {
  if (activeSeriesId !== seriesId) return;
  const history = histories.get(seriesId);
  if (!history) return;
  historyPanel.hidden = false;
  historyPanel.innerHTML = historyMarkup(history);
}

const stateRank: Record<SeriesGameHistoryRef['state'], number> = {
  unknown: 0, unstarted: 1, draft: 2, live: 3, paused: 3, completed: 4
};

function mergeHistory(previous: SeriesHistoryRef | undefined, incoming: SeriesHistoryRef): SeriesHistoryRef {
  if (!previous) return incoming;
  const byId = new Map(previous.games.map(game => [game.id, game]));
  const games = incoming.games.map(game => {
    const old = byId.get(game.id) ?? previous.games.find(item => item.number === game.number);
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

function storageKey(seriesId: string): string { return `esports-live:history:${seriesId}`; }

function readStored(seriesId: string): StoredHistoryState | null {
  try {
    const value = localStorage.getItem(storageKey(seriesId));
    return value ? JSON.parse(value) as StoredHistoryState : null;
  } catch { return null; }
}

function writeStored(seriesId: string, value: StoredHistoryState): void {
  try { localStorage.setItem(storageKey(seriesId), JSON.stringify(value)); } catch {}
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

function clearTimer(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function nextRefreshDelay(): number {
  return /(^|\s)(LIVE|PAUSED)(\s|$)/i.test(selectedMeta.textContent ?? '') ? LIVE_REFRESH_MS : IDLE_REFRESH_MS;
}

function scheduleRefresh(seriesId: string): void {
  clearTimer();
  refreshTimer = setTimeout(() => {
    if (activeSeriesId === seriesId) void loadHistory(seriesId);
  }, nextRefreshDelay());
}

async function snapshotFor(gameId: string): Promise<LiveSnapshot<LolStats> | null> {
  const existing = finalSnapshots.get(gameId);
  if (existing) return existing;
  const request = fetch(`${API_BASE}/v1/lol/games/${encodeURIComponent(gameId)}/live?historyFinal=${Date.now()}`, { cache: 'no-store' })
    .then(async response => response.ok ? await response.json() as LiveSnapshot<LolStats> : null)
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
  if (!changed) return;
  histories.set(seriesId, { ...history, games });
  renderHistory(seriesId);
}

async function loadHistory(seriesId: string): Promise<void> {
  if (loadingSeriesId === seriesId) return;
  const currentRequest = ++requestId;
  loadingSeriesId = seriesId;
  if (!histories.has(seriesId)) showMessage('Loading series score and game results…');
  try {
    const response = await fetch(`${API_BASE}/v1/lol/series/${encodeURIComponent(seriesId)}/context?history=${Date.now()}`, { cache: 'no-store' });
    const body = await response.json().catch(() => null) as SeriesContext | { message?: string } | null;
    if (!response.ok) throw new Error(body && 'message' in body ? body.message ?? `History API returned ${response.status}.` : `History API returned ${response.status}.`);
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    const context = body as SeriesContext;
    if (!context.history) {
      if (!histories.has(seriesId)) showMessage('Riot has not published game-history details for this series.', true);
    } else {
      const observed = applyObservedWinners(seriesId, context.history);
      histories.set(seriesId, mergeHistory(histories.get(seriesId), observed));
      renderHistory(seriesId);
      void enrichDurations(seriesId);
    }
  } catch (error) {
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    if (!histories.has(seriesId)) showMessage(error instanceof Error ? error.message : 'Series history is unavailable.', true);
  } finally {
    if (currentRequest === requestId && activeSeriesId === seriesId) {
      loadingSeriesId = null;
      scheduleRefresh(seriesId);
    }
  }
}

function syncSelection(): void {
  const seriesId = selectedSeriesIdentifier();
  const title = selectedSeries.textContent?.trim() ?? '';
  if (!seriesId || !title.includes(' vs ')) {
    activeSeriesId = null;
    requestId += 1;
    loadingSeriesId = null;
    clearTimer();
    historyPanel.hidden = true;
    historyPanel.replaceChildren();
    return;
  }
  if (seriesId === activeSeriesId) return;
  activeSeriesId = seriesId;
  requestId += 1;
  loadingSeriesId = null;
  clearTimer();
  if (histories.has(seriesId)) renderHistory(seriesId);
  void loadHistory(seriesId);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats || snapshot.series.id !== activeSeriesId) return;
  if (snapshot.stats.gameClockSeconds !== null) liveClocks.set(snapshot.game.id, snapshot.stats.gameClockSeconds);
  const history = histories.get(snapshot.series.id);
  if (!history) return;
  const games = history.games.map(game => game.id === snapshot.game.id
    ? { ...game, state: snapshot.game.state, durationSeconds: snapshot.game.state === 'completed' ? snapshot.stats?.gameClockSeconds ?? game.durationSeconds : game.durationSeconds }
    : game);
  histories.set(snapshot.series.id, { ...history, games });
  renderHistory(snapshot.series.id);
});

const observer = new MutationObserver(() => queueMicrotask(syncSelection));
observer.observe(selectedSeries, { childList: true, characterData: true, subtree: true });
observer.observe(selectedMeta, { childList: true, characterData: true, subtree: true });
observer.observe(scheduleList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
syncSelection();
