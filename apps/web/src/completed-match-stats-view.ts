import type { LiveSnapshot, SeriesContext, SeriesGameHistoryRef } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

interface CachedValue<T> {
  expiresAt: number;
  value: T;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const CACHE_MS = 15 * 60 * 1_000;
const MAX_CONCURRENCY = 3;
type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';
const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const ROLE_LABELS: Record<CanonicalRole, string> = {
  top: 'Top', jungle: 'Jungle', mid: 'Mid', bottom: 'Bottom', support: 'Support'
};

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const resultsList = requiredElement<HTMLElement>('#completed-match-list');
const completedDetail = requiredElement<HTMLElement>('#completed-match-detail');
const contextCache = new Map<string, CachedValue<SeriesContext>>();
const snapshotCache = new Map<string, CachedValue<LiveSnapshot<LolStats>>>();
const contextRequests = new Map<string, Promise<SeriesContext>>();
const snapshotRequests = new Map<string, Promise<LiveSnapshot<LolStats>>>();
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
  .completed-final-team h4 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 0;
  }
  .completed-final-team h4 span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .completed-final-team h4 em {
    flex: 0 0 auto;
    padding: 3px 7px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 999px;
    color: var(--muted);
    font-size: 0.5rem;
    font-style: normal;
    font-weight: 850;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .completed-final-team.blue h4 em { border-color: rgba(56, 189, 248, 0.24); color: #7dd3fc; }
  .completed-final-team.red h4 em { border-color: rgba(251, 113, 133, 0.24); color: #fda4af; }
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

  /* Compact mirrored scoreboard inspired by the in-game broadcast layout. */
  .completed-final-matchups {
    overflow-x: auto;
    border: 1px solid rgba(148, 163, 184, 0.13);
    border-radius: 12px;
    background: rgba(2, 6, 23, 0.42);
    scrollbar-color: rgba(56, 189, 248, 0.36) rgba(15, 23, 42, 0.7);
    scrollbar-width: thin;
  }
  .completed-final-matchups .role-matchup-row {
    grid-template-columns: minmax(0, 1fr) 112px minmax(0, 1fr);
    min-width: 760px;
    min-height: 78px;
    border-bottom-color: rgba(148, 163, 184, 0.12);
  }
  .completed-final-matchups .role-matchup-row:nth-child(even) .role-player.blue {
    background-color: rgba(14, 165, 233, 0.025);
  }
  .completed-final-matchups .role-matchup-row:nth-child(even) .role-player.red {
    background-color: rgba(244, 63, 94, 0.025);
  }
  .completed-final-matchups .role-player,
  .completed-final-matchups .role-player.red {
    align-items: center;
    min-width: 0;
    gap: 5px 9px;
    padding: 9px 10px;
  }
  .completed-final-matchups .role-player.blue {
    grid-template-areas:
      "stats heading portrait"
      "items items portrait";
    grid-template-columns: minmax(0, 1fr) minmax(108px, auto) 46px;
    background: linear-gradient(90deg, rgba(14, 165, 233, 0.08), rgba(14, 165, 233, 0.018));
  }
  .completed-final-matchups .role-player.red {
    grid-template-areas:
      "portrait heading stats"
      "portrait items items";
    grid-template-columns: 46px minmax(108px, auto) minmax(0, 1fr);
    background: linear-gradient(270deg, rgba(244, 63, 94, 0.08), rgba(244, 63, 94, 0.018));
  }
  .completed-final-matchups .role-player-heading {
    grid-area: heading;
    gap: 7px;
    min-width: 0;
  }
  .completed-final-matchups .role-player.red .role-player-heading {
    grid-area: heading;
  }
  .completed-final-matchups .role-player-name { flex: 1 1 auto; }
  .completed-final-matchups .role-player-name strong {
    color: #f8fafc;
    font-size: 0.78rem;
    line-height: 1.15;
  }
  .completed-final-matchups .role-player-name small {
    margin-top: 2px;
    color: #90a0b5;
    font-size: 0.54rem;
  }
  .completed-final-matchups .role-chip {
    min-width: 38px;
    min-height: 19px;
    padding: 0 5px;
    font-size: 0.44rem;
  }
  .completed-final-matchups .role-player-stats,
  .completed-final-matchups .role-player.red .role-player-stats {
    grid-area: stats;
    display: grid;
    grid-template-columns: repeat(3, minmax(38px, 1fr));
    gap: 3px;
    width: 100%;
    justify-content: stretch;
    text-align: center;
  }
  .completed-final-matchups .role-player-stats > span {
    min-width: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .completed-final-matchups .role-player-stats small {
    color: #718197;
    font-size: 0.42rem;
  }
  .completed-final-matchups .role-player-stats strong {
    margin-top: 2px;
    color: #dce7f5;
    font-size: 0.66rem;
  }
  .completed-final-matchups .role-player-portrait { grid-area: portrait; }
  .completed-final-matchups .role-player-portrait .telemetry-champion {
    width: 46px;
    height: 46px;
    border: 1px solid rgba(226, 232, 240, 0.16);
    border-radius: 8px;
  }
  .completed-final-matchups .role-player.blue .role-player-portrait .telemetry-champion {
    box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.14);
  }
  .completed-final-matchups .role-player.red .role-player-portrait .telemetry-champion {
    box-shadow: 0 0 0 1px rgba(251, 113, 133, 0.14);
  }
  .completed-final-matchups .role-player-items { grid-area: items; min-width: 0; }
  .completed-final-matchups .role-player-items .telemetry-inventory {
    gap: 3px;
    min-height: 21px;
    padding: 0;
    overflow: hidden;
  }
  .completed-final-matchups .role-player.blue .telemetry-inventory { justify-content: flex-start; }
  .completed-final-matchups .role-player.red .telemetry-inventory { justify-content: flex-end; }
  .completed-final-matchups .role-player-items .telemetry-inventory-label { display: none; }
  .completed-final-matchups .role-player-items .telemetry-item-slot {
    width: 21px;
    height: 21px;
    flex-basis: 21px;
    border-radius: 4px;
  }
  .completed-final-matchups .role-gold-delta {
    gap: 4px;
    padding: 8px 7px;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(2, 6, 23, 0.72));
  }
  .completed-final-matchups .role-gold-delta small {
    color: #8d9bb0;
    font-size: 0.45rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .completed-final-matchups .role-gold-delta > strong {
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .completed-final-matchups .role-edge-track { width: 76px; height: 4px; }
  @media (max-width: 760px) {
    .completed-final-team-grid { grid-template-columns: 1fr; }
    .completed-final-player { grid-template-columns: minmax(0, 1fr) auto; }
    .completed-final-items { grid-column: 1 / -1; }
    .completed-final-game { padding: 12px; }
    .completed-telemetry-heading { align-items: flex-start; flex-direction: column; gap: 3px; }
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
  if (!value) return 'End time unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `Ended ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'End time unavailable';
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
  const pending = contextRequests.get(seriesId);
  if (pending) return pending;
  const request = api<SeriesContext>(
    `/v1/lol/series/${encodeURIComponent(seriesId)}/context?final=${Date.now()}`
  ).then(value => {
    contextCache.set(seriesId, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }).finally(() => contextRequests.delete(seriesId));
  contextRequests.set(seriesId, request);
  return request;
}

async function snapshotFor(gameId: string): Promise<LiveSnapshot<LolStats>> {
  const cached = snapshotCache.get(gameId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = snapshotRequests.get(gameId);
  if (pending) return pending;
  const request = api<LiveSnapshot<LolStats>>(
    `/v1/lol/games/${encodeURIComponent(gameId)}/live?final=${Date.now()}`
  ).then(value => {
    if (value.stats) snapshotCache.set(gameId, { value, expiresAt: Date.now() + CACHE_MS });
    return value;
  }).finally(() => snapshotRequests.delete(gameId));
  snapshotRequests.set(gameId, request);
  return request;
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
      <div class="completed-final-player" data-role="${escapeHtml(player.role ?? '')}" data-champion="${escapeHtml(player.championId ?? '')}">
        <div><strong>${escapeHtml(player.handle ?? 'Unknown player')}</strong><small>${escapeHtml(player.championId ?? 'Champion unavailable')}</small></div>
        <span>${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)} · ${formatNumber(player.creepScore)} CS</span>
        <span class="completed-final-items">${escapeHtml(items)} · ${formatNumber(player.totalGold)}g</span>
      </div>`;
  }).join('');
}

function canonicalRole(value: string | null): CanonicalRole | null {
  const normalized = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
  if (normalized.includes('top')) return 'top';
  if (normalized.includes('jung')) return 'jungle';
  if (normalized.includes('mid')) return 'mid';
  if (normalized.includes('bot') || normalized.includes('adc') || normalized.includes('carry')) return 'bottom';
  if (normalized.includes('sup') || normalized.includes('utility')) return 'support';
  return null;
}

function orderedPlayers(team: LolTeamState): readonly (LolPlayerState | null)[] {
  const assigned = new Map<CanonicalRole, LolPlayerState>();
  const unassigned: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = canonicalRole(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else unassigned.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? unassigned.shift() ?? null);
}

function playerIdentityMarkup(player: LolPlayerState | null, role: CanonicalRole, side: 'blue' | 'red'): string {
  return `
    <div class="role-player ${side}">
      <div class="role-player-heading">
        <span class="role-chip">${ROLE_LABELS[role]}</span>
        <div class="role-player-name">
          <strong>${escapeHtml(player?.handle ?? 'Player unavailable')}</strong>
          <small>${escapeHtml(player?.championId ?? 'Champion unavailable')}</small>
        </div>
      </div>
      <div class="role-player-stats">
        <span><small>KDA</small><strong>${formatNumber(player?.kills ?? null)}/${formatNumber(player?.deaths ?? null)}/${formatNumber(player?.assists ?? null)}</strong></span>
        <span><small>CS</small><strong>${formatNumber(player?.creepScore ?? null)}</strong></span>
        <span><small>GOLD</small><strong>${formatNumber(player?.totalGold ?? null)}</strong></span>
      </div>
    </div>`;
}

function roleGoldDeltaMarkup(blue: LolPlayerState | null, red: LolPlayerState | null, role: CanonicalRole): string {
  const blueGold = blue?.totalGold ?? null;
  const redGold = red?.totalGold ?? null;
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const side = difference === null ? 'unknown' : difference > 0 ? 'blue' : difference < 0 ? 'red' : 'even';
  const magnitude = difference === null ? null : Math.abs(difference);
  const edge = magnitude === null ? 0 : Math.min(50, Math.round((magnitude / 2500) * 50));
  const lead = magnitude === null
    ? 'No data'
    : magnitude === 0
      ? 'Even'
      : `${difference! > 0 ? 'Blue' : 'Red'} +${magnitude.toLocaleString()}`;
  return `
    <div class="role-gold-delta ${side}" style="--role-edge: ${edge}%">
      <small>${ROLE_LABELS[role]} gold</small>
      <strong>${lead}</strong>
      <span class="role-edge-track" aria-hidden="true"><i></i></span>
    </div>`;
}

function roleMatchupRows(blue: LolTeamState, red: LolTeamState): string {
  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  return ROLE_ORDER.map((role, index) => `
    <div class="role-matchup-row">
      ${playerIdentityMarkup(bluePlayers[index] ?? null, role, 'blue')}
      ${roleGoldDeltaMarkup(bluePlayers[index] ?? null, redPlayers[index] ?? null, role)}
      ${playerIdentityMarkup(redPlayers[index] ?? null, role, 'red')}
    </div>`).join('');
}

function teamMarkup(team: LolTeamState): string {
  const objectives = team.objectives;
  return `
    <section class="completed-final-team ${escapeHtml(team.side)}">
      <h4><span>${escapeHtml(team.name)}</span><em>${escapeHtml(team.side)} side</em></h4>
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
  const winner = history.winner?.name ? `${history.winner.name} won` : 'Winner unavailable';
  const duration = history.durationSeconds ?? stats.gameClockSeconds;
  return `
    <article class="completed-final-game" data-final-game-id="${escapeHtml(snapshot.game.id)}">
      <div class="completed-final-game-header">
        <strong>Game ${escapeHtml(history.number)} · ${escapeHtml(winner)}</strong>
        <span>${escapeHtml(formatClock(duration))} · ${escapeHtml(formatTimestamp(snapshot.quality.sourceTimestamp))}</span>
      </div>
      <div class="completed-final-team-grid">${teamMarkup(stats.blue)}${teamMarkup(stats.red)}</div>
      <div class="role-matchup-list completed-final-matchups">${roleMatchupRows(stats.blue, stats.red)}</div>
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
    <div class="completed-telemetry-heading"><h3>Final scoreboard</h3><span>Official Riot match archive</span></div>
    <div class="completed-telemetry-loading">Loading the final scoreboard…</div>`;
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
      <div class="completed-telemetry-heading"><h3>Final scoreboard</h3><span>Archived result · not live telemetry</span></div>
      ${rows.map(row => gameMarkup(row.game, row.snapshot, row.error)).join('')}`;
    const gamesById = new Map(
      [...host.querySelectorAll<HTMLElement>('[data-final-game-id]')]
        .map(game => [game.dataset.finalGameId, game] as const)
    );
    for (const row of rows) {
      if (!row.snapshot?.stats) continue;
      const root = gamesById.get(row.snapshot.game.id);
      if (!root) continue;
      window.dispatchEvent(new CustomEvent('esports-live:ended-snapshot', {
        detail: { snapshot: row.snapshot, root }
      }));
    }
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
