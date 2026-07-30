import type { LiveSnapshot, ScheduleEvent, SeriesGameRef } from '@esports-live/core';
import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';
import './styles.css';

interface HealthResponse {
  ok: boolean;
  service: string;
  schemaVersion: string;
  adapters: string[];
}

interface ScheduleResponse {
  esport: string;
  events: ScheduleEvent[];
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const SNAPSHOT_POLL_MS = 3_000;
const SCHEDULE_POLL_MS = 15_000;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const statusHeading = requiredElement<HTMLElement>('#platform-status');
const connectionDetail = requiredElement<HTMLElement>('#connection-detail');
const statusBadge = requiredElement<HTMLElement>('#status-badge');
const statusDot = requiredElement<HTMLElement>('#status-dot');
const refreshButton = requiredElement<HTMLButtonElement>('#refresh-schedule');
const scheduleList = requiredElement<HTMLElement>('#schedule-list');
const selectedCompetition = requiredElement<HTMLElement>('#selected-competition');
const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const gameSelector = requiredElement<HTMLElement>('#game-selector');
const qualityBanner = requiredElement<HTMLElement>('#quality-banner');
const gameContent = requiredElement<HTMLElement>('#game-content');
const adapterList = requiredElement<HTMLElement>('#adapter-list');

let events: ScheduleEvent[] = [];
let selectedSeriesId: string | null = null;
let selectedGameId: string | null = null;
let lastSourceTimestamp: string | null = null;
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;

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

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Time unavailable';
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function currentEvent(): ScheduleEvent | null {
  return events.find(event => event.series.id === selectedSeriesId) ?? null;
}

function bestGame(event: ScheduleEvent): SeriesGameRef | null {
  return event.series.games.find(game => game.state === 'live')
    ?? event.series.games.find(game => game.state === 'draft')
    ?? (event.series.state === 'live'
      ? event.series.games.find(game => game.state === 'unstarted' || game.state === 'unknown') ?? null
      : null);
}

function selectedGame(event: ScheduleEvent): SeriesGameRef | null {
  return event.series.games.find(game => game.id === selectedGameId) ?? null;
}

function stateLabel(event: ScheduleEvent): string {
  switch (event.series.state) {
    case 'live': return 'LIVE';
    case 'paused': return 'PAUSED';
    case 'scheduled': return formatTime(event.series.scheduledStart);
    default: return event.series.state.toUpperCase();
  }
}

function renderAdapters(enabled: readonly string[]): void {
  const definitions = [
    ['lol', 'League of Legends'],
    ['cs2', 'Counter-Strike 2'],
    ['dota2', 'Dota 2']
  ] as const;
  adapterList.innerHTML = definitions.map(([id, name]) => {
    const active = enabled.includes(id);
    return `
      <div class="adapter-row ${active ? 'enabled' : ''}">
        <span class="adapter-dot"></span>
        <div><strong>${escapeHtml(name)}</strong><small>${active ? 'Adapter enabled' : 'Planned'}</small></div>
      </div>`;
  }).join('');
}

function renderSchedule(): void {
  if (!events.length) {
    scheduleList.innerHTML = '<div class="empty-state"><strong>No active matches</strong><span>The schedule will refresh automatically.</span></div>';
    return;
  }

  scheduleList.innerHTML = events.map(event => {
    const [left, right] = event.series.teams;
    const selected = event.series.id === selectedSeriesId;
    return `
      <button class="match-card ${selected ? 'selected' : ''}" data-series-id="${escapeHtml(event.series.id)}" type="button">
        <div class="match-card-top">
          <span>${escapeHtml(event.series.competition.name)}</span>
          <span class="match-state ${event.series.state}">${escapeHtml(stateLabel(event))}</span>
        </div>
        <strong>${escapeHtml(left.name)} <span>vs</span> ${escapeHtml(right.name)}</strong>
        <small>${escapeHtml(event.series.competition.stage ?? `Best of ${event.series.bestOf}`)}</small>
      </button>`;
  }).join('');

  scheduleList.querySelectorAll<HTMLButtonElement>('[data-series-id]').forEach(button => {
    button.addEventListener('click', () => selectSeries(button.dataset.seriesId ?? ''));
  });
}

function renderGameSelector(event: ScheduleEvent): void {
  gameSelector.innerHTML = event.series.games.map(game => `
    <button type="button" class="game-button ${game.id === selectedGameId ? 'active' : ''} ${game.state}"
      data-game-id="${escapeHtml(game.id)}">
      G${game.number}<span>${escapeHtml(game.state)}</span>
    </button>`).join('');
  gameSelector.querySelectorAll<HTMLButtonElement>('[data-game-id]').forEach(button => {
    button.addEventListener('click', () => selectGame(button.dataset.gameId ?? ''));
  });
}

function renderSeriesHeader(event: ScheduleEvent): void {
  const [left, right] = event.series.teams;
  selectedCompetition.textContent = event.series.competition.stage
    ? `${event.series.competition.name} · ${event.series.competition.stage}`
    : event.series.competition.name;
  selectedSeries.textContent = `${left.name} vs ${right.name}`;
  selectedMeta.textContent = `${stateLabel(event)} · Best of ${event.series.bestOf}`;
  renderGameSelector(event);
}

function hideQuality(): void {
  qualityBanner.className = 'quality-banner hidden';
  qualityBanner.replaceChildren();
}

function renderQuality(snapshot: LiveSnapshot<LolStats>): void {
  const quality = snapshot.quality;
  let title = 'Telemetry unavailable';
  let className = 'unavailable';
  if (quality.safeForLiveAnalysis) {
    title = 'Verified live telemetry';
    className = 'verified';
  } else if (quality.freshness === 'fresh') {
    title = 'Fresh partial telemetry';
    className = 'partial';
  } else if (quality.freshness === 'degraded') {
    title = 'Delayed source context';
    className = 'delayed';
  } else if (quality.freshness === 'stale') {
    title = 'Stale historical context';
    className = 'stale';
  }
  const age = quality.ageSeconds === null ? 'Source age unavailable' : `${quality.ageSeconds}s source age`;
  const reason = quality.reasons[0]?.message ?? 'No additional quality details.';
  qualityBanner.className = `quality-banner ${className}`;
  qualityBanner.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(age)} · ${escapeHtml(reason)}</span>`;
}

function objectiveMarkup(team: LolTeamState): string {
  const objectives = team.objectives;
  return `
    <div class="objective-grid">
      <div><span>Towers</span><strong>${formatNumber(objectives.towers)}</strong></div>
      <div><span>Dragons</span><strong>${objectives.dragons === null ? '—' : objectives.dragons.length}</strong></div>
      <div><span>Barons</span><strong>${formatNumber(objectives.barons)}</strong></div>
      <div><span>Heralds</span><strong>${formatNumber(objectives.heralds)}</strong></div>
      <div><span>Inhibitors</span><strong>${formatNumber(objectives.inhibitors)}</strong></div>
    </div>`;
}

function playerRows(team: LolTeamState): string {
  if (!team.players.length) return '<div class="players-empty">Player telemetry unavailable</div>';
  return team.players.map(player => `
    <div class="player-row">
      <div><strong>${escapeHtml(player.handle ?? 'Unknown player')}</strong><span>${escapeHtml(player.championId ?? 'Champion unavailable')}</span></div>
      <span>${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}</span>
      <span>${formatNumber(player.creepScore)} CS</span>
      <span>${formatNumber(player.totalGold)}g</span>
    </div>`).join('');
}

function teamMarkup(team: LolTeamState, imageUrl?: string): string {
  return `
    <section class="team-card ${team.side}">
      <div class="team-heading">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" />` : '<span class="team-placeholder"></span>'}
        <div><small>${team.side.toUpperCase()} SIDE</small><h3>${escapeHtml(team.name)}</h3></div>
      </div>
      <div class="team-primary"><div><span>Gold</span><strong>${formatNumber(team.gold)}</strong></div><div><span>Kills</span><strong>${formatNumber(team.kills)}</strong></div></div>
      ${objectiveMarkup(team)}
      <div class="player-list">${playerRows(team)}</div>
    </section>`;
}

function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {
  renderQuality(snapshot);
  const stats = snapshot.stats;
  if (!stats) {
    const reason = snapshot.quality.reasons.map(item => item.message).join(' ') || 'No normalized gameplay frame is available.';
    gameContent.innerHTML = `
      <div class="analysis-empty">
        <span class="analysis-empty-icon" aria-hidden="true">⌁</span>
        <h3>Waiting for verified gameplay</h3>
        <p>${escapeHtml(reason)}</p>
      </div>`;
    return;
  }

  const blueRef = snapshot.series.teams.find(team => team.id === stats.blue.id);
  const redRef = snapshot.series.teams.find(team => team.id === stats.red.id);
  gameContent.innerHTML = `
    <div class="scoreboard">
      <div><span>${escapeHtml(stats.blue.name)}</span><strong>${formatNumber(stats.blue.kills)}</strong></div>
      <div class="clock"><small>GAME ${snapshot.game.number}</small><strong>${formatClock(stats.gameClockSeconds)}</strong><span>${escapeHtml(stats.patch ?? 'Patch unavailable')}</span></div>
      <div class="right"><strong>${formatNumber(stats.red.kills)}</strong><span>${escapeHtml(stats.red.name)}</span></div>
    </div>
    <div class="team-grid">
      ${teamMarkup(stats.blue, blueRef?.imageUrl)}
      ${teamMarkup(stats.red, redRef?.imageUrl)}
    </div>`;
}

function renderUpcoming(event: ScheduleEvent): void {
  hideQuality();
  gameContent.innerHTML = `
    <div class="analysis-empty">
      <span class="analysis-empty-icon" aria-hidden="true">◷</span>
      <h3>Match scheduled</h3>
      <p>${escapeHtml(formatTime(event.series.scheduledStart))}. Live telemetry will start only after the provider publishes a verified game frame.</p>
    </div>`;
}

function clearSnapshotTimer(): void {
  if (snapshotTimer !== null) clearTimeout(snapshotTimer);
  snapshotTimer = null;
}

async function refreshSnapshot(): Promise<void> {
  clearSnapshotTimer();
  const event = currentEvent();
  const game = event ? selectedGame(event) : null;
  if (!event || !game) return;

  const requestedSeries = event.series.id;
  const requestedGame = game.id;
  try {
    const query = lastSourceTimestamp ? `?after=${encodeURIComponent(lastSourceTimestamp)}` : '';
    const snapshot = await api<LiveSnapshot<LolStats>>(`/v1/lol/games/${encodeURIComponent(game.id)}/live${query}`);
    if (selectedSeriesId !== requestedSeries || selectedGameId !== requestedGame) return;
    if (snapshot.quality.sourceTimestamp) lastSourceTimestamp = snapshot.quality.sourceTimestamp;
    renderSnapshot(snapshot);
  } catch (error) {
    if (selectedSeriesId !== requestedSeries || selectedGameId !== requestedGame) return;
    hideQuality();
    gameContent.innerHTML = `<div class="analysis-empty"><h3>Live feed unavailable</h3><p>${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</p></div>`;
  }

  const current = currentEvent();
  const currentGame = current ? selectedGame(current) : null;
  if (current?.series.state === 'live' && currentGame?.state !== 'completed') {
    snapshotTimer = setTimeout(() => void refreshSnapshot(), SNAPSHOT_POLL_MS);
  }
}

function selectGame(gameId: string): void {
  const event = currentEvent();
  if (!event?.series.games.some(game => game.id === gameId)) return;
  selectedGameId = gameId;
  lastSourceTimestamp = null;
  renderGameSelector(event);
  void refreshSnapshot();
}

function selectSeries(seriesId: string): void {
  const event = events.find(item => item.series.id === seriesId);
  if (!event) return;
  selectedSeriesId = seriesId;
  selectedGameId = bestGame(event)?.id ?? null;
  lastSourceTimestamp = null;
  renderSchedule();
  renderSeriesHeader(event);
  if (selectedGameId) void refreshSnapshot();
  else renderUpcoming(event);
}

function syncSelection(): void {
  const event = currentEvent();
  if (!event) {
    const first = events.find(item => item.series.state === 'live') ?? events[0];
    if (first) selectSeries(first.series.id);
    return;
  }

  const game = selectedGame(event);
  const preferred = bestGame(event);
  if (!game || (game.state === 'completed' && preferred)) {
    selectedGameId = preferred?.id ?? null;
    lastSourceTimestamp = null;
  }
  renderSeriesHeader(event);
  if (selectedGameId) void refreshSnapshot();
  else renderUpcoming(event);
}

async function refreshSchedule(): Promise<void> {
  refreshButton.disabled = true;
  try {
    const payload = await api<ScheduleResponse>('/v1/lol/schedule?states=live,paused,scheduled');
    events = [...payload.events].sort((left, right) => {
      const liveDifference = Number(right.series.state === 'live') - Number(left.series.state === 'live');
      return liveDifference || Date.parse(left.series.scheduledStart) - Date.parse(right.series.scheduledStart);
    });
    renderSchedule();
    syncSelection();
    connectionDetail.textContent = `${events.filter(event => event.series.state === 'live').length} live · ${events.length} active listings`;
  } catch (error) {
    scheduleList.innerHTML = `<div class="empty-state"><strong>Schedule unavailable</strong><span>${escapeHtml(error instanceof Error ? error.message : 'Unknown error')}</span></div>`;
  } finally {
    refreshButton.disabled = false;
  }
}

async function connect(): Promise<void> {
  try {
    const health = await api<HealthResponse>('/health');
    const connected = health.ok;
    statusHeading.textContent = connected ? 'API connected' : 'API degraded';
    statusBadge.textContent = connected ? `SCHEMA ${health.schemaVersion}` : 'DEGRADED';
    statusBadge.classList.toggle('error', !connected);
    statusDot.classList.toggle('connected', connected);
    renderAdapters(health.adapters);

    if (!health.adapters.includes('lol')) {
      connectionDetail.textContent = 'LoL adapter disabled: configure the Worker API key.';
      scheduleList.innerHTML = '<div class="empty-state"><strong>LoL adapter disabled</strong><span>Configure LOL_ESPORTS_API_KEY in the API Worker.</span></div>';
      return;
    }

    await refreshSchedule();
    scheduleTimer = setInterval(() => void refreshSchedule(), SCHEDULE_POLL_MS);
  } catch (error) {
    statusHeading.textContent = 'API unavailable';
    connectionDetail.textContent = error instanceof Error ? error.message : 'Unknown connection error';
    statusBadge.textContent = 'OFFLINE';
    statusBadge.classList.add('error');
    statusDot.classList.remove('connected');
    renderAdapters([]);
  }
}

refreshButton.addEventListener('click', () => void refreshSchedule());
window.addEventListener('beforeunload', () => {
  clearSnapshotTimer();
  if (scheduleTimer !== null) clearInterval(scheduleTimer);
});

void connect();