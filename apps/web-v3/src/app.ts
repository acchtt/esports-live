import type { GameState, ScheduleEvent, SeriesGameRef } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';
import { loadHealth, loadSchedule, loadSnapshot } from './api.ts';
import { readScheduleCache, writeScheduleCache } from './schedule-cache.ts';
import { readSnapshotCache, writeSnapshotCache } from './snapshot-cache.ts';
import { freshnessCopy } from './freshness-copy.ts';
import { seriesTeamForSide } from './side-team-resolution.ts';
import {
  AppStore,
  catalogueEntries,
  filteredCatalogueEntries,
  selectedEvent,
  selectedGame,
  selectionForView,
  type AppState,
  type AppView,
  type CatalogueEntry,
  type DataView,
  type MatchFilter
} from './state.ts';

const SCHEDULE_POLL_MS = 30_000;
const SNAPSHOT_POLL_MS = 2_000;
const BUILD_SHA = String(import.meta.env.VITE_BUILD_SHA_SHORT ?? 'local');
const DATA_VIEWS: readonly DataView[] = ['matches', 'history'];
const OBJECTIVES = ['towers', 'dragons', 'barons', 'inhibitors'] as const;
const ROLE_ORDER = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;

type ObjectiveKey = typeof OBJECTIVES[number];
type RoleKey = typeof ROLE_ORDER[number];
interface PlayerPair {
  role: RoleKey | 'player';
  blue: LolPlayerState | null;
  red: LolPlayerState | null;
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function isAppView(value: string | undefined): value is AppView {
  return value === 'matches' || value === 'match' || value === 'platform';
}

function isMatchFilter(value: string | undefined): value is MatchFilter {
  return value === 'all' || value === 'live' || value === 'upcoming' || value === 'ended';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown data error';
}

function formatSeriesTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
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

function formatKda(player: LolPlayerState | null): string {
  if (!player) return '—/—/—';
  return `${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}`;
}

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${Math.round(absolute / 1_000)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function stateLabel(state: GameState): string {
  if (state === 'completed') return 'Final';
  if (state === 'live' || state === 'draft' || state === 'paused') return 'Live';
  if (state === 'unstarted') return 'Scheduled';
  return 'Pending';
}

function seriesStateLabel(event: ScheduleEvent): string {
  if (event.series.state === 'live') return 'LIVE';
  if (event.series.state === 'paused') return 'PAUSED';
  if (event.series.state === 'completed') return 'FINAL';
  return 'UPCOMING';
}

function seriesStateClass(event: ScheduleEvent): string {
  if (event.series.state === 'live' || event.series.state === 'paused') return 'live';
  if (event.series.state === 'completed') return 'ended';
  return 'upcoming';
}

function objectiveValue(team: LolTeamState | null, key: ObjectiveKey): number | null {
  if (!team) return null;
  if (key === 'dragons') return team.objectives.dragons?.length ?? null;
  return team.objectives[key];
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

function roleKey(value: string | null | undefined): RoleKey | 'player' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('top')) return 'top';
  if (normalized.includes('jung')) return 'jungle';
  if (normalized.includes('mid')) return 'mid';
  if (normalized.includes('bot') || normalized.includes('adc') || normalized.includes('carry')) return 'bottom';
  if (normalized.includes('sup') || normalized.includes('utility')) return 'support';
  return 'player';
}

function playerPairs(blue: readonly LolPlayerState[], red: readonly LolPlayerState[]): readonly PlayerPair[] {
  const blueRemaining = [...blue];
  const redRemaining = [...red];
  const pairs: PlayerPair[] = [];

  ROLE_ORDER.forEach(role => {
    const blueIndex = blueRemaining.findIndex(player => roleKey(player.role) === role);
    const redIndex = redRemaining.findIndex(player => roleKey(player.role) === role);
    if (blueIndex < 0 && redIndex < 0) return;
    const bluePlayer = blueIndex >= 0 ? blueRemaining.splice(blueIndex, 1)[0] ?? null : null;
    const redPlayer = redIndex >= 0 ? redRemaining.splice(redIndex, 1)[0] ?? null : null;
    pairs.push({ role, blue: bluePlayer, red: redPlayer });
  });

  const remainder = Math.max(blueRemaining.length, redRemaining.length);
  for (let index = 0; index < remainder; index += 1) {
    pairs.push({
      role: 'player',
      blue: blueRemaining[index] ?? null,
      red: redRemaining[index] ?? null
    });
  }

  return pairs;
}

function championKey(value: string): string | null {
  const key = value.replace(/[^a-z0-9]/gi, '');
  if (!key || /^\d+$/.test(key)) return null;
  return ({
    Wukong: 'MonkeyKing',
    NunuWillump: 'Nunu',
    RenataGlasc: 'Renata'
  } as Record<string, string>)[key] ?? key;
}

function championImage(championId: string | null): string | null {
  const value = String(championId ?? '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons/${encodeURIComponent(value)}.png`;
  }
  const key = championKey(value);
  return key
    ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${encodeURIComponent(key)}_0.jpg`
    : null;
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

function teamTag(name: string, code: string | null | undefined): string {
  if (code?.trim()) return code.trim();
  const words = name.split(/\s+/).filter(Boolean);
  const leadingCode = words[0]?.trim() ?? '';
  if (/^[A-Z0-9]{2,5}$/.test(leadingCode)) return leadingCode;
  return words.length > 1
    ? words.map(word => word[0]?.toUpperCase() ?? '').join('').slice(0, 4)
    : name.slice(0, 4).toUpperCase();
}

function sideTeamName(
  event: ScheduleEvent | null,
  statsTeam: LolTeamState | null,
  fallbackIndex: 0 | 1,
  fallback: string
): string {
  return seriesTeamForSide(event, statsTeam, fallbackIndex)?.name
    ?? statsTeam?.name
    ?? event?.series.teams[fallbackIndex]?.name
    ?? fallback;
}

function sideTeamTag(
  event: ScheduleEvent | null,
  statsTeam: LolTeamState | null,
  fallbackIndex: 0 | 1,
  fallback: string
): string {
  const seriesTeam = seriesTeamForSide(event, statsTeam, fallbackIndex);
  const name = seriesTeam?.name ?? statsTeam?.name ?? event?.series.teams[fallbackIndex]?.name ?? fallback;
  return teamTag(name, seriesTeam?.code);
}

function playerDisplayName(player: LolPlayerState | null, tag: string): string {
  const handle = player?.handle?.trim() || 'Player';
  const normalized = handle.toLowerCase();
  return normalized.startsWith(tag.toLowerCase()) ? handle : `${tag} ${handle}`;
}

function laneGoldDifference(blue: LolPlayerState | null, red: LolPlayerState | null): number | null {
  if (blue?.totalGold === null || blue?.totalGold === undefined) return null;
  if (red?.totalGold === null || red?.totalGold === undefined) return null;
  return blue.totalGold - red.totalGold;
}

function signedDifference(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return 'EVEN';
  return `+${Math.abs(value).toLocaleString()}`;
}

function seriesProgress(event: ScheduleEvent): string {
  const completed = event.series.games.filter(game => game.state === 'completed').length;
  if (event.series.state === 'completed') return `${completed} games completed`;
  if (event.series.state === 'live' || event.series.state === 'paused') {
    const live = event.series.games.find(game => game.state === 'live' || game.state === 'paused' || game.state === 'draft');
    return live ? `Game ${live.number} in progress` : `${completed} games completed`;
  }
  return `Best of ${event.series.bestOf}`;
}

export class WebV2App {
  readonly #store = new AppStore();
  readonly #root: HTMLElement;
  readonly #shell: HTMLElement;
  readonly #cataloguePanel: HTMLElement;
  readonly #matchPanel: HTMLElement;
  readonly #platformPanel: HTMLElement;
  readonly #catalogueGrid: HTMLElement;
  readonly #catalogueMeta: HTMLElement;
  readonly #refreshButton: HTMLButtonElement;
  readonly #detailCompetition: HTMLElement;
  readonly #detailTitle: HTMLElement;
  readonly #detailMeta: HTMLElement;
  readonly #gameTabs: HTMLElement;
  readonly #scoreboard: HTMLElement;
  readonly #clock: HTMLElement;
  readonly #gameLabel: HTMLElement;
  readonly #blueName: HTMLElement;
  readonly #redName: HTMLElement;
  readonly #blueKills: HTMLElement;
  readonly #redKills: HTMLElement;
  readonly #goldLead: HTMLElement;
  readonly #goldLeadLabel: HTMLElement;
  readonly #playerBoard: HTMLElement;
  readonly #qualityText: HTMLElement;
  readonly #scoreboardNotice: HTMLElement;
  readonly #connectionPill: HTMLElement;
  readonly #connectionText: HTMLElement;
  #catalogueSignature = '';
  #gameTabsSignature = '';
  #playerSignature = '';
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
          <a class="brand-lockup" href="#" data-app-view="matches" aria-label="Esports Live matches">
            <span class="brand-mark" aria-hidden="true">EL</span>
            <strong>Esports Live</strong>
          </a>
          <div class="header-actions">
            <div class="connection-pill" data-status="connecting" title="Connecting">
              <i aria-hidden="true"></i><span>Connecting</span>
            </div>
            <span class="build-pill">V2 · ${BUILD_SHA}</span>
            <a class="legacy-link" href="../">Current site</a>
          </div>
        </header>

        <main class="app-main">
          <section id="catalogue-panel" class="catalogue-panel">
            <header class="catalogue-header">
              <div>
                <span>LEAGUE OF LEGENDS</span>
                <h1>All matches</h1>
                <p id="catalogue-meta">Loading live, upcoming and ended matches…</p>
              </div>
              <button id="refresh-data" class="refresh-button" type="button" aria-label="Refresh matches">↻</button>
            </header>
            <div class="match-filters" aria-label="Match filters">
              <button type="button" data-match-filter="all">All</button>
              <button type="button" data-match-filter="live">Live</button>
              <button type="button" data-match-filter="upcoming">Upcoming</button>
              <button type="button" data-match-filter="ended">Ended</button>
            </div>
            <div id="catalogue-grid" class="catalogue-grid" aria-live="polite"></div>
          </section>

          <section id="match-panel" class="match-panel" hidden>
            <header class="detail-header">
              <button type="button" class="back-button" data-app-view="matches" aria-label="Back to all matches">←</button>
              <div>
                <span id="detail-competition">MATCH DETAILS</span>
                <h1 id="detail-title">Select a match</h1>
                <p id="detail-meta">Live and final game statistics</p>
              </div>
            </header>

            <div id="game-tabs" class="game-tabs" aria-label="Game selection"></div>

            <article id="scoreboard" class="scoreboard" data-component="scoreboard" aria-busy="false">
              <header class="scoreboard-header">
                <strong id="game-clock">--:--</strong>
                <span id="game-label">No game selected</span>
              </header>

              <div id="quality-text" class="telemetry-freshness" data-status="empty" role="status" aria-live="polite">
                WAITING FOR TELEMETRY
              </div>

              <section class="team-banner" aria-label="Team summary">
                <article class="team-side blue">
                  <span>BLUE SIDE</span>
                  <strong id="blue-name">Blue team</strong>
                  <p><small>KILLS</small><b id="blue-kills">—</b></p>
                </article>
                <article class="gold-card">
                  <span id="gold-lead-label">GOLD LEAD</span>
                  <strong id="gold-lead">—</strong>
                </article>
                <article class="team-side red">
                  <span>RED SIDE</span>
                  <strong id="red-name">Red team</strong>
                  <p><small>KILLS</small><b id="red-kills">—</b></p>
                </article>
              </section>

              <section class="objective-grid" aria-label="Objectives">
                <article data-objective="towers"><span>TOWERS</span><strong><b data-side="blue">—</b><i>−</i><b data-side="red">—</b></strong></article>
                <article data-objective="dragons"><span>DRAGONS</span><strong><b data-side="blue">—</b><i>−</i><b data-side="red">—</b></strong></article>
                <article data-objective="barons"><span>BARONS</span><strong><b data-side="blue">—</b><i>−</i><b data-side="red">—</b></strong></article>
                <article data-objective="inhibitors"><span>INHIBITORS</span><strong><b data-side="blue">—</b><i>−</i><b data-side="red">—</b></strong></article>
              </section>

              <section id="player-board" class="player-board" aria-label="Player statistics"></section>

              <footer class="scoreboard-footer">
                <span id="scoreboard-notice">Choose a match from the list.</span>
              </footer>
            </article>
          </section>

          <section id="platform-panel" class="platform-panel" hidden>
            <span>PLATFORM</span>
            <h1>One match experience</h1>
            <p>The rebuilt frontend uses one complete match catalogue and one persistent statistics panel for live and ended games.</p>
            <div class="platform-grid">
              <article><strong>All matches</strong><span>Live, upcoming and completed series share one searchable index.</span></article>
              <article><strong>Stable live stats</strong><span>Game changes update the mounted board without rebuilding the page.</span></article>
            </div>
          </section>
        </main>

        <nav class="mobile-nav" aria-label="Application navigation">
          <button type="button" data-app-view="matches"><span aria-hidden="true">▤</span><strong>Matches</strong></button>
          <button type="button" data-app-view="match"><span aria-hidden="true">▥</span><strong>Match</strong></button>
          <button type="button" data-app-view="platform"><span aria-hidden="true">☼</span><strong>Platform</strong></button>
        </nav>
      </div>`;

    this.#shell = requiredElement(this.#root, '.v2-shell');
    this.#cataloguePanel = requiredElement(this.#root, '#catalogue-panel');
    this.#matchPanel = requiredElement(this.#root, '#match-panel');
    this.#platformPanel = requiredElement(this.#root, '#platform-panel');
    this.#catalogueGrid = requiredElement(this.#root, '#catalogue-grid');
    this.#catalogueMeta = requiredElement(this.#root, '#catalogue-meta');
    this.#refreshButton = requiredElement(this.#root, '#refresh-data');
    this.#detailCompetition = requiredElement(this.#root, '#detail-competition');
    this.#detailTitle = requiredElement(this.#root, '#detail-title');
    this.#detailMeta = requiredElement(this.#root, '#detail-meta');
    this.#gameTabs = requiredElement(this.#root, '#game-tabs');
    this.#scoreboard = requiredElement(this.#root, '#scoreboard');
    this.#clock = requiredElement(this.#root, '#game-clock');
    this.#gameLabel = requiredElement(this.#root, '#game-label');
    this.#blueName = requiredElement(this.#root, '#blue-name');
    this.#redName = requiredElement(this.#root, '#red-name');
    this.#blueKills = requiredElement(this.#root, '#blue-kills');
    this.#redKills = requiredElement(this.#root, '#red-kills');
    this.#goldLead = requiredElement(this.#root, '#gold-lead');
    this.#goldLeadLabel = requiredElement(this.#root, '#gold-lead-label');
    this.#playerBoard = requiredElement(this.#root, '#player-board');
    this.#qualityText = requiredElement(this.#root, '#quality-text');
    this.#scoreboardNotice = requiredElement(this.#root, '#scoreboard-notice');
    this.#connectionPill = requiredElement(this.#root, '.connection-pill');
    this.#connectionText = requiredElement(this.#connectionPill, 'span');

    this.#root.addEventListener('click', event => this.#handleClick(event));
    this.#store.subscribe((state, previous) => this.#stateChanged(state, previous));
    this.#render(this.#store.getState());
  }

