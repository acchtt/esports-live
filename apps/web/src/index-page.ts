import type { ScheduleEvent, SeriesContext, TeamRef } from '@esports-live/core';
import { apiJson } from './api-client.ts';
import './styles.css';
import './index-page.css';

interface HealthResponse {
  ok: boolean;
  schemaVersion: string;
  adapters: string[];
}

interface ScheduleResponse {
  esport: string;
  events: ScheduleEvent[];
}

interface MatchPresentation {
  teams: readonly [TeamRef, TeamRef];
  score: readonly [number, number];
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const SCHEDULE_POLL_MS = 30_000;
const ACTIVE_SCHEDULE_GRACE_MS = 6 * 60 * 60 * 1_000;

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
const pollingCountdown = requiredElement<HTMLElement>('#polling-countdown');
const liveMatchList = requiredElement<HTMLElement>('#live-match-list');
const upcomingMatchList = requiredElement<HTMLElement>('#upcoming-match-list');
const liveMatchCount = requiredElement<HTMLElement>('#live-match-count');
const upcomingMatchCount = requiredElement<HTMLElement>('#upcoming-match-count');

let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let nextScheduleRefreshAt: number | null = null;
let scheduleRequest: Promise<void> | null = null;
const matchPresentation = new Map<string, MatchPresentation>();

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function api<T>(path: string): Promise<T> {
  return apiJson<T>(API_BASE, path);
}

function isActiveListing(event: ScheduleEvent): boolean {
  if (event.series.state === 'live' || event.series.state === 'paused') return true;
  if (event.series.state !== 'scheduled') return false;
  const start = Date.parse(event.series.scheduledStart);
  return !Number.isFinite(start) || start >= Date.now() - ACTIVE_SCHEDULE_GRACE_MS;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function stateLabel(event: ScheduleEvent): string {
  switch (event.series.state) {
    case 'live': return 'LIVE';
    case 'paused': return 'PAUSED';
    case 'scheduled': return formatTime(event.series.scheduledStart);
    default: return event.series.state.toUpperCase();
  }
}

function matchHref(seriesId: string): string {
  return `/match.html?series=${encodeURIComponent(seriesId)}`;
}

function initials(team: TeamRef): string {
  const code = team.code?.replace(/[^a-z0-9]/gi, '').slice(0, 4);
  if (code) return code.toUpperCase();
  const words = team.name.split(/\s+/).filter(Boolean);
  const compact = words.length > 1
    ? words.slice(0, 3).map(word => word[0]).join('')
    : team.name.slice(0, 3);
  return compact.toUpperCase();
}

function teamLogo(team: TeamRef): string {
  const image = team.imageUrl
    ? `<img src="${escapeHtml(team.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : '';
  return `
    <span class="index-team-logo ${image ? 'has-image' : 'image-failed'}" aria-hidden="true">
      ${image}
      <span>${escapeHtml(initials(team))}</span>
    </span>`;
}

function teamSide(team: TeamRef, side: 'left' | 'right'): string {
  return `
    <div class="index-match-team ${side}">
      ${side === 'left' ? teamLogo(team) : ''}
      <strong>${escapeHtml(team.name)}</strong>
      ${side === 'right' ? teamLogo(team) : ''}
    </div>`;
}

function matchCard(event: ScheduleEvent): string {
  const presentation = matchPresentation.get(event.series.id);
  const [left, right] = presentation?.teams ?? event.series.teams;
  const [leftWins, rightWins] = presentation?.score ?? [0, 0];
  const competition = event.series.competition.name || 'League of Legends';
  const stage = event.series.competition.stage ?? `Best of ${event.series.bestOf}`;
  const live = event.series.state === 'live' || event.series.state === 'paused';

  return `
    <a class="index-match-card ${live ? 'is-live' : ''}" data-series-id="${escapeHtml(event.series.id)}" href="${escapeHtml(matchHref(event.series.id))}">
      <div class="index-match-card-top">
        <span class="index-match-competition">${escapeHtml(competition)}</span>
        <span class="match-state ${escapeHtml(event.series.state)}">${escapeHtml(stateLabel(event))}</span>
      </div>
      <div class="index-match-matchup">
        ${teamSide(left, 'left')}
        <div class="index-series-score" aria-label="Series score ${leftWins} to ${rightWins}">
          <strong>${leftWins}</strong><span>–</span><strong>${rightWins}</strong>
        </div>
        ${teamSide(right, 'right')}
      </div>
      <div class="index-match-card-bottom">
        <span>${escapeHtml(stage)} · Bo${event.series.bestOf}</span>
        <span class="open-match-label">Details <b aria-hidden="true">→</b></span>
      </div>
    </a>`;
}

function bindLogoFallbacks(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>('.index-team-logo img').forEach(image => {
    const logo = image.closest('.index-team-logo');
    const markFailed = (): void => logo?.classList.add('image-failed');
    image.addEventListener('error', markFailed, { once: true });
    if (image.complete && image.naturalWidth === 0) markFailed();
  });
}

function renderMatches(events: readonly ScheduleEvent[]): void {
  const live = events.filter(event => event.series.state === 'live' || event.series.state === 'paused');
  const upcoming = events.filter(event => event.series.state === 'scheduled');

  liveMatchCount.textContent = String(live.length);
  upcomingMatchCount.textContent = String(upcoming.length);

  liveMatchList.innerHTML = live.length
    ? live.map(matchCard).join('')
    : '<div class="match-index-empty"><strong>No live matches right now</strong><span>Upcoming matches are listed below.</span></div>';

  upcomingMatchList.innerHTML = upcoming.length
    ? upcoming.map(matchCard).join('')
    : '<div class="match-index-empty"><strong>No upcoming matches</strong><span>The schedule will refresh automatically.</span></div>';

  bindLogoFallbacks(liveMatchList);
  bindLogoFallbacks(upcomingMatchList);
}

async function hydrateLivePresentation(events: readonly ScheduleEvent[]): Promise<void> {
  const activeIds = new Set(events.map(event => event.series.id));
  for (const seriesId of matchPresentation.keys()) {
    if (!activeIds.has(seriesId)) matchPresentation.delete(seriesId);
  }

  const live = events.filter(event => event.series.state === 'live' || event.series.state === 'paused');
  await Promise.all(live.map(async event => {
    try {
      const context = await api<SeriesContext>(
        `/v1/lol/series/${encodeURIComponent(event.series.id)}/context?lobby=${Date.now()}`
      );
      const history = context.history;
      if (!history || history.score.length < 2) return;
      const [left, right] = history.score;
      matchPresentation.set(event.series.id, {
        teams: [left.team, right.team],
        score: [left.wins, right.wins]
      });
    } catch {
      matchPresentation.delete(event.series.id);
    }
  }));
}

function updatePollingCountdown(): void {
  if (document.hidden) {
    pollingCountdown.textContent = 'Polling paused';
    return;
  }
  if (scheduleRequest) {
    pollingCountdown.textContent = 'Refreshing…';
    return;
  }
  if (nextScheduleRefreshAt === null) {
    pollingCountdown.textContent = 'Refresh pending';
    return;
  }
  const seconds = Math.max(0, Math.ceil((nextScheduleRefreshAt - Date.now()) / 1_000));
  pollingCountdown.textContent = `Refresh in ${seconds}s`;
}

function clearScheduleTimer(): void {
  if (scheduleTimer !== null) clearTimeout(scheduleTimer);
  scheduleTimer = null;
  nextScheduleRefreshAt = null;
}

function scheduleNextRefresh(delay = SCHEDULE_POLL_MS): void {
  clearScheduleTimer();
  if (document.hidden) {
    updatePollingCountdown();
    return;
  }
  nextScheduleRefreshAt = Date.now() + delay;
  scheduleTimer = setTimeout(() => void refreshSchedule(), delay);
  updatePollingCountdown();
}

async function performScheduleRefresh(): Promise<void> {
  refreshButton.disabled = true;
  try {
    const payload = await api<ScheduleResponse>('/v1/lol/schedule?states=live,paused,scheduled');
    const events = payload.events
      .filter(isActiveListing)
      .sort((left, right) => {
        const liveDifference = Number(right.series.state === 'live') - Number(left.series.state === 'live');
        return liveDifference || Date.parse(left.series.scheduledStart) - Date.parse(right.series.scheduledStart);
      });

    await hydrateLivePresentation(events);
    renderMatches(events);
    const liveCount = events.filter(event => event.series.state === 'live' || event.series.state === 'paused').length;
    connectionDetail.textContent = `${liveCount} live · ${events.length} active matches`;
  } catch (error) {
    const message = escapeHtml(error instanceof Error ? error.message : 'Unknown error');
    liveMatchList.innerHTML = `<div class="match-index-empty"><strong>Schedule unavailable</strong><span>${message}</span></div>`;
    upcomingMatchList.innerHTML = '<div class="match-index-empty"><strong>Unable to load matches</strong><span>Try refreshing the schedule.</span></div>';
    liveMatchCount.textContent = '0';
    upcomingMatchCount.textContent = '0';
  } finally {
    refreshButton.disabled = false;
  }
}

function refreshSchedule(): Promise<void> {
  if (scheduleRequest) return scheduleRequest;
  clearScheduleTimer();
  updatePollingCountdown();
  const request = performScheduleRefresh().finally(() => {
    if (scheduleRequest === request) scheduleRequest = null;
    scheduleNextRefresh();
  });
  scheduleRequest = request;
  return request;
}

async function connect(): Promise<void> {
  try {
    const health = await api<HealthResponse>('/health');
    const connected = health.ok;
    statusHeading.textContent = connected ? 'API connected' : 'API degraded';
    statusBadge.textContent = connected ? `SCHEMA ${health.schemaVersion}` : 'DEGRADED';
    statusBadge.classList.toggle('error', !connected);
    statusDot.classList.toggle('connected', connected);

    if (!health.adapters.includes('lol')) {
      connectionDetail.textContent = 'LoL adapter disabled';
      renderMatches([]);
      return;
    }

    await refreshSchedule();
    if (countdownTimer === null) countdownTimer = setInterval(updatePollingCountdown, 1_000);
  } catch (error) {
    statusHeading.textContent = 'API unavailable';
    connectionDetail.textContent = error instanceof Error ? error.message : 'Unknown connection error';
    statusBadge.textContent = 'OFFLINE';
    statusBadge.classList.add('error');
    statusDot.classList.remove('connected');
    renderMatches([]);
  }
}

refreshButton.addEventListener('click', () => void refreshSchedule());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearScheduleTimer();
    updatePollingCountdown();
    return;
  }
  void refreshSchedule();
});
window.addEventListener('beforeunload', () => {
  clearScheduleTimer();
  if (countdownTimer !== null) clearInterval(countdownTimer);
});

void connect();
