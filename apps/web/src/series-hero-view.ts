import type { LiveSnapshot, ScheduleEvent, TeamRef } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import './series-hero-view.css';
import './official-lol-logo.css';

const OFFICIAL_LOL_LOGO_URL =
  'https://www.riotgames.com/darkroom/original/9a50f5b3bdcfb815580ef103ec9b6ee2%3Ad49b78b12cf185e10127cdf81b144a00/lol-logo-rendered-hi-res.png';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const analysisHeader = requiredElement<HTMLElement>('.analysis-header');
const selectedCompetition = requiredElement<HTMLElement>('#selected-competition');
const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const gameSelector = requiredElement<HTMLElement>('#game-selector');
const legacySummary = selectedCompetition.parentElement;

if (!legacySummary) throw new Error('Missing legacy series summary');
legacySummary.classList.add('series-hero-legacy');

const hero = document.createElement('section');
hero.id = 'series-hero';
hero.className = 'series-hero';
hero.hidden = true;
analysisHeader.insertBefore(hero, gameSelector);

let activeEvent: ScheduleEvent | null = null;
let latestPatch: string | null = null;
let renderFrame: number | null = null;
let renderKey = '';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

function teamLogoMarkup(team: TeamRef): string {
  const image = team.imageUrl
    ? `<img src="${escapeHtml(team.imageUrl)}" alt="" decoding="async" referrerpolicy="no-referrer" />`
    : '';
  return `
    <span class="series-hero-team-logo ${image ? 'has-image' : 'image-failed'}" aria-hidden="true">
      ${image}
      <span class="series-hero-team-fallback">${escapeHtml(initials(team))}</span>
    </span>`;
}

function teamMarkup(team: TeamRef, side: 'left' | 'right'): string {
  return `
    <div class="series-hero-team ${side}">
      ${teamLogoMarkup(team)}
      <div class="series-hero-team-copy">
        <strong>${escapeHtml(team.name)}</strong>
        <small>${escapeHtml(team.code ?? initials(team))}</small>
      </div>
    </div>`;
}

function scoreFromHeader(): readonly [number, number] {
  const score = selectedSeries.querySelectorAll<HTMLElement>('.history-header-score b');
  if (score.length >= 2) {
    const left = Number(score[0]?.textContent ?? 0);
    const right = Number(score[1]?.textContent ?? 0);
    if (Number.isFinite(left) && Number.isFinite(right)) return [left, right];
  }
  return [0, 0];
}

function completedGames(event: ScheduleEvent): { completed: number; total: number } {
  const meta = selectedMeta.textContent ?? '';
  const match = meta.match(/(\d+)\s*\/\s*(\d+)\s+games?\s+completed/i);
  if (match) return { completed: Number(match[1]), total: Number(match[2]) };
  const completed = event.series.games.filter(game => game.state === 'completed').length;
  return { completed, total: Math.max(event.series.bestOf, event.series.games.length) };
}

function statusFromHeader(event: ScheduleEvent): string {
  const first = selectedMeta.textContent?.split('·')[0]?.trim().toUpperCase();
  if (first && ['LIVE', 'PAUSED', 'FINAL', 'IN PROGRESS'].includes(first)) return first;
  return event.series.state === 'scheduled' ? 'SCHEDULED' : event.series.state.toUpperCase();
}

function activeGameLabel(event: ScheduleEvent): string {
  const active = event.series.games.find(game => ['live', 'draft', 'paused'].includes(game.state));
  if (active) {
    const state = active.state === 'draft' ? 'draft' : active.state === 'paused' ? 'paused' : 'live';
    return `Game ${active.number} ${state}`;
  }
  if (!event.series.games.length && ['live', 'paused'].includes(event.series.state)) return 'Game feed pending';
  if (event.series.state === 'completed') return 'Series completed';
  return 'Series scheduled';
}