  start(): void {
    this.#hydrateCachedSchedules();
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

    const viewButton = target.closest<HTMLElement>('[data-app-view]');
    if (viewButton && isAppView(viewButton.dataset.appView)) {
      event.preventDefault();
      this.#store.dispatch({ type: 'set-view', view: viewButton.dataset.appView });
      return;
    }

    const filterButton = target.closest<HTMLButtonElement>('button[data-match-filter]');
    if (filterButton && isMatchFilter(filterButton.dataset.matchFilter)) {
      this.#store.dispatch({ type: 'set-filter', filter: filterButton.dataset.matchFilter });
      return;
    }

    const seriesButton = target.closest<HTMLElement>('[data-series-id][data-source-view]');
    const sourceView = seriesButton?.dataset.sourceView;
    const seriesId = seriesButton?.dataset.seriesId;
    if (seriesButton && (sourceView === 'matches' || sourceView === 'history') && seriesId) {
      this.#store.dispatch({ type: 'select-series', view: sourceView, seriesId });
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }

    const gameButton = target.closest<HTMLElement>('[data-game-id]');
    const state = this.#store.getState();
    if (gameButton?.dataset.gameId) {
      this.#store.dispatch({
        type: 'select-game',
        view: state.detailView,
        gameId: gameButton.dataset.gameId
      });
      return;
    }

    if (target.closest('#refresh-data')) void this.#refreshSchedules();
  }

  #stateChanged(state: AppState, previous: AppState): void {
    this.#render(state);
    const game = state.activeView === 'match' ? selectedGame(state) : null;
    const previousGame = previous.activeView === 'match' ? selectedGame(previous) : null;
    const nextKey = game ? `${state.detailView}:${game.id}` : '';
    const previousKey = previousGame ? `${previous.detailView}:${previousGame.id}` : '';
    if (nextKey !== previousKey || nextKey !== this.#selectionKey) {
      this.#selectionKey = nextKey;
      this.#syncSnapshot(true);
    }
  }

  #hydrateCachedSchedules(): void {
    DATA_VIEWS.forEach(view => {
      const events = readScheduleCache(view);
      if (events) this.#store.dispatch({ type: 'schedule-loaded', view, events });
    });
  }

  async #connect(): Promise<void> {
    const schedules = this.#refreshSchedules();
    try {
      const health = await loadHealth();
      if (!health.ok || !health.adapters.includes('lol')) {
        this.#store.dispatch({
          type: 'set-connection',
          status: 'offline',
          message: 'LoL data adapter unavailable'
        });
      } else {
        this.#store.dispatch({
          type: 'set-connection',
          status: 'online',
          message: `API online · schema ${health.schemaVersion}`
        });
      }
    } catch (error) {
      this.#store.dispatch({
        type: 'set-connection',
        status: 'offline',
        message: errorMessage(error)
      });
    }
    await schedules;
  }

  async #refreshSchedules(): Promise<void> {
    this.#scheduleController?.abort();
    this.#scheduleController = new AbortController();
    const signal = this.#scheduleController.signal;
    const current = this.#store.getState();
    DATA_VIEWS.forEach(view => {
      if (!current.events[view].length) {
        this.#store.dispatch({ type: 'schedule-loading', view });
      }
    });

    await Promise.all(DATA_VIEWS.map(async view => {
      try {
        const events = await loadSchedule(view, signal);
        writeScheduleCache(view, events);
        this.#store.dispatch({ type: 'schedule-loaded', view, events });
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
    if (state.activeView !== 'match' || document.hidden) return;
    const game = selectedGame(state);
    if (!game) return;

    const delay = immediate ? 0 : SNAPSHOT_POLL_MS;
    this.#snapshotTimer = window.setTimeout(
      () => void this.#requestSnapshot(state.detailView, game),
      delay
    );
  }

  async #requestSnapshot(view: DataView, game: SeriesGameRef): Promise<void> {
    this.#snapshotController?.abort();
    this.#snapshotController = new AbortController();
    const signal = this.#snapshotController.signal;
    let state = this.#store.getState();
    if (!state.snapshots[game.id]) {
      const persisted = readSnapshotCache(game.id);
      if (persisted) {
        this.#store.dispatch({ type: 'snapshot-received', snapshot: persisted });
        state = this.#store.getState();
      }
    }
    const cached = state.snapshots[game.id];
    const after = game.state === 'completed' ? null : cached?.quality.sourceTimestamp ?? null;
    this.#store.dispatch({ type: 'snapshot-loading', gameId: game.id });

    try {
      const snapshot = await loadSnapshot(game.id, after, signal);
      writeSnapshotCache(snapshot);
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
    const currentState = this.#store.getState();
    const currentGame = selectedGame(currentState);
    const snapshot = currentState.snapshots[game.id];
    if (
      currentState.activeView === 'match'
      && currentState.detailView === view
      && currentGame?.id === game.id
      && snapshot?.game.state !== 'completed'
    ) {
      this.#syncSnapshot(false);
    }
  }

  #render(state: AppState): void {
    this.#shell.dataset.view = state.activeView;
    this.#cataloguePanel.hidden = state.activeView !== 'matches';
    this.#matchPanel.hidden = state.activeView !== 'match';
    this.#platformPanel.hidden = state.activeView !== 'platform';
    this.#renderNavigation(state);
    this.#renderConnection(state);
    this.#renderCatalogue(state);
    this.#renderDetail(state);
  }

  #renderNavigation(state: AppState): void {
    this.#root.querySelectorAll<HTMLElement>('[data-app-view]').forEach(button => {
      const active = button.dataset.appView === state.activeView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    this.#root.querySelectorAll<HTMLButtonElement>('[data-match-filter]').forEach(button => {
      const active = button.dataset.matchFilter === state.matchFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  #renderConnection(state: AppState): void {
    this.#connectionPill.dataset.status = state.connectionStatus;
    this.#connectionPill.title = state.connectionMessage;
    this.#connectionText.textContent = state.connectionStatus === 'online'
      ? 'Live data'
      : state.connectionStatus === 'offline'
        ? 'Offline'
        : 'Connecting';
  }

  #renderCatalogue(state: AppState): void {
    const allEntries = catalogueEntries(state);
    const entries = filteredCatalogueEntries(state);
    const loading = DATA_VIEWS.some(view => state.scheduleStatus[view] === 'loading');
    const errors = DATA_VIEWS
      .map(view => state.scheduleError[view])
      .filter((value): value is string => Boolean(value));

    this.#catalogueMeta.textContent = loading && !allEntries.length
      ? 'Loading live, upcoming and ended matches…'
      : errors.length && !allEntries.length
        ? errors.join(' · ')
        : `${allEntries.length} matches · ${entries.length} shown`;

    const signature = JSON.stringify({
      filter: state.matchFilter,
      status: state.scheduleStatus,
      entries: entries.map(({ event, view }) => [
        view,
        event.series.id,
        event.series.state,
        event.series.scheduledStart,
        event.series.teams[0].name,
        event.series.teams[1].name,
        event.series.games.map(game => `${game.id}:${game.state}`).join('|')
      ])
    });
    if (signature === this.#catalogueSignature) return;
    this.#catalogueSignature = signature;

    const fragment = document.createDocumentFragment();
    if (!entries.length) {
      const empty = element('div', 'catalogue-empty');
      empty.append(
        element('strong', undefined, loading ? 'Loading matches…' : 'No matches in this filter'),
        element('span', undefined, errors[0] ?? 'Choose another filter or refresh the schedule.')
      );
      fragment.append(empty);
    } else {
      entries.forEach(entry => fragment.append(this.#matchCard(entry)));
    }
    this.#catalogueGrid.replaceChildren(fragment);
  }

  #matchCard(entry: CatalogueEntry): HTMLButtonElement {
    const { event, view } = entry;
    const button = element('button', 'match-card');
    button.type = 'button';
    button.dataset.seriesId = event.series.id;
    button.dataset.sourceView = view;

    const top = element('span', 'match-card-top');
    top.append(
      element('small', undefined, event.series.competition.name),
      element('b', `match-status ${seriesStateClass(event)}`, seriesStateLabel(event))
    );

    const teams = element('span', 'match-card-teams');
    const blue = element('strong');
    blue.append(
      element('i', undefined, event.series.teams[0].code ?? teamTag(event.series.teams[0].name, null)),
      element('span', undefined, event.series.teams[0].name)
    );
    const red = element('strong');
    red.append(
      element('i', undefined, event.series.teams[1].code ?? teamTag(event.series.teams[1].name, null)),
      element('span', undefined, event.series.teams[1].name)
    );
    teams.append(blue, element('em', undefined, 'VS'), red);

    const bottom = element('span', 'match-card-bottom');
    bottom.append(
      element('small', undefined, `${formatSeriesTime(event.series.scheduledStart)} · ${seriesProgress(event)}`),
      element('strong', undefined, 'Open match →')
    );
    button.append(top, teams, bottom);
    button.setAttribute(
      'aria-label',
      `${event.series.teams[0].name} versus ${event.series.teams[1].name}, ${seriesStateLabel(event)}`
    );
    return button;
  }

  #renderDetail(state: AppState): void {
    const event = selectedEvent(state);
    const game = selectedGame(state);
    const snapshot = game ? state.snapshots[game.id] : undefined;
    const status = game ? state.snapshotStatus[game.id] ?? 'idle' : 'idle';
    const error = game ? state.snapshotError[game.id] ?? null : null;
    const stats = snapshot?.stats ?? null;
    const effectiveState: GameState = snapshot?.game.state ?? game?.state ?? 'unknown';

    this.#detailCompetition.textContent = event?.series.competition.name ?? 'MATCH DETAILS';
    this.#detailTitle.textContent = event
      ? `${event.series.teams[0].name} vs ${event.series.teams[1].name}`
      : 'Select a match';
    this.#detailMeta.textContent = event
      ? `${event.series.competition.stage ?? `Best of ${event.series.bestOf}`} · ${formatSeriesTime(event.series.scheduledStart)}`
      : 'Choose a match from the complete list.';

    this.#renderGameTabs(state, event);
    this.#scoreboard.setAttribute('aria-busy', String(status === 'loading'));
    this.#scoreboard.dataset.gameState = effectiveState;
    this.#scoreboard.dataset.gameId = game?.id ?? '';
    this.#clock.textContent = formatClock(stats?.gameClockSeconds);
    this.#gameLabel.textContent = game
      ? `Game ${game.number} · ${stateLabel(effectiveState)}`
      : 'No game selected';

    const blueName = sideTeamName(event, stats?.blue ?? null, 0, 'Blue team');
    const redName = sideTeamName(event, stats?.red ?? null, 1, 'Red team');
    this.#blueName.textContent = blueName;
    this.#redName.textContent = redName;
    this.#blueKills.textContent = formatNumber(stats?.blue.kills);
    this.#redKills.textContent = formatNumber(stats?.red.kills);

    const difference = stats?.blue.gold === null || stats?.red.gold === null || !stats
      ? null
      : stats.blue.gold - stats.red.gold;
    this.#goldLead.textContent = difference === null
      ? '—'
      : difference === 0
        ? 'EVEN'
        : `+${compactNumber(difference)}`;
    this.#goldLeadLabel.textContent = 'GOLD LEAD';
    this.#goldLead.dataset.side = difference === null || difference === 0
      ? 'neutral'
      : difference > 0 ? 'blue' : 'red';

    OBJECTIVES.forEach(key => {
      const card = requiredElement<HTMLElement>(this.#scoreboard, `[data-objective="${key}"]`);
      requiredElement<HTMLElement>(card, '[data-side="blue"]').textContent = formatNumber(
        objectiveValue(stats?.blue ?? null, key)
      );
      requiredElement<HTMLElement>(card, '[data-side="red"]').textContent = formatNumber(
        objectiveValue(stats?.red ?? null, key)
      );
    });

    this.#renderPlayers(event, stats);
    const freshness = freshnessCopy(snapshot?.quality ?? null, effectiveState);
    this.#qualityText.textContent = freshness.text;
    this.#qualityText.dataset.status = freshness.status;
    this.#qualityText.title = freshness.title;
    this.#scoreboardNotice.textContent = !event
      ? 'Choose a match from the list.'
      : error
        ? error
        : status === 'loading' && !snapshot
          ? 'Loading the selected game…'
          : !stats
            ? 'Waiting for the provider to publish game telemetry.'
            : effectiveState === 'completed'
              ? 'Final statistics are locked against stale live frames.'
              : 'Live statistics refresh without replacing this panel.';
  }

  #renderGameTabs(state: AppState, event: ScheduleEvent | null): void {
    const selection = selectionForView(state, state.detailView);
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
    this.#gameTabs.hidden = games.length <= 1;
    this.#gameTabs.querySelectorAll<HTMLButtonElement>('[data-game-id]').forEach(button => {
      const active = button.dataset.gameId === selection.gameId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  #renderPlayers(event: ScheduleEvent | null, stats: LolStats | null): void {
    const bluePlayers = stats?.blue.players ?? [];
    const redPlayers = stats?.red.players ?? [];
    const pairs = playerPairs(bluePlayers, redPlayers);
    const signature = JSON.stringify({
      series: event?.series.id ?? null,
      blueTeam: stats?.blue.id ?? null,
      redTeam: stats?.red.id ?? null,
      blue: bluePlayers,
      red: redPlayers
    });
    if (signature === this.#playerSignature) return;
    this.#playerSignature = signature;

    if (!pairs.length) {
      const empty = element('div', 'player-board-empty');
      empty.append(
        element('strong', undefined, 'Player statistics pending'),
        element('span', undefined, 'Champion, KDA and lane gold data will appear when the provider publishes it.')
      );
      this.#playerBoard.replaceChildren(empty);
      return;
    }

    const blueTag = sideTeamTag(event, stats?.blue ?? null, 0, 'Blue');
    const redTag = sideTeamTag(event, stats?.red ?? null, 1, 'Red');
    const fragment = document.createDocumentFragment();
    pairs.forEach(pair => fragment.append(this.#playerRow(pair, blueTag, redTag)));
    this.#playerBoard.replaceChildren(fragment);
  }

  #playerRow(pair: PlayerPair, blueTag: string, redTag: string): HTMLElement {
    const row = element('article', 'player-row');
    row.dataset.role = pair.role;

    const blue = element('div', 'player-side blue-player');
    blue.append(
      this.#championPortrait(pair.blue),
      this.#playerCopy(pair.blue, blueTag, 'blue')
    );

    const difference = laneGoldDifference(pair.blue, pair.red);
    const lead = element('div', 'lane-gold', signedDifference(difference));
    lead.dataset.side = difference === null || difference === 0
      ? 'neutral'
      : difference > 0 ? 'blue' : 'red';

    const red = element('div', 'player-side red-player');
    red.append(
      this.#playerCopy(pair.red, redTag, 'red'),
      this.#championPortrait(pair.red)
    );

    row.append(blue, lead, red);
    return row;
  }

  #playerCopy(player: LolPlayerState | null, tag: string, side: 'blue' | 'red'): HTMLElement {
    const copy = element('div', `player-copy ${side}`);
    copy.append(
      element('strong', undefined, playerDisplayName(player, tag)),
      element('span', undefined, formatKda(player))
    );
    return copy;
  }

  #championPortrait(player: LolPlayerState | null): HTMLElement {
    const frame = element('div', 'champion-portrait');
    const fallback = element(
      'span',
      undefined,
      initials(player?.championId ?? player?.handle ?? 'Player')
    );
    const source = championImage(player?.championId ?? null);
    if (source) {
      const image = element('img');
      image.src = source;
      image.alt = player?.championId ? `${player.championId} champion portrait` : 'Champion portrait';
      image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      frame.append(image);
    }
    frame.append(fallback);
    return frame;
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
