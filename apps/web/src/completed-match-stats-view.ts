import type { LiveSnapshot, SeriesContext, SeriesGameHistoryRef } from '@esports-live/core';
import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';

interface CachedValue<T> {
  expiresAt: number;
  value: T;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const CACHE_MS = 15 * 60 * 1_000;
const MAX_CONCURRENCY = 2;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const resultsList = requiredElement<HTMLElement>('#completed-match-list');
const completedDetail = requiredElement<HTMLElement>('#completed-match-detail');
const contextCache = new Map<string, CachedValue<SeriesContext>>();
const snapshotCache = new Map<string, CachedValue<LiveSnapshot<LolStats>>>();
let selectedSeriesId: string | null = null;
let requestGeneration = 0;

const style = document.createElement('style');
style.textContent = `
  .completed-final-telemetry {
    display: grid;
    gap: 14px;
    padding-top: 4px;
  }
  .completed-telemetry-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .completed-telemetry-heading h3 { margin: 0; font-size: 0.92rem; }
  .completed-telemetry-heading span { color: var(--muted); font-size: 0.65rem; }
  .completed-telemetry-loading,
  .completed-telemetry-empty {
    padding: 18px;
    border: 1px solid var(--border);
    border-radius: 13px;
    color: var(--muted);
    text-align: center;
  }
  .completed-final-game {
    display: grid;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 15px;
    background: rgba(255, 255, 255, 0.015);
  }
  .completed-final-game-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .completed-final-game-header span { color: var(--muted); font-size: 0.64rem; }
  .completed-final-team-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .completed-final-team {
    display: grid;
    gap: 11px;
    min-width: 0;
    padding: 14px;
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 12px;
  }
  .completed-final-team.blue { border-color: rgba(56, 189, 248, 0.2); }
  .completed-final-team.red { border-color: rgba(251, 113, 133, 0.2); }
  .completed-final-team h4 { margin: 0; overflow-wrap: anywhere; }
  .completed-final-primary,
  .completed-final-objectives {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
  }
  .completed-final-primary div,
  .completed-final-objectives div {
    padding: 8px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.025);
  }
  .completed-final-primary span,
  .completed-final-objectives span {
    display: block;
    color: var(--muted);
    font-size: 0.58rem;
    text-transform: uppercase;
  }
  .completed-final-primary strong,
  .completed-final-objectives strong { display: block; margin-top: 3px; }
  .completed-final-players { display: grid; gap: 6px; }
  .completed-final-player {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) auto auto;
    gap: 8px;
    align-items: center;
    padding-top: 7px;
    border-top: 1px solid rgba(148, 163, 184, 0.08);
    font-size: 0.65rem;
  }
  .completed-final-player div { min-width: 0; }
  .completed-final-player strong,
  .completed-final-player small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .completed-final-player small { color: var(--muted); }
  .completed-final-items { color: var(--muted); font-size: 0.58rem; }
  @media (max-width: 760px) {
    .completed-final-team-grid { grid-template-columns: 1fr; }
    .completed-final-player { grid-template-columns: minmax(0, 1fr) auto; }
    .completed-final-items { grid-column: 1 / -1; }
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

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return 'Duration unavailable';
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'Final source time unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `Final frame ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : 'Final source time unavailable';
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function contextFor(seriesId: string): Promise<SeriesContext> {
  const cached = contextCache.get(seriesId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await api<SeriesContext>(`/v1/lol/series/${encodeURIComponent(seriesId)}/context?final=${Date.now()}`);
  contextCache.set(seriesId, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

async function snapshotFor(gameId: string): Promise<LiveSnapshot<LolStats>> {
  const cached = snapshotCache.get(gameId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await api<LiveSnapshot<LolStats>>(`/v1/lol/games/${encodeURIComponent(gameId)}/live?final=${Date.now()}`);
  snapshotCache.set(gameId, { value, expiresAt: Date.now() + CACHE_MS });
  return value;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return output;
}

function playerMarkup(team: LolTeamState): string {
  if (!team.players.length) return '<div class="completed-telemetry-empty">Player data unavailable.</div>';
  return team.players.map(player => {
    const items = player.items?.length ? player.items.join(' · ') : 'Items unavailable';
    return `
      <div class="completed-final-player">
        <div><strong>${escapeHtml(player.handle ?? 'Unknown player')}</strong><small>${escapeHtml(player.championId ?? 'Champion unavailable')}</small></div>
        <span>${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)} · ${formatNumber(player.creepScore)} CS</span>
        <span class="completed-final-items">${escapeHtml(items)} · ${formatNumber(player.totalGold)}g</span>
      </div>`;
  }).join('');
}

function teamMarkup(team: LolTeamState): string {
  const objectives = team.objectives;
  return `
    <section class="completed-final-team ${escapeHtml(team.side)}">
      <h4>${escapeHtml(team.name)} · ${escapeHtml(team.side.toUpperCase())}</h4>
      <div class="completed-final-primary">
        <div><span>Gold</span><strong>${formatNumber(team.gold)}</strong></div>
        <div><span>Kills</span><strong>${formatNumber(team.kills)}</strong></div>
      </div>
      <div class="completed-final-objectives">
        <div><span>Towers</span><strong>${formatNumber(objectives.towers)}</strong></div>
        <div><span>Dragons</span><strong>${objectives.dragons === null ? '—' : objectives.dragons.length}</strong></div>
        <div><span>Barons</span><strong>${formatNumber(objectives.barons)}</strong></div>
        <div><span>Inhibitors</span><strong>${formatNumber(objectives.inhibitors)}</strong></div>
      </div>
      <div class="completed-final-players">${playerMarkup(team)}</div>
    </section>`;
}

function gameMarkup(
  history: SeriesGameHistoryRef,
  snapshot: LiveSnapshot<LolStats> | null,
  error: string | null
): string {
  if (!snapshot?.stats) {
    return `
      <article class="completed-final-game">
        <div class="completed-final-game-header"><strong>Game ${escapeHtml(history.number)}</strong><span>Final telemetry unavailable</span></div>
        <div class="completed-telemetry-empty">${escapeHtml(error ?? 'Riot returned no final gameplay frame for this game.')}</div>
      </article>`;
  }
  const stats = snapshot.stats;
  const winner = history.winner?.name ? `Winner · ${history.winner.name}` : 'Winner not published by Riot';
  const duration = history.durationSeconds ?? stats.gameClockSeconds;
  return `
    <article class="completed-final-game">
      <div class="completed-final-game-header">
        <strong>Game ${escapeHtml(history.number)} · ${escapeHtml(winner)}</strong>
        <span>${escapeHtml(formatClock(duration))} · ${escapeHtml(formatTimestamp(snapshot.quality.sourceTimestamp))}</span>
      </div>
      <div class="completed-final-team-grid">${teamMarkup(stats.blue)}${teamMarkup(stats.red)}</div>
    </article>`;
}

function telemetryHost(): HTMLElement {
  let host = completedDetail.querySelector<HTMLElement>('#completed-final-telemetry');
  if (!host) {
    host = document.createElement('section');
    host.id = 'completed-final-telemetry';
    host.className = 'completed-final-telemetry';
    completedDetail.append(host);
  }
  return host;
}

async function loadSelectedSeries(seriesId: string): Promise<void> {
  const generation = ++requestGeneration;
  const host = telemetryHost();
  host.innerHTML = `
    <div class="completed-telemetry-heading"><h3>Final game telemetry</h3><span>Riot live-feed archive</span></div>
    <div class="completed-telemetry-loading">Loading final team and player data…</div>`;
  try {
    const context = await contextFor(seriesId);
    const games = context.history?.games.filter(game => game.state === 'completed') ?? [];
    if (generation !== requestGeneration || selectedSeriesId !== seriesId) return;
    if (!games.length) {
      host.innerHTML = '<div class="completed-telemetry-empty">No completed game IDs were published for this series.</div>';
      return;
    }
    const rows = await mapWithConcurrency(games, MAX_CONCURRENCY, async game => {
      try {
        return { game, snapshot: await snapshotFor(game.id), error: null };
      } catch (error) {
        return {
          game,
          snapshot: null,
          error: error instanceof Error ? error.message : 'Unknown final-telemetry error'
        };
      }
    });
    if (generation !== requestGeneration || selectedSeriesId !== seriesId) return;
    host.innerHTML = `
      <div class="completed-telemetry-heading"><h3>Final game telemetry</h3><span>Historical frames are intentionally marked stale</span></div>
      ${rows.map(row => gameMarkup(row.game, row.snapshot, row.error)).join('')}`;
  } catch (error) {
    if (generation !== requestGeneration || selectedSeriesId !== seriesId) return;
    host.innerHTML = `<div class="completed-telemetry-empty">${escapeHtml(error instanceof Error ? error.message : 'Final telemetry unavailable')}</div>`;
  }
}

function syncSelectedSeries(): void {
  const selected = resultsList.querySelector<HTMLElement>('[data-completed-series-id].selected');
  const seriesId = selected?.dataset.completedSeriesId ?? null;
  if (!seriesId || seriesId === selectedSeriesId) return;
  selectedSeriesId = seriesId;
  void loadSelectedSeries(seriesId);
}

const observer = new MutationObserver(syncSelectedSeries);
observer.observe(resultsList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
syncSelectedSeries();

resultsList.addEventListener('click', event => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-completed-series-id]')
    : null;
  if (!target) return;
  window.setTimeout(() => completedDetail.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
});
