import type { LiveSnapshot, ScheduleEvent } from '@esports-live/core';
import type {
  DotaPlayerState,
  DotaStats,
  DotaTeamState
} from '@esports-live/adapter-dota2';

interface HealthResponse {
  ok: boolean;
  adapters: readonly string[];
}

interface ScheduleResponse {
  esport: string;
  events: readonly ScheduleEvent[];
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const LIVE_POLL_MS = 8_000;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text !== undefined) value.textContent = text;
  return value;
}

function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return value.toLocaleString();
}

function activeGame(event: ScheduleEvent) {
  return event.series.games.find(game => game.state === 'live' || game.state === 'draft' || game.state === 'paused')
    ?? event.series.games.at(-1)
    ?? null;
}

function snapshotKey(event: ScheduleEvent): string | null {
  return activeGame(event)?.id ?? null;
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    ...(signal ? { signal } : {})
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `API returned ${response.status}`);
  }
  return await response.json() as T;
}

function leadCopy(snapshot: LiveSnapshot<DotaStats> | undefined): string {
  const stats = snapshot?.stats;
  if (!stats) return 'Net worth pending';
  if (stats.radiantNetWorthLead === 0) return 'Net worth even';
  const team = stats.radiantNetWorthLead > 0 ? stats.radiant.name : stats.dire.name;
  return `${team} +${compactNumber(Math.abs(stats.radiantNetWorthLead))}`;
}

function teamCode(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? parts.map(part => part[0] ?? '').join('')
    : name.slice(0, 4)).toUpperCase().slice(0, 4);
}

