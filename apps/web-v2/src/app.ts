import type { LiveSnapshot, ScheduleEvent, SeriesGameRef } from '@esports-live/core';
import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';
import { loadHealth, loadSchedule, loadSnapshot } from './api.ts';
import {
  AppStore,
  eventsForView,
  selectedEvent,
  selectedGame,
  selectionForView,
  type AppState,
  type AppView,
  type DataView
} from './state.ts';

const SCHEDULE_POLL_MS = 30_000;
const SNAPSHOT_POLL_MS = 2_000;
const BUILD_SHA = String(import.meta.env.VITE_BUILD_SHA_SHORT ?? 'local');
const DATA_VIEWS: readonly DataView[] = ['matches', 'history'];
const OBJECTIVES = ['towers', 'dragons', 'barons', 'inhibitors'] as const;

type ObjectiveKey = typeof OBJECTIVES[number];

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function isAppView(value: string | undefined): value is AppView {
  return value === 'matches' || value === 'history' || value === 'standings';
}

function isDataView(value: string | undefined): value is DataView {
  return value === 'matches' || value === 'history';
}

function activeDataView(state: AppState): DataView | null {
  return isDataView(state.activeView) ? state.activeView : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown data error';
}

function formatSeriesTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Time unavailable';
}

function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${Math.round(absolute / 1_000)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function stateLabel(state: SeriesGameRef['state']): string {
  if (state === 'completed') return 'Final';
  if (state === 'live' || state === 'draft' || state === 'paused') return 'Live';
  if (state === 'unstarted') return 'Scheduled';
  return 'Pending';
}

function seriesStateLabel(event: ScheduleEvent): string {
  if (event.series.state === 'live') return 'LIVE';
  if (event.series.state === 'paused') return 'PAUSED';
  if (event.series.state === 'completed') return 'FINAL';
  return formatSeriesTime(event.series.scheduledStart);
}

function objectiveValue(team: LolTeamState | null, key: ObjectiveKey): number | null {
  if (!team) return null;
  if (key === 'dragons') return team.objectives.dragons?.length ?? null;
  return team.objectives[key];
}

function sortEvents(view: DataView, events: readonly ScheduleEvent[]): readonly ScheduleEvent[] {
  return [...events].sort((left, right) => {
    if (view === 'history') {
      return Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart);
    }
    const liveDifference = Number(right.series.state === 'live') - Number(left.series.state === 'live');
    return liveDifference || Date.parse(left.series.scheduledStart) - Date.parse(right.series.scheduledStart);
  });
}

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

export class WebV2App {
  readonly #store = new AppStore();
  readonly #root: HTMLElement;
  readonly #shell: HTMLElement;
  readonly #seriesList: HTMLElement;
  readonly #railTitle: HTMLElement;
  readonly #railMeta: HTMLElement;
  readonly #stageEyebrow: HTMLElement;
  readonly #stageTitle: HTMLElement;
  readonly #stageMeta: HTMLElement;
  readonly #gameTabs: HTMLElement;
  readonly #scoreboard: HTMLElement;
  readonly #standingsPanel: HTMLElement;
  readonly #connectionPill: HTMLElement;
  readonly #connectionText: HTMLElement;
  readonly #refreshButton: HTMLButtonElement;
  readonly #clock: HTMLElement;
  readonly #gameLabel: HTMLElement;
  readonly #gameState: HTMLElement;
  readonly #blueName: HTMLElement;
  readonly #redName: HTMLElement;
  readonly #blueKills: HTMLElement;
  readonly #redKills: HTMLElement;
  readonly #blueGold: HTMLElement;
  readonly #redGold: HTMLElement;
  readonly #goldLead: HTMLElement;
  readonly #goldLeadLabel: HTMLElement;
  readonly #qualityText: HTMLElement;
  readonly #scoreboardNotice: HTMLElement;
  #seriesListSignature = '';
  #gameTabsSignature = '';
  #selectionKey = '';
  #scheduleTimer: number | null = null;
  #snapshotTimer: number | null = null;
  #scheduleController: AbortController | null = null;
  #snapshotController: AbortController | null = null;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#root.innerHTML = `
      <div class="v2-shell" data-view="matches">
        <header class="app-header">
          <div class="brand-lockup">
            <span class="brand-mark" aria-hidden="true">EL</span>
            <div><strong>Esports Live</strong><span>Rebuilt preview · ${BUILD_SHA}</span></div>
          </div>
          <nav class="primary-nav" aria-label="Primary navigation">
            <button type="button" data-view="matches">Matches</button>
            <button type="button" data-view="history">History</button>
            <button type="button" data-view="standings">Standings</button>
          </nav>
          <div class="header-actions">
            <div class="connection-pill" data-status="connecting"><i></i><span>Connecting</span></div>
            <a class="legacy-link" href="../">Current site</a>
          </div>
        </header>

