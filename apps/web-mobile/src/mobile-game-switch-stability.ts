import type { LiveSnapshot, ScheduleEvent, SeriesGameRef } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { applyMobileScoreboard } from './mobile-scoreboard-renderer.ts';

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameSelector = document.querySelector<HTMLElement>('#game-selector');
const gameContent = document.querySelector<HTMLElement>('#game-content');

const snapshots = new Map<string, LiveSnapshot<LolStats>>();
let selection: ScheduleEvent | null = null;
let renderQueued = false;
let rendering = false;

function liveModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext !== 'history';
}

function buttonFor(gameId: string): HTMLButtonElement | null {
  return gameSelector?.querySelector<HTMLButtonElement>(
    `[data-game-id="${CSS.escape(gameId)}"]`
  ) ?? null;
}

function activeGameId(): string | null {
  return gameSelector?.querySelector<HTMLButtonElement>('[data-game-id].active')?.dataset.gameId ?? null;
}

function intendedGameId(): string | null {
  const pinned = document.documentElement.dataset.mobilePinnedGameId ?? null;
  if (pinned && buttonFor(pinned)) return pinned;

  const active = activeGameId();
  if (active) return active;

  const games = selection?.series.games ?? [];
  return games.find(game => game.state === 'live')?.id
    ?? games.find(game => game.state === 'draft' || game.state === 'paused')?.id
    ?? games.find(game => game.state === 'unstarted' || game.state === 'unknown')?.id
    ?? games[0]?.id
    ?? null;
}

function selectedGame(gameId: string): SeriesGameRef | null {
  return selection?.series.games.find(game => game.id === gameId) ?? null;
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function gameLabel(game: SeriesGameRef | null, snapshot: LiveSnapshot<LolStats> | null): string {
  const state = game?.state ?? snapshot?.game.state ?? 'unknown';
  if (state === 'completed') return 'Final';
  if (state === 'live' || state === 'draft' || state === 'paused') return 'Live';
  return 'Telemetry pending';
}

function renderKey(
  gameId: string,
  game: SeriesGameRef | null,
  snapshot: LiveSnapshot<LolStats> | null
): string {
  return JSON.stringify({
    gameId,
    state: game?.state ?? snapshot?.game.state ?? 'unknown',
    source: snapshot?.quality.sourceTimestamp ?? snapshot?.quality.observedAt ?? null,
    stats: Boolean(snapshot?.stats),
    teams: selection?.series.teams.map(team => [team.id, team.name]) ?? []
  });
}

function boardMarkup(
  gameId: string,
  game: SeriesGameRef | null,
  snapshot: LiveSnapshot<LolStats> | null
): string {
  const [blue, red] = selection?.series.teams ?? snapshot?.series.teams ?? [];
  const number = game?.number ?? snapshot?.game.number ?? 1;
  const clock = snapshot?.stats?.gameClockSeconds ?? null;
  const state = snapshot?.stats ? 'verified' : 'pending';
  const notice = snapshot?.stats
    ? ''
    : '<div class="mobile-live-board-notice" role="status">Loading the selected game. Older game responses will not replace this board.</div>';

  return `<article
    class="completed-final-game mobile-final-recovery mobile-live-history-board"
    data-final-game-id="${escapeHtml(gameId)}"
    data-live-dashboard-game-id="${escapeHtml(gameId)}"
    data-live-history-game-id="${escapeHtml(gameId)}"
    data-mobile-unified-game-id="${escapeHtml(gameId)}"
    data-mobile-scoreboard-version="0.17"
    data-mobile-history-copy="true"
    data-live-board-state="${state}"
    data-mobile-game-switch-owner="active-selector-v27">
    <div class="completed-final-game-header">
      <span class="mobile-scoreboard-game-clock">${formatClock(clock)}</span>
      <span class="mobile-scoreboard-game-label">Game ${number} · ${gameLabel(game, snapshot)}</span>
    </div>
    <section class="completed-team-comparison">
      <div class="completed-comparison-team blue"><strong>${escapeHtml(blue?.name ?? snapshot?.stats?.blue.name ?? 'Blue team')}</strong></div>
      <div class="completed-comparison-team red"><strong>${escapeHtml(red?.name ?? snapshot?.stats?.red.name ?? 'Red team')}</strong></div>
    </section>
    ${notice}
  </article>`;
}

function renderSelectedBoard(): void {
  renderQueued = false;
  if (!gameContent || !liveModeActive()) return;

  const gameId = intendedGameId();
  if (!gameId) return;
  const game = selectedGame(gameId);
  const cached = snapshots.get(gameId) ?? null;
  const snapshot = cached && (!selection || cached.series.id === selection.series.id) ? cached : null;
  const key = renderKey(gameId, game, snapshot);
  const current = gameContent.querySelector<HTMLElement>(
    '.mobile-live-history-board[data-mobile-history-copy="true"]'
  );
  if (
    current?.dataset.mobileGameSwitchKey === key
    && current.dataset.mobileUnifiedGameId === gameId
  ) return;

  const host = document.createElement('div');
  host.innerHTML = boardMarkup(gameId, game, snapshot);
  const board = host.firstElementChild;
  if (!(board instanceof HTMLElement)) return;

  rendering = true;
  try {
    applyMobileScoreboard(board, snapshot, { mode: 'live' });
    board.dataset.mobileGameSwitchKey = key;
    gameContent.replaceChildren(board);
  } finally {
    rendering = false;
  }
}

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(renderSelectedBoard);
}

window.addEventListener('esports-live:selection', event => {
  selection = (event as CustomEvent<ScheduleEvent>).detail;
  queueRender();
});

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (snapshot?.game?.id) snapshots.set(snapshot.game.id, snapshot);
  queueRender();
});

if (gameSelector) {
  new MutationObserver(queueRender).observe(gameSelector, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
}

if (gameContent) {
  new MutationObserver(() => {
    if (!rendering) queueRender();
  }).observe(gameContent, { childList: true, subtree: true });
}

new MutationObserver(queueRender).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-mobile-pinned-game-id']
});
new MutationObserver(queueRender).observe(body, {
  attributes: true,
  attributeFilter: ['data-mobile-view', 'data-mobile-context']
});

window.addEventListener('pageshow', queueRender);
if (typeof media.addEventListener === 'function') media.addEventListener('change', queueRender);
else if (typeof media.addListener === 'function') media.addListener(queueRender);

document.documentElement.dataset.mobileGameSwitchOwner = 'active-selector-v27';
queueRender();

export {};