export function installDotaLivescore(root: HTMLElement): () => void {
  const shell = root.querySelector<HTMLElement>('.v2-shell');
  const lolMain = root.querySelector<HTMLElement>('.app-main');
  const header = root.querySelector<HTMLElement>('.app-header');
  const mobileNav = root.querySelector<HTMLElement>('.mobile-nav');
  if (!shell || !lolMain || !header) return () => undefined;

  const switcher = element('div', 'esport-switcher');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Esport selection');
  const lolButton = element('button', 'active', 'League of Legends');
  const dotaButton = element('button', undefined, 'Dota 2');
  lolButton.type = 'button';
  dotaButton.type = 'button';
  lolButton.dataset.esport = 'lol';
  dotaButton.dataset.esport = 'dota2';
  lolButton.setAttribute('aria-pressed', 'true');
  dotaButton.setAttribute('aria-pressed', 'false');
  switcher.append(lolButton, dotaButton);
  header.after(switcher);

  const dotaMain = element('main', 'dota-live-main');
  dotaMain.hidden = true;
  dotaMain.innerHTML = `
    <section class="dota-live-panel">
      <header class="dota-live-header">
        <div>
          <span>DOTA 2 · LIVE ONLY</span>
          <h1>Live matches</h1>
          <p id="dota-live-meta">Connecting to the Dota live feed…</p>
        </div>
        <button id="dota-refresh" class="refresh-button" type="button" aria-label="Refresh Dota matches">↻</button>
      </header>
      <div id="dota-live-grid" class="dota-live-grid" aria-live="polite"></div>
      <section id="dota-match-detail" class="dota-match-detail" hidden aria-live="polite"></section>
    </section>`;
  lolMain.after(dotaMain);

  const meta = dotaMain.querySelector<HTMLElement>('#dota-live-meta');
  const grid = dotaMain.querySelector<HTMLElement>('#dota-live-grid');
  const detail = dotaMain.querySelector<HTMLElement>('#dota-match-detail');
  const refreshButton = dotaMain.querySelector<HTMLButtonElement>('#dota-refresh');
  if (!meta || !grid || !detail || !refreshButton) return () => undefined;

  let activeEsport: 'lol' | 'dota2' = 'lol';
  let events: readonly ScheduleEvent[] = [];
  let selectedSeriesId: string | null = null;
  let snapshots: Readonly<Record<string, LiveSnapshot<DotaStats>>> = {};
  let scheduleTimer: number | null = null;
  let controller: AbortController | null = null;
  let disposed = false;

  const clearTimers = (): void => {
    if (scheduleTimer !== null) window.clearTimeout(scheduleTimer);
    scheduleTimer = null;
  };

  const selectedEvent = (): ScheduleEvent | null => (
    events.find(event => event.series.id === selectedSeriesId) ?? null
  );

  const renderHero = (player: DotaPlayerState): HTMLElement => {
    const card = element('article', 'dota-hero');
    if (player.heroImageUrl) {
      const image = element('img');
      image.src = player.heroImageUrl;
      image.alt = player.heroName ? `${player.heroName} hero portrait` : 'Dota hero portrait';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      card.append(image);
    }
    card.append(element('span', undefined, player.heroName ?? `Hero ${player.heroId || '?'}`));
    return card;
  };

  const renderTeamLineup = (team: DotaTeamState): HTMLElement => {
    const section = element('section', `dota-lineup ${team.side}`);
    const heading = element('header');
    heading.append(
      element('span', undefined, team.side.toUpperCase()),
      element('strong', undefined, team.name)
    );
    const heroes = element('div', 'dota-heroes');
    if (team.players.length) team.players.forEach(player => heroes.append(renderHero(player)));
    else heroes.append(element('span', 'dota-heroes-pending', 'Hero picks pending'));
    section.append(heading, heroes);
    return section;
  };

  const renderDetail = (): void => {
    const event = selectedEvent();
    const gameId = event ? snapshotKey(event) : null;
    const snapshot = gameId ? snapshots[gameId] : undefined;
    const stats = snapshot?.stats;
    detail.replaceChildren();
    detail.hidden = !event;
    if (!event) return;

    const heading = element('header', 'dota-detail-header');
    const copy = element('div');
    copy.append(
      element('span', undefined, event.series.competition.name),
      element('h2', undefined, `${event.series.teams[0].name} vs ${event.series.teams[1].name}`),
      element('p', undefined, gameId ? `Match ${gameId}` : 'Live match')
    );
    heading.append(copy, element('strong', 'dota-detail-clock', formatClock(stats?.gameClockSeconds)));

    const scoreboard = element('section', 'dota-scoreboard');
    const radiant = element('article', 'dota-team-score radiant');
    radiant.append(
      element('span', undefined, 'RADIANT'),
      element('strong', undefined, stats?.radiant.name ?? event.series.teams[0].name),
      element('b', undefined, String(stats?.radiant.kills ?? '—'))
    );
    const center = element('article', 'dota-score-center');
    center.append(
      element('span', undefined, 'NET WORTH LEAD'),
      element('strong', undefined, leadCopy(snapshot)),
      element('small', undefined, stats?.spectators === null || stats?.spectators === undefined
        ? 'Spectators unavailable'
        : `${stats.spectators.toLocaleString()} spectators`)
    );
    const dire = element('article', 'dota-team-score dire');
    dire.append(
      element('span', undefined, 'DIRE'),
      element('strong', undefined, stats?.dire.name ?? event.series.teams[1].name),
      element('b', undefined, String(stats?.dire.kills ?? '—'))
    );
    scoreboard.append(radiant, center, dire);

    const lineups = element('section', 'dota-lineups');
    if (stats) lineups.append(renderTeamLineup(stats.radiant), renderTeamLineup(stats.dire));
    else lineups.append(element('div', 'dota-detail-pending', 'Loading the current scoreboard…'));

    const footer = element('footer', 'dota-detail-footer');
    footer.append(
      element('span', undefined, stats?.broadcastDelaySeconds === null || stats?.broadcastDelaySeconds === undefined
        ? 'Broadcast delay unavailable'
        : `${stats.broadcastDelaySeconds}s broadcast delay`),
      element('small', undefined, snapshot
        ? `${snapshot.quality.freshness} · ${snapshot.quality.ageSeconds ?? '—'}s source age`
        : 'Telemetry pending')
    );
    detail.append(heading, scoreboard, lineups, footer);
  };

  const matchCard = (event: ScheduleEvent): HTMLButtonElement => {
    const gameId = snapshotKey(event);
    const snapshot = gameId ? snapshots[gameId] : undefined;
    const stats = snapshot?.stats;
    const button = element('button', 'dota-match-card');
    button.type = 'button';
    button.dataset.seriesId = event.series.id;
    button.classList.toggle('selected', event.series.id === selectedSeriesId);
    const top = element('span', 'dota-card-top');
    top.append(
      element('small', undefined, event.series.competition.name),
      element('b', undefined, 'LIVE')
    );
    const score = element('span', 'dota-card-score');
    const radiant = element('strong');
    radiant.append(
      element('i', undefined, teamCode(event.series.teams[0].name)),
      element('span', undefined, stats?.radiant.name ?? event.series.teams[0].name),
      element('b', undefined, String(stats?.radiant.kills ?? '—'))
    );
    const dire = element('strong');
    dire.append(
      element('b', undefined, String(stats?.dire.kills ?? '—')),
      element('span', undefined, stats?.dire.name ?? event.series.teams[1].name),
      element('i', undefined, teamCode(event.series.teams[1].name))
    );
    score.append(radiant, element('em', undefined, formatClock(stats?.gameClockSeconds)), dire);
    const bottom = element('span', 'dota-card-bottom');
    bottom.append(
      element('small', undefined, gameId ? `Game ${activeGame(event)?.number ?? 1}` : 'Live game'),
      element('strong', undefined, leadCopy(snapshot))
    );
    button.append(top, score, bottom);
    button.setAttribute('aria-label', `${event.series.teams[0].name} versus ${event.series.teams[1].name}, live`);
    button.addEventListener('click', () => {
      selectedSeriesId = event.series.id;
      renderGrid();
      renderDetail();
      detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    return button;
  };

  const renderGrid = (): void => {
    grid.replaceChildren();
    if (!events.length) {
      const empty = element('div', 'catalogue-empty');
      empty.append(
        element('strong', undefined, 'No professional Dota matches are live'),
        element('span', undefined, 'The feed will refresh automatically when a league game starts.')
      );
      grid.append(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    events.forEach(event => fragment.append(matchCard(event)));
    grid.append(fragment);
  };

  const hydrateSnapshots = async (signal: AbortSignal): Promise<void> => {
    const results = await Promise.allSettled(events.map(async event => {
      const gameId = snapshotKey(event);
      if (!gameId) return null;
      return await requestJson<LiveSnapshot<DotaStats>>(
        `/v1/dota2/games/${encodeURIComponent(gameId)}/live`,
        signal
      );
    }));
    if (signal.aborted) return;
    const next = { ...snapshots };
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) next[result.value.game.id] = result.value;
    });
    snapshots = next;
    renderGrid();
    renderDetail();
  };

  const refreshSchedule = async (): Promise<void> => {
    if (disposed || activeEsport !== 'dota2') return;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    meta.textContent = events.length ? `${events.length} live series · Refreshing…` : 'Loading live Dota matches…';
    try {
      const payload = await requestJson<ScheduleResponse>(
        '/v1/dota2/schedule?states=live,paused',
        signal
      );
      events = payload.events;
      if (!events.some(event => event.series.id === selectedSeriesId)) {
        selectedSeriesId = events[0]?.series.id ?? null;
      }
      meta.textContent = `${events.length} live ${events.length === 1 ? 'series' : 'series'} · OpenDota`;
      renderGrid();
      await hydrateSnapshots(signal);
    } catch (error) {
      if (!signal.aborted) {
        meta.textContent = error instanceof Error ? error.message : 'Dota live feed unavailable';
        renderGrid();
      }
    }
    if (!signal.aborted && activeEsport === 'dota2' && !document.hidden) {
      scheduleTimer = window.setTimeout(() => void refreshSchedule(), LIVE_POLL_MS);
    }
  };

  const activate = (esport: 'lol' | 'dota2'): void => {
    activeEsport = esport;
    shell.dataset.esport = esport;
    const dotaActive = esport === 'dota2';
    lolButton.classList.toggle('active', !dotaActive);
    dotaButton.classList.toggle('active', dotaActive);
    lolButton.setAttribute('aria-pressed', String(!dotaActive));
    dotaButton.setAttribute('aria-pressed', String(dotaActive));
    lolMain.hidden = dotaActive;
    dotaMain.hidden = !dotaActive;
    if (mobileNav) mobileNav.hidden = dotaActive;
    clearTimers();
    controller?.abort();
    if (dotaActive) void refreshSchedule();
  };

  const selectLol = (): void => activate('lol');
  const selectDota = (): void => activate('dota2');
  const refreshDota = (): void => void refreshSchedule();
  const visibilityChanged = (): void => {
    clearTimers();
    controller?.abort();
    if (!document.hidden && activeEsport === 'dota2') void refreshSchedule();
  };
  lolButton.addEventListener('click', selectLol);
  dotaButton.addEventListener('click', selectDota);
  refreshButton.addEventListener('click', refreshDota);
  document.addEventListener('visibilitychange', visibilityChanged);

  void requestJson<HealthResponse>('/health')
    .then(health => {
      const available = health.ok && health.adapters.includes('dota2');
      dotaButton.disabled = !available;
      dotaButton.title = available ? 'Open Dota 2 live scores' : 'Dota live adapter unavailable';
    })
    .catch(() => {
      dotaButton.disabled = true;
      dotaButton.title = 'Dota live adapter unavailable';
    });

  return () => {
    disposed = true;
    clearTimers();
    controller?.abort();
    lolButton.removeEventListener('click', selectLol);
    dotaButton.removeEventListener('click', selectDota);
    refreshButton.removeEventListener('click', refreshDota);
    document.removeEventListener('visibilitychange', visibilityChanged);
    switcher.remove();
    dotaMain.remove();
    lolMain.hidden = false;
    if (mobileNav) mobileNav.hidden = false;
    delete shell.dataset.esport;
  };
}