function formatStart(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Start time unavailable';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatPatch(value: string | null): string {
  const match = value?.match(/^(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}` : 'Pending';
}

function gameMark(): string {
  return `
    <span class="series-hero-game-mark official-lol-logo" aria-hidden="true">
      <img
        src="${OFFICIAL_LOL_LOGO_URL}"
        alt=""
        decoding="async"
        loading="eager"
        referrerpolicy="no-referrer"
      />
      <b>LoL</b>
    </span>`;
}

function bindLogoFallbacks(): void {
  hero.querySelectorAll<HTMLImageElement>('.series-hero-team-logo img, .series-hero-game-mark img')
    .forEach(image => {
      const container = image.closest('.series-hero-team-logo, .series-hero-game-mark');
      const markLoaded = (): void => {
        container?.classList.remove('image-failed');
        container?.classList.add('image-loaded');
      };
      const markFailed = (): void => {
        container?.classList.remove('image-loaded');
        container?.classList.add('image-failed');
      };
      image.addEventListener('load', markLoaded, { once: true });
      image.addEventListener('error', markFailed, { once: true });
      if (image.complete) {
        if (image.naturalWidth > 0) markLoaded();
        else markFailed();
      }
    });
}

function render(): void {
  renderFrame = null;
  const event = activeEvent;
  if (!event) return;

  const [left, right] = event.series.teams;
  const [leftWins, rightWins] = scoreFromHeader();
  const progress = completedGames(event);
  const status = statusFromHeader(event);
  const statusClass = status.toLowerCase().replaceAll(' ', '-');
  const winsRequired = Math.floor(event.series.bestOf / 2) + 1;
  const competition = event.series.competition.stage
    ? `${event.series.competition.name} · ${event.series.competition.stage}`
    : event.series.competition.name;
  const gameLabel = activeGameLabel(event);
  const key = JSON.stringify({
    id: event.series.id,
    left,
    right,
    score: [leftWins, rightWins],
    progress,
    status,
    competition,
    game: gameLabel,
    start: event.series.scheduledStart,
    patch: latestPatch
  });
  if (key === renderKey) return;
  renderKey = key;
  hero.dataset.status = statusClass;

  hero.innerHTML = `
    <div class="series-hero-stage">
      <div class="series-hero-topline">
        <div class="series-hero-competition">
          ${gameMark()}
          <div>
            <span>League of Legends</span>
            <strong>${escapeHtml(competition)}</strong>
          </div>
        </div>
        <span class="series-hero-status ${escapeHtml(statusClass)}">
          ${escapeHtml(status)}
        </span>
      </div>

      <div class="series-hero-matchup">
        ${teamMarkup(left, 'left')}
        <div class="series-hero-score" aria-label="Series score ${leftWins} to ${rightWins}">
          <span>Series score</span>
          <div><strong>${leftWins}</strong><i>–</i><strong>${rightWins}</strong></div>
          <small>Best of ${event.series.bestOf} · First to ${winsRequired}</small>
        </div>
        ${teamMarkup(right, 'right')}
      </div>

      <div class="series-hero-footer">
        <span class="series-hero-live-context">
          <i></i><span><b>Current game</b><span>${escapeHtml(gameLabel)}</span></span>
        </span>
        <span class="series-hero-progress">
          <span><b>Series progress</b><span>${progress.completed} of ${progress.total} games completed</span></span>
        </span>
        <time datetime="${escapeHtml(event.series.scheduledStart)}">
          <span><b>Start time</b><span>${escapeHtml(formatStart(event.series.scheduledStart))}</span></span>
        </time>
        <span class="series-hero-patch">
          <span><b>Patch</b><span>${escapeHtml(formatPatch(latestPatch))}</span></span>
        </span>
      </div>
    </div>`;

  hero.hidden = false;
  analysisHeader.classList.add('series-hero-active');
  bindLogoFallbacks();
}

function scheduleRender(): void {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(render);
}

window.addEventListener('esports-live:selection', event => {
  const next = (event as CustomEvent<ScheduleEvent>).detail;
  if (activeEvent?.series.id !== next.series.id) latestPatch = null;
  activeEvent = next;
  renderKey = '';
  scheduleRender();
});

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats || snapshot.series.id !== activeEvent?.series.id) return;
  latestPatch = snapshot.stats.patch;
  renderKey = '';
  scheduleRender();
});

const summaryObserver = new MutationObserver(scheduleRender);
for (const target of [selectedCompetition, selectedSeries, selectedMeta]) {
  summaryObserver.observe(target, { childList: true, subtree: true, characterData: true });
}

window.addEventListener('beforeunload', () => {
  summaryObserver.disconnect();
  if (renderFrame !== null) cancelAnimationFrame(renderFrame);
});