        <main class="workspace">
          <aside class="series-rail" aria-label="Series list">
            <header class="rail-header">
              <div><span id="rail-title">Active matches</span><strong id="rail-meta">Loading schedule…</strong></div>
              <button id="refresh-data" class="icon-button" type="button" aria-label="Refresh data">↻</button>
            </header>
            <div id="series-list" class="series-list" aria-live="polite"></div>
          </aside>

          <section class="stage">
            <header class="stage-header">
              <div>
                <span id="stage-eyebrow">Select a match</span>
                <h1 id="stage-title">Live scoreboard</h1>
                <p id="stage-meta">The new frontend keeps one stable scoreboard mounted while state changes.</p>
              </div>
              <span id="game-state" class="state-chip">PENDING</span>
            </header>

            <div id="game-tabs" class="game-tabs" aria-label="Game selection"></div>

            <div class="view-stack">
              <article id="scoreboard" class="scoreboard" data-component="scoreboard" aria-busy="false">
                <header class="scoreboard-header">
                  <strong id="game-clock">--:--</strong>
                  <span id="game-label">No game selected</span>
                </header>

                <section class="team-summary" aria-label="Team summary">
                  <article class="team-card blue">
                    <span>BLUE SIDE</span>
                    <strong id="blue-name">Blue team</strong>
                    <div><b id="blue-kills">—</b><small>KILLS</small></div>
                    <p><span>Gold</span><strong id="blue-gold">—</strong></p>
                  </article>
                  <article class="gold-card">
                    <span id="gold-lead-label">GOLD LEAD</span>
                    <strong id="gold-lead">—</strong>
                  </article>
                  <article class="team-card red">
                    <span>RED SIDE</span>
                    <strong id="red-name">Red team</strong>
                    <div><b id="red-kills">—</b><small>KILLS</small></div>
                    <p><span>Gold</span><strong id="red-gold">—</strong></p>
                  </article>
                </section>

                <section class="objective-panel" aria-label="Objectives">
                  <header><span>Objectives</span><small>Blue — Red</small></header>
                  <div class="objective-grid">
                    <article data-objective="towers"><span>Towers</span><strong><b data-side="blue">—</b><i>—</i><b data-side="red">—</b></strong></article>
                    <article data-objective="dragons"><span>Dragons</span><strong><b data-side="blue">—</b><i>—</i><b data-side="red">—</b></strong></article>
                    <article data-objective="barons"><span>Barons</span><strong><b data-side="blue">—</b><i>—</i><b data-side="red">—</b></strong></article>
                    <article data-objective="inhibitors"><span>Inhibitors</span><strong><b data-side="blue">—</b><i>—</i><b data-side="red">—</b></strong></article>
                  </div>
                </section>

                <footer class="scoreboard-footer">
                  <span id="scoreboard-notice">Select a match to begin.</span>
                  <small id="quality-text">No telemetry</small>
                </footer>
              </article>

              <section id="standings-panel" class="standings-panel" aria-labelledby="standings-title">
                <span>PHASE 2</span>
                <h2 id="standings-title">Standings migration</h2>
                <p>The shell, navigation and state ownership are rebuilt first. Standings will plug into this mounted panel without replacing the application frame.</p>
                <div class="architecture-card">
                  <strong>One state store</strong>
                  <span>Tabs, selected series, selected game and telemetry all derive from the same reducer.</span>
                </div>
                <div class="architecture-card">
                  <strong>One render owner</strong>
                  <span>The scoreboard remains mounted; switching games updates its fields instead of rebuilding the page.</span>
                </div>
              </section>
            </div>
          </section>
        </main>

