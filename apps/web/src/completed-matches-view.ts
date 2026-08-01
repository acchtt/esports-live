import type {
  ScheduleEvent,
  SeriesContext,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';

interface ScheduleResponse {
  esport: string;
  events: ScheduleEvent[];
}

interface CompletedMatch {
  event: ScheduleEvent;
  context: SeriesContext;
  history: SeriesHistoryRef;
}

interface CachedContext {
  expiresAt: number;
  value: SeriesContext;
}

interface StoredHistoryState {
  score: [number, number];
  completed: string[];
  winners: Record<string, string>;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const RESULTS_REFRESH_MS = 2 * 60 * 1_000;
const CONTEXT_CACHE_MS = 5 * 60 * 1_000;
const RESULT_LIMIT = 12;
const CANDIDATE_LIMIT = 16;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_CONTEXT_CONCURRENCY = 4;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const schedulePanel = requiredElement<HTMLElement>('.schedule-panel');
const sportTabs = requiredElement<HTMLElement>('.sport-tabs');
const activeList = requiredElement<HTMLElement>('#schedule-list');
const analysisPanel = requiredElement<HTMLElement>('.analysis-panel');
const analysisHeader = requiredElement<HTMLElement>('.analysis-header');
const seriesHistory = requiredElement<HTMLElement>('#series-history');
const qualityBanner = requiredElement<HTMLElement>('#quality-banner');
const gameContent = requiredElement<HTMLElement>('#game-content');

const modeTabs = document.createElement('div');
modeTabs.className = 'schedule-mode-tabs';
modeTabs.innerHTML = `
  <button type="button" class="schedule-mode active" data-mode="active">Active</button>
  <button type="button" class="schedule-mode" data-mode="results">Results</button>`;
sportTabs.insertAdjacentElement('afterend', modeTabs);

const resultsList = document.createElement('div');
resultsList.id = 'completed-match-list';
resultsList.className = 'schedule-list completed-match-list';
resultsList.hidden = true;
schedulePanel.append(resultsList);

const completedDetail = document.createElement('section');
completedDetail.id = 'completed-match-detail';
completedDetail.className = 'completed-match-detail';
completedDetail.hidden = true;
analysisPanel.append(completedDetail);

const style = document.createElement('style');
style.textContent = `
  .schedule-mode-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    padding: 10px 12px 0;
  }
  .schedule-mode {
    min-height: 34px;
    border: 1px solid var(--border);
    border-radius: 9px;
    color: #7f8ca3;
    background: rgba(255, 255, 255, 0.018);
    cursor: pointer;
    font-size: 0.7rem;
    font-weight: 850;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .schedule-mode.active {
    border-color: rgba(56, 189, 248, 0.35);
    color: #d8f4ff;
    background: rgba(56, 189, 248, 0.08);
  }
  .completed-match-list { padding-top: 10px; }
  .completed-card-score {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
  }
  .completed-card-score b { font-size: 1rem; }
  .completed-card-score span { color: var(--muted); font-size: 0.65rem; }
  .completed-match-detail {
    display: grid;
    gap: 20px;
    min-height: calc(100vh - 120px);
    padding: 26px;
  }
  .completed-match-detail[hidden] { display: none; }
  .completed-series-hero {
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.17);
    border-radius: 18px;
    background:
      linear-gradient(110deg, rgba(14, 165, 233, 0.07), transparent 42%),
      linear-gradient(250deg, rgba(244, 63, 94, 0.06), transparent 42%),
      rgba(255, 255, 255, 0.016);
  }
  .completed-detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 20px 22px 17px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }
  .completed-detail-header h2 { margin-top: 6px; font-size: 1.12rem; }
  .completed-detail-header p { margin: 8px 0 0; color: #9aa8bc; font-size: 0.8rem; }
  .completed-final-badge {
    flex: 0 0 auto;
    padding: 7px 10px;
    border: 1px solid rgba(52, 211, 153, 0.25);
    border-radius: 999px;
    color: #6ee7b7;
    background: rgba(52, 211, 153, 0.055);
    font-size: 0.62rem;
    font-weight: 900;
    letter-spacing: 0.09em;
  }
  .completed-scoreboard {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 22px;
    padding: 22px;
    border: 0;
    border-radius: 0;
    background: rgba(2, 6, 23, 0.18);
  }
  .completed-score-team { min-width: 0; }
  .completed-score-team:last-child { text-align: right; }
  .completed-score-team strong { display: block; overflow-wrap: anywhere; font-size: 1.05rem; }
  .completed-score-team small { display: block; margin-top: 5px; color: #91a0b5; font-size: 0.72rem; }
  .completed-score-team.winner strong { color: #f8fafc; }
  .completed-score-team.winner small { color: #86efac; }
  .completed-score-value { display: flex; align-items: center; gap: 11px; font-size: 2.25rem; font-weight: 950; }
  .completed-score-value span { color: #475569; font-size: 1rem; }
  .completed-games-panel {
    display: grid;
    gap: 13px;
  }
  .completed-section-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 16px;
  }
  .completed-section-heading h3 { margin-top: 4px; font-size: 1rem; }
  .completed-section-heading > span { color: #91a0b5; font-size: 0.72rem; }
  .completed-games {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 13px;
  }
  .completed-game {
    display: grid;
    gap: 12px;
    min-height: 154px;
    padding: 17px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 14px;
    background: linear-gradient(145deg, rgba(255, 255, 255, 0.026), rgba(255, 255, 255, 0.01));
  }
  .completed-game.completed { border-color: rgba(52, 211, 153, 0.16); }
  .completed-game.unstarted,
  .completed-game.unknown { opacity: 0.72; }
  .completed-game-state {
    padding: 3px 7px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 999px;
    color: #a7b4c6;
    background: rgba(148, 163, 184, 0.055);
    font-size: 0.58rem;
    font-weight: 850;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .completed-game-top,
  .completed-side,
  .completed-result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .completed-side span,
  .completed-result span { color: var(--muted); font-size: 0.7rem; }
  .completed-game-top strong { font-size: 0.92rem; }
  .completed-side b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; }
  .completed-side.blue span { color: #7dd3fc; }
  .completed-side.red span { color: #fda4af; }
  .completed-result { margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(148, 163, 184, 0.1); }
  .completed-result strong { color: #bbf7d0; font-size: 0.76rem; }
  .completed-empty {
    display: grid;
    place-items: center;
    min-height: 420px;
    padding: 40px;
    color: var(--muted);
    text-align: center;
  }
  @media (max-width: 720px) {
    .completed-match-detail { padding: 14px; }
    .completed-detail-header { display: grid; padding: 17px; }
    .completed-scoreboard { grid-template-columns: 1fr auto 1fr; padding: 14px; }
    .completed-score-value { font-size: 1.55rem; }
    .completed-games { grid-template-columns: 1fr; }
    .completed-section-heading { align-items: flex-start; flex-direction: column; gap: 4px; }
  }
`;
document.head.append(style);

let mode: 'active' | 'results' = 'active';
let completedMatches: CompletedMatch[] = [];
let selectedSeriesId: string | null = null;
let loadPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastCompletedLoadAt = 0;
const contextCache = new Map<string, CachedContext>();

function storedHistoryKey(seriesId: string): string {
  return `esports-live:history:${seriesId}`;
}

function applyStoredWinners(seriesId: string, history: SeriesHistoryRef): SeriesHistoryRef {
  let stored: StoredHistoryState | null = null;
  try {
    const value = localStorage.getItem(storedHistoryKey(seriesId));
    stored = value ? JSON.parse(value) as StoredHistoryState : null;
  } catch {}

  const teams = history.score.map(entry => entry.team);
  const winners = { ...(stored?.winners ?? {}) };
  const games = history.games.map(game => {
    if (game.winner) {
      winners[game.id] = game.winner.id;
      return game;
    }
    const winnerId = winners[game.id];
    const winner = teams.find(team => team.id === winnerId) ?? null;
    return winner ? { ...game, winner } : game;
  });
  try {
    localStorage.setItem(storedHistoryKey(seriesId), JSON.stringify({
      score: [history.score[0].wins, history.score[1].wins],
      completed: games.filter(game => game.state === 'completed').map(game => game.id),
      winners
    } satisfies StoredHistoryState));
  } catch {}
  return { ...history, games };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    : 'Date unavailable';
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

function isEnded(event: ScheduleEvent, history: SeriesHistoryRef): boolean {
  if (event.series.state === 'completed') return true;
  const completedGames = history.games.filter(game => game.state === 'completed').length;
  const leadingWins = Math.max(...history.score.map(row => row.wins));
  if (leadingWins >= history.winsRequired) return true;
  return history.drawPossible && completedGames >= history.bestOf;
}

async function contextFor(seriesId: string): Promise<SeriesContext> {
  const cached = contextCache.get(seriesId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await api<SeriesContext>(
    `/v1/lol/series/${encodeURIComponent(seriesId)}/context?completed=${Date.now()}`
  );
  contextCache.set(seriesId, { value, expiresAt: Date.now() + CONTEXT_CACHE_MS });
  return value;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function candidateEvents(events: readonly ScheduleEvent[]): ScheduleEvent[] {
  const now = Date.now();
  return [...events]
    .filter(event => {
      const start = Date.parse(event.series.scheduledStart);
      return Number.isFinite(start) && start <= now && start >= now - LOOKBACK_MS;
    })
    .sort((left, right) => (
      Number(right.series.state === 'completed') - Number(left.series.state === 'completed')
      || Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart)
    ))
    .slice(0, CANDIDATE_LIMIT);
}

function cardMarkup(match: CompletedMatch): string {
  const [left, right] = match.history.score;
  const selected = selectedSeriesId === match.event.series.id;
  return `
    <button class="match-card completed-result-card ${selected ? 'selected' : ''}"
      type="button" data-completed-series-id="${escapeHtml(match.event.series.id)}">
      <div class="match-card-top">
        <span>${escapeHtml(match.event.series.competition.name)}</span>
        <span class="match-state completed">FINAL</span>
      </div>
      <strong>${escapeHtml(left.team.name)} <span>vs</span> ${escapeHtml(right.team.name)}</strong>
      <div class="completed-card-score">
        <b>${escapeHtml(left.wins)}–${escapeHtml(right.wins)}</b>
        <span>BO${escapeHtml(match.history.bestOf)} · ${escapeHtml(formatDate(match.event.series.scheduledStart))}</span>
      </div>
    </button>`;
}

function renderList(): void {
  if (!completedMatches.length) {
    resultsList.innerHTML = `
      <div class="empty-state">
        <strong>No recent results found</strong>
        <span>Completed series will appear after Riot publishes final game details.</span>
      </div>`;
    return;
  }
  resultsList.innerHTML = completedMatches.map(cardMarkup).join('');
  resultsList.querySelectorAll<HTMLButtonElement>('[data-completed-series-id]').forEach(button => {
    button.addEventListener('click', () => selectCompleted(button.dataset.completedSeriesId ?? ''));
  });
}

function gameMarkup(game: SeriesGameHistoryRef): string {
  const result = game.winner
    ? `${game.winner.name} won`
    : game.state === 'completed' ? 'Winner unavailable' : 'Not played';
  const state = game.state === 'completed' ? 'Final' : game.state === 'unstarted' || game.state === 'unknown' ? 'Not played' : game.state;
  return `
    <article class="completed-game ${escapeHtml(game.state)}">
      <div class="completed-game-top">
        <strong>Game ${escapeHtml(game.number)}</strong>
        <span class="completed-game-state">${escapeHtml(state)}</span>
      </div>
      <div class="completed-side blue"><span>BLUE</span><b>${escapeHtml(teamName(game.blueTeam))}</b></div>
      <div class="completed-side red"><span>RED</span><b>${escapeHtml(teamName(game.redTeam))}</b></div>
      <div class="completed-result"><strong>${escapeHtml(result)}</strong><span>${escapeHtml(formatDuration(game.durationSeconds))}</span></div>
    </article>`;
}

function renderDetail(match: CompletedMatch): void {
  const [left, right] = match.history.score;
  const playedGames = match.history.games.filter(game => game.state === 'completed').length;
  const leftWinner = left.wins > right.wins;
  const rightWinner = right.wins > left.wins;
  completedDetail.innerHTML = `
    <section class="completed-series-hero">
      <div class="completed-detail-header">
        <div>
          <span class="eyebrow">${escapeHtml(match.event.series.competition.name)}</span>
          <h2>Final series result</h2>
          <p>${escapeHtml(formatDate(match.event.series.scheduledStart))} · Best of ${escapeHtml(match.history.bestOf)} · ${escapeHtml(match.event.series.competition.stage ?? 'Stage unavailable')}</p>
        </div>
        <span class="completed-final-badge">FINAL</span>
      </div>
      <div class="completed-scoreboard">
        <div class="completed-score-team ${leftWinner ? 'winner' : ''}"><strong>${escapeHtml(left.team.name)}</strong><small>${leftWinner ? 'Series winner' : escapeHtml(left.team.code ?? '')}</small></div>
        <div class="completed-score-value"><b>${escapeHtml(left.wins)}</b><span>–</span><b>${escapeHtml(right.wins)}</b></div>
        <div class="completed-score-team ${rightWinner ? 'winner' : ''}"><strong>${escapeHtml(right.team.name)}</strong><small>${rightWinner ? 'Series winner' : escapeHtml(right.team.code ?? '')}</small></div>
      </div>
    </section>
    <section class="completed-games-panel">
      <div class="completed-section-heading">
        <div><span class="eyebrow">SERIES</span><h3>Game results</h3></div>
        <span>${escapeHtml(playedGames)} of ${escapeHtml(match.history.games.length)} games played</span>
      </div>
      <div class="completed-games">${match.history.games.map(gameMarkup).join('')}</div>
    </section>`;
}

function selectCompleted(seriesId: string): void {
  const match = completedMatches.find(item => item.event.series.id === seriesId);
  if (!match) return;
  selectedSeriesId = seriesId;
  renderList();
  renderDetail(match);
}

function setMode(nextMode: 'active' | 'results'): void {
  mode = nextMode;
  modeTabs.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });

  const resultsMode = mode === 'results';
  activeList.hidden = resultsMode;
  resultsList.hidden = !resultsMode;
  analysisHeader.hidden = resultsMode;
  seriesHistory.hidden = resultsMode;
  qualityBanner.hidden = resultsMode;
  gameContent.hidden = resultsMode;
  completedDetail.hidden = !resultsMode;

  if (resultsMode) {
    if (!completedMatches.length) {
      completedDetail.innerHTML = '<div class="completed-empty">Select a completed match to view its game history.</div>';
    }
    void loadCompletedMatches();
  }
}

async function loadCompletedMatches(): Promise<void> {
  if (loadPromise) return loadPromise;
  if (completedMatches.length && Date.now() - lastCompletedLoadAt < RESULTS_REFRESH_MS) {
    renderList();
    const selected = completedMatches.find(match => match.event.series.id === selectedSeriesId);
    if (selected) renderDetail(selected);
    return;
  }
  loadPromise = (async () => {
    resultsList.innerHTML = '<div class="empty-state"><strong>Loading recent results</strong><span>Confirming final series scores and game states…</span></div>';
    try {
      const schedule = await api<ScheduleResponse>('/v1/lol/schedule?limit=80');
      const candidates = candidateEvents(schedule.events);
      completedMatches = [];
      let initialSelectionMade = false;
      const resolved = await mapWithConcurrency(candidates, MAX_CONTEXT_CONCURRENCY, async event => {
        try {
          const context = await contextFor(event.series.id);
          const history = context.history
            ? applyStoredWinners(event.series.id, context.history)
            : null;
          const match: CompletedMatch | null = history && isEnded(event, history)
            ? { event, context, history }
            : null;
          if (match) {
            completedMatches = [...completedMatches, match]
              .sort((left, right) => (
                Date.parse(right.event.series.scheduledStart) - Date.parse(left.event.series.scheduledStart)
              ))
              .slice(0, RESULT_LIMIT);
            renderList();
            if (!selectedSeriesId && !initialSelectionMade && completedMatches[0]) {
              initialSelectionMade = true;
              selectCompleted(completedMatches[0].event.series.id);
            }
          }
          return match;
        } catch {
          return null;
        }
      });
      completedMatches = resolved
        .filter((match): match is CompletedMatch => match !== null)
        .sort((left, right) => (
          Date.parse(right.event.series.scheduledStart) - Date.parse(left.event.series.scheduledStart)
        ))
        .slice(0, RESULT_LIMIT);
      if (selectedSeriesId && !completedMatches.some(match => match.event.series.id === selectedSeriesId)) {
        selectedSeriesId = null;
      }
      lastCompletedLoadAt = Date.now();
      renderList();
      if (!selectedSeriesId && completedMatches[0]) selectCompleted(completedMatches[0].event.series.id);
    } catch (error) {
      resultsList.innerHTML = `
        <div class="empty-state">
          <strong>Results unavailable</strong>
          <span>${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</span>
        </div>`;
    } finally {
      loadPromise = null;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (mode === 'results') void loadCompletedMatches();
      }, RESULTS_REFRESH_MS);
    }
  })();
  return loadPromise;
}

modeTabs.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
  button.addEventListener('click', () => setMode(button.dataset.mode === 'results' ? 'results' : 'active'));
});

window.addEventListener('beforeunload', () => {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
});