        <nav class="mobile-nav" aria-label="Mobile navigation">
          <button type="button" data-view="matches"><span>●</span>Matches</button>
          <button type="button" data-view="history"><span>◷</span>History</button>
          <button type="button" data-view="standings"><span>▥</span>Standings</button>
        </nav>
      </div>`;

    this.#shell = requiredElement(this.#root, '.v2-shell');
    this.#seriesList = requiredElement(this.#root, '#series-list');
    this.#railTitle = requiredElement(this.#root, '#rail-title');
    this.#railMeta = requiredElement(this.#root, '#rail-meta');
    this.#stageEyebrow = requiredElement(this.#root, '#stage-eyebrow');
    this.#stageTitle = requiredElement(this.#root, '#stage-title');
    this.#stageMeta = requiredElement(this.#root, '#stage-meta');
    this.#gameTabs = requiredElement(this.#root, '#game-tabs');
    this.#scoreboard = requiredElement(this.#root, '#scoreboard');
    this.#standingsPanel = requiredElement(this.#root, '#standings-panel');
    this.#connectionPill = requiredElement(this.#root, '.connection-pill');
    this.#connectionText = requiredElement(this.#connectionPill, 'span');
    this.#refreshButton = requiredElement(this.#root, '#refresh-data');
    this.#clock = requiredElement(this.#root, '#game-clock');
    this.#gameLabel = requiredElement(this.#root, '#game-label');
    this.#gameState = requiredElement(this.#root, '#game-state');
    this.#blueName = requiredElement(this.#root, '#blue-name');
    this.#redName = requiredElement(this.#root, '#red-name');
    this.#blueKills = requiredElement(this.#root, '#blue-kills');
    this.#redKills = requiredElement(this.#root, '#red-kills');
    this.#blueGold = requiredElement(this.#root, '#blue-gold');
    this.#redGold = requiredElement(this.#root, '#red-gold');
    this.#goldLead = requiredElement(this.#root, '#gold-lead');
    this.#goldLeadLabel = requiredElement(this.#root, '#gold-lead-label');
    this.#qualityText = requiredElement(this.#root, '#quality-text');
    this.#scoreboardNotice = requiredElement(this.#root, '#scoreboard-notice');

    this.#root.addEventListener('click', event => this.#handleClick(event));
    this.#store.subscribe((state, previous) => this.#stateChanged(state, previous));
    this.#render(this.#store.getState());
  }

  start(): void {
    void this.#connect();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.#clearTimers();
        this.#scheduleController?.abort();
        this.#snapshotController?.abort();
      } else {
        void this.#refreshSchedules();
        this.#syncSnapshot(true);
      }
    });
    window.addEventListener('beforeunload', () => {
      this.#clearTimers();
      this.#scheduleController?.abort();
      this.#snapshotController?.abort();
    });
  }

  #handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const viewButton = target.closest<HTMLElement>('[data-view]');
    if (viewButton && isAppView(viewButton.dataset.view)) {
      this.#store.dispatch({ type: 'set-view', view: viewButton.dataset.view });
      return;
    }

    const seriesButton = target.closest<HTMLElement>('[data-series-id][data-list-view]');
    if (seriesButton && isDataView(seriesButton.dataset.listView)) {
      const seriesId = seriesButton.dataset.seriesId;
      if (seriesId) {
        this.#store.dispatch({
          type: 'select-series',
          view: seriesButton.dataset.listView,
          seriesId
        });
      }
      return;
    }

    const gameButton = target.closest<HTMLElement>('[data-game-id]');
    const view = activeDataView(this.#store.getState());
    if (gameButton && view && gameButton.dataset.gameId) {
      this.#store.dispatch({
        type: 'select-game',
        view,
        gameId: gameButton.dataset.gameId
      });
      return;
    }

    if (target.closest('#refresh-data')) void this.#refreshSchedules();
  }

  #stateChanged(state: AppState, previous: AppState): void {
    this.#render(state);
    const view = activeDataView(state);
    const previousView = activeDataView(previous);
    const selection = view ? selectionForView(state, view) : null;
    const previousSelection = previousView ? selectionForView(previous, previousView) : null;
    const nextKey = view && selection?.gameId ? `${view}:${selection.gameId}` : '';
    const previousKey = previousView && previousSelection?.gameId
      ? `${previousView}:${previousSelection.gameId}`
      : '';
    if (nextKey !== previousKey || nextKey !== this.#selectionKey) {
      this.#selectionKey = nextKey;
      this.#syncSnapshot(true);
    }
  }

  async #connect(): Promise<void> {
    try {
      const health = await loadHealth();
      if (!health.ok || !health.adapters.includes('lol')) {
        this.#store.dispatch({
          type: 'set-connection',
          status: 'offline',
          message: 'LoL data adapter unavailable'
        });
        return;
      }
      this.#store.dispatch({
        type: 'set-connection',
        status: 'online',
        message: `API online · schema ${health.schemaVersion}`
      });
      await this.#refreshSchedules();
    } catch (error) {
      this.#store.dispatch({
        type: 'set-connection',
        status: 'offline',
        message: errorMessage(error)
      });
    }
  }

  async #refreshSchedules(): Promise<void> {
    this.#scheduleController?.abort();
    this.#scheduleController = new AbortController();
    const signal = this.#scheduleController.signal;
    DATA_VIEWS.forEach(view => this.#store.dispatch({ type: 'schedule-loading', view }));

    await Promise.all(DATA_VIEWS.map(async view => {
      try {
        const events = await loadSchedule(view, signal);
        this.#store.dispatch({
          type: 'schedule-loaded',
          view,
          events: sortEvents(view, events)
        });
      } catch (error) {
        if (signal.aborted) return;
        this.#store.dispatch({
          type: 'schedule-failed',
          view,
          message: errorMessage(error)
        });
      }
    }));

    if (!signal.aborted && !document.hidden) {
      if (this.#scheduleTimer !== null) window.clearTimeout(this.#scheduleTimer);
      this.#scheduleTimer = window.setTimeout(() => void this.#refreshSchedules(), SCHEDULE_POLL_MS);
    }
  }

  #syncSnapshot(immediate: boolean): void {
    if (this.#snapshotTimer !== null) window.clearTimeout(this.#snapshotTimer);
    this.#snapshotTimer = null;
    this.#snapshotController?.abort();

    const state = this.#store.getState();
    const view = activeDataView(state);
    if (!view || document.hidden) return;
    const game = selectedGame(state, view);
    if (!game) return;

    const delay = immediate ? 0 : SNAPSHOT_POLL_MS;
    this.#snapshotTimer = window.setTimeout(() => void this.#requestSnapshot(view, game), delay);
  }

  async #requestSnapshot(view: DataView, game: SeriesGameRef): Promise<void> {
    this.#snapshotController?.abort();
    this.#snapshotController = new AbortController();
    const signal = this.#snapshotController.signal;
    const state = this.#store.getState();
    const cached = state.snapshots[game.id];
    const after = game.state === 'completed' ? null : cached?.quality.sourceTimestamp ?? null;
    this.#store.dispatch({ type: 'snapshot-loading', gameId: game.id });

    try {
      const snapshot = await loadSnapshot(game.id, after, signal);
      this.#store.dispatch({ type: 'snapshot-received', snapshot });
    } catch (error) {
      if (!signal.aborted) {
        this.#store.dispatch({
          type: 'snapshot-failed',
          gameId: game.id,
          message: errorMessage(error)
        });
      }
    }

    if (signal.aborted || document.hidden) return;
    const current = this.#store.getState();
    const currentView = activeDataView(current);
    const currentGame = currentView ? selectedGame(current, currentView) : null;
    const snapshot = current.snapshots[game.id];
    if (currentView === view && currentGame?.id === game.id && snapshot?.game.state !== 'completed') {
      this.#syncSnapshot(false);
    }
  }

  #render(state: AppState): void {
    this.#shell.dataset.view = state.activeView;
    this.#renderNavigation(state);
    this.#renderConnection(state);

    const view = activeDataView(state);
    this.#scoreboard.hidden = view === null;
    this.#standingsPanel.hidden = view !== null;
    this.#gameState.hidden = view === null;
    this.#refreshButton.hidden = view === null;

    if (!view) {
      this.#railTitle.textContent = 'Architecture';
      this.#railMeta.textContent = 'Stable application shell';
      this.#seriesList.replaceChildren();
      this.#seriesListSignature = 'standings';
      this.#gameTabs.replaceChildren();
      this.#gameTabsSignature = 'standings';
      this.#stageEyebrow.textContent = 'Rebuild roadmap';
      this.#stageTitle.textContent = 'Standings';
      this.#stageMeta.textContent = 'This panel stays mounted while navigation changes.';
      return;
    }

    this.#renderSeriesList(state, view);
    this.#renderGameTabs(state, view);
    this.#renderScoreboard(state, view);
  }

  #renderNavigation(state: AppState): void {
    this.#root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
      const active = button.dataset.view === state.activeView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  #renderConnection(state: AppState): void {
    this.#connectionPill.dataset.status = state.connectionStatus;
    this.#connectionText.textContent = state.connectionStatus === 'online'
      ? 'Live data'
      : state.connectionStatus === 'offline'
        ? 'Offline'
        : 'Connecting';
    this.#connectionPill.title = state.connectionMessage;
  }

  #renderSeriesList(state: AppState, view: DataView): void {
    const events = eventsForView(state, view);
    const selection = selectionForView(state, view);
    const status = state.scheduleStatus[view];
    const error = state.scheduleError[view];
    this.#railTitle.textContent = view === 'matches' ? 'Active matches' : 'Match history';
    this.#railMeta.textContent = status === 'loading' && !events.length
      ? 'Loading schedule…'
      : status === 'error'
        ? error ?? 'Schedule unavailable'
        : `${events.length} ${events.length === 1 ? 'series' : 'series'}`;

    const signature = JSON.stringify({
      view,
      status,
      events: events.map(event => [
        event.series.id,
        event.series.state,
        event.series.scheduledStart,
        event.series.teams[0].name,
        event.series.teams[1].name
      ])
    });
    if (signature !== this.#seriesListSignature) {
      this.#seriesListSignature = signature;
      const fragment = document.createDocumentFragment();
      if (!events.length) {
        const empty = element('div', 'rail-empty');
        empty.append(
          element('strong', undefined, status === 'error' ? 'Schedule unavailable' : 'No series found'),
          element('span', undefined, status === 'error' ? error ?? 'Try refreshing.' : 'New matches will appear automatically.')
        );
        fragment.append(empty);
      } else {
        events.forEach(event => fragment.append(this.#seriesCard(event, view)));
      }
      this.#seriesList.replaceChildren(fragment);
    }

    this.#seriesList.querySelectorAll<HTMLButtonElement>('[data-series-id]').forEach(button => {
      const active = button.dataset.seriesId === selection.seriesId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  #seriesCard(event: ScheduleEvent, view: DataView): HTMLButtonElement {
    const button = element('button', 'series-card');
    button.type = 'button';
    button.dataset.seriesId = event.series.id;
    button.dataset.listView = view;

    const top = element('span', 'series-card-top');
    top.append(
      element('small', undefined, event.series.competition.name),
      element('b', undefined, seriesStateLabel(event))
    );
    const teams = element('strong', 'series-card-teams');
    teams.append(
      element('span', undefined, event.series.teams[0].name),
      element('i', undefined, 'vs'),
      element('span', undefined, event.series.teams[1].name)
    );
    const meta = element('span', 'series-card-meta');
    meta.append(
      element('small', undefined, event.series.competition.stage ?? `Best of ${event.series.bestOf}`),
      element('small', undefined, `${event.series.games.length} games`)
    );
    button.append(top, teams, meta);
    return button;
  }

  #renderGameTabs(state: AppState, view: DataView): void {
    const event = selectedEvent(state, view);
    const selection = selectionForView(state, view);
    const games = event?.series.games ?? [];
    const signature = JSON.stringify({
      seriesId: event?.series.id ?? null,
      games: games.map(game => [game.id, game.number, game.state])
    });
    if (signature !== this.#gameTabsSignature) {
      this.#gameTabsSignature = signature;
      const fragment = document.createDocumentFragment();
      games.forEach(game => {
        const button = element('button');
        button.type = 'button';
        button.dataset.gameId = game.id;
        button.append(
          element('strong', undefined, `Game ${game.number}`),
          element('span', undefined, stateLabel(game.state))
        );
        fragment.append(button);
      });
      this.#gameTabs.replaceChildren(fragment);
    }
    this.#gameTabs.hidden = games.length === 0;
    this.#gameTabs.querySelectorAll<HTMLButtonElement>('[data-game-id]').forEach(button => {
      const active = button.dataset.gameId === selection.gameId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  #renderScoreboard(state: AppState, view: DataView): void {
    const event = selectedEvent(state, view);
    const game = selectedGame(state, view);
    const snapshot = game ? state.snapshots[game.id] : undefined;
    const status = game ? state.snapshotStatus[game.id] ?? 'idle' : 'idle';
    const error = game ? state.snapshotError[game.id] ?? null : null;
    const stats = snapshot?.stats ?? null;
    const effectiveState = snapshot?.game.state ?? game?.state ?? 'unknown';

    this.#scoreboard.setAttribute('aria-busy', String(status === 'loading'));
    this.#scoreboard.dataset.gameState = effectiveState;
    this.#scoreboard.dataset.gameId = game?.id ?? '';
    this.#stageEyebrow.textContent = event?.series.competition.name ?? 'Select a match';
    this.#stageTitle.textContent = event
      ? `${event.series.teams[0].name} vs ${event.series.teams[1].name}`
      : view === 'history' ? 'Match history' : 'Live scoreboard';
    this.#stageMeta.textContent = event
      ? `${event.series.competition.stage ?? `Best of ${event.series.bestOf}`} · ${formatSeriesTime(event.series.scheduledStart)}`
      : 'Choose a series from the list.';

    this.#clock.textContent = formatClock(stats?.gameClockSeconds);
    this.#gameLabel.textContent = game ? `Game ${game.number} · ${stateLabel(effectiveState)}` : 'No game selected';
    this.#gameState.textContent = effectiveState === 'completed'
      ? 'FINAL'
      : effectiveState === 'live' || effectiveState === 'draft' || effectiveState === 'paused'
        ? 'LIVE'
        : 'PENDING';
    this.#gameState.dataset.state = effectiveState;

    const blueName = stats?.blue.name ?? event?.series.teams[0].name ?? 'Blue team';
    const redName = stats?.red.name ?? event?.series.teams[1].name ?? 'Red team';
    this.#blueName.textContent = blueName;
    this.#redName.textContent = redName;
    this.#blueKills.textContent = formatNumber(stats?.blue.kills);
    this.#redKills.textContent = formatNumber(stats?.red.kills);
    this.#blueGold.textContent = compactNumber(stats?.blue.gold);
    this.#redGold.textContent = compactNumber(stats?.red.gold);

    const difference = stats?.blue.gold === null || stats?.red.gold === null || !stats
      ? null
      : stats.blue.gold - stats.red.gold;
    this.#goldLead.textContent = difference === null
      ? '—'
      : difference === 0
        ? 'EVEN'
        : `+${compactNumber(difference)}`;
    this.#goldLeadLabel.textContent = difference === null || difference === 0
      ? 'GOLD LEAD'
      : difference > 0 ? blueName : redName;
    this.#goldLead.dataset.side = difference === null || difference === 0
      ? 'neutral'
      : difference > 0 ? 'blue' : 'red';

    OBJECTIVES.forEach(key => {
      const row = requiredElement<HTMLElement>(this.#scoreboard, `[data-objective="${key}"]`);
      requiredElement<HTMLElement>(row, '[data-side="blue"]').textContent = formatNumber(objectiveValue(stats?.blue ?? null, key));
      requiredElement<HTMLElement>(row, '[data-side="red"]').textContent = formatNumber(objectiveValue(stats?.red ?? null, key));
    });

    this.#qualityText.textContent = snapshot
      ? `${snapshot.quality.freshness} · ${snapshot.quality.complete ? 'complete' : 'partial'}`
      : 'No telemetry';
    this.#scoreboardNotice.textContent = !event
      ? 'Select a match to begin.'
      : error
        ? error
        : status === 'loading' && !snapshot
          ? 'Loading the selected game…'
          : !stats
            ? 'Waiting for the provider to publish game telemetry.'
            : effectiveState === 'completed'
              ? 'Final game data is locked against stale live frames.'
              : 'Live telemetry updates without replacing this scoreboard.';
  }

  #clearTimers(): void {
    if (this.#scheduleTimer !== null) window.clearTimeout(this.#scheduleTimer);
    if (this.#snapshotTimer !== null) window.clearTimeout(this.#snapshotTimer);
    this.#scheduleTimer = null;
    this.#snapshotTimer = null;
  }
}

export function startWebV2(root: HTMLElement): WebV2App {
  const app = new WebV2App(root);
  app.start();
  return app;
}
