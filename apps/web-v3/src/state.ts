import type {
  GameState,
  LiveSnapshot,
  ScheduleEvent,
  SeriesGameRef
} from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

export type AppView = 'matches' | 'match' | 'platform';
export type DataView = 'matches' | 'history';
export type MatchFilter = 'all' | 'live' | 'upcoming' | 'ended';
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface SelectionState {
  seriesId: string | null;
  gameId: string | null;
}

export interface CatalogueEntry {
  event: ScheduleEvent;
  view: DataView;
}

export interface AppState {
  activeView: AppView;
  matchFilter: MatchFilter;
  detailView: DataView;
  connectionStatus: ConnectionStatus;
  connectionMessage: string;
  events: Record<DataView, readonly ScheduleEvent[]>;
  scheduleStatus: Record<DataView, LoadStatus>;
  scheduleError: Record<DataView, string | null>;
  selections: Record<DataView, SelectionState>;
  snapshots: Readonly<Record<string, LiveSnapshot<LolStats>>>;
  snapshotStatus: Readonly<Record<string, LoadStatus>>;
  snapshotError: Readonly<Record<string, string | null>>;
}

export type AppAction =
  | { type: 'set-view'; view: AppView }
  | { type: 'set-filter'; filter: MatchFilter }
  | { type: 'set-connection'; status: ConnectionStatus; message: string }
  | { type: 'schedule-loading'; view: DataView }
  | { type: 'schedule-loaded'; view: DataView; events: readonly ScheduleEvent[] }
  | { type: 'schedule-failed'; view: DataView; message: string }
  | { type: 'select-series'; view: DataView; seriesId: string }
  | { type: 'select-game'; view: DataView; gameId: string }
  | { type: 'snapshot-loading'; gameId: string }
  | { type: 'snapshot-received'; snapshot: LiveSnapshot<LolStats> }
  | { type: 'snapshot-failed'; gameId: string; message: string };

const EMPTY_SELECTION: SelectionState = { seriesId: null, gameId: null };
const LAZY_HISTORY_GAME_PREFIX = 'series-history:';
const RECOVERED_SNAPSHOT_EVENT = 'esports-live:v2-recovered-snapshot';

const GAME_STATE_RANK: Record<GameState, number> = {
  unknown: 0,
  unstarted: 1,
  draft: 2,
  live: 3,
  paused: 3,
  completed: 4
};

export const initialState: AppState = {
  activeView: 'matches',
  matchFilter: 'all',
  detailView: 'matches',
  connectionStatus: 'connecting',
  connectionMessage: 'Connecting to the live data service…',
  events: {
    matches: [],
    history: []
  },
  scheduleStatus: {
    matches: 'idle',
    history: 'idle'
  },
  scheduleError: {
    matches: null,
    history: null
  },
  selections: {
    matches: EMPTY_SELECTION,
    history: EMPTY_SELECTION
  },
  snapshots: {},
  snapshotStatus: {},
  snapshotError: {}
};

function isLazyHistoryGameId(gameId: string | null | undefined): boolean {
  return Boolean(gameId?.startsWith(LAZY_HISTORY_GAME_PREFIX));
}

function snapshotTime(snapshot: LiveSnapshot<LolStats>): number {
  const value = snapshot.quality.sourceTimestamp ?? snapshot.quality.observedAt;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeSnapshot(
  existing: LiveSnapshot<LolStats> | undefined,
  incoming: LiveSnapshot<LolStats>
): LiveSnapshot<LolStats> {
  if (!existing) return incoming;

  const existingRank = GAME_STATE_RANK[existing.game.state];
  const incomingRank = GAME_STATE_RANK[incoming.game.state];
  if (existing.game.state === 'completed' && incoming.game.state !== 'completed') {
    return existing;
  }
  if (snapshotTime(incoming) < snapshotTime(existing) && incomingRank <= existingRank) {
    return existing;
  }
  if (incomingRank >= existingRank) return incoming;

  const retainedState = existing.game.state;
  return {
    ...incoming,
    game: {
      ...incoming.game,
      state: retainedState
    },
    series: {
      ...incoming.series,
      state: retainedState === 'completed' ? 'completed' : incoming.series.state,
      games: incoming.series.games.map(game => game.id === incoming.game.id
        ? { ...game, state: retainedState }
        : game)
    }
  };
}

function preferredGame(event: ScheduleEvent, _view: DataView): SeriesGameRef | null {
  const games = event.series.games;
  if (event.series.state === 'completed') {
    return [...games].reverse().find(game => game.state === 'completed') ?? games.at(-1) ?? null;
  }
  return games.find(game => game.state === 'live')
    ?? games.find(game => game.state === 'draft' || game.state === 'paused')
    ?? games.find(game => game.state === 'unstarted' || game.state === 'unknown')
    ?? [...games].reverse().find(game => game.state === 'completed')
    ?? games[0]
    ?? null;
}

function selectionForEvents(
  events: readonly ScheduleEvent[],
  previous: SelectionState,
  view: DataView
): SelectionState {
  const event = events.find(item => item.series.id === previous.seriesId) ?? events[0] ?? null;
  if (!event) return EMPTY_SELECTION;
  const game = event.series.games.find(item => item.id === previous.gameId)
    ?? preferredGame(event, view);
  return {
    seriesId: event.series.id,
    gameId: game?.id ?? null
  };
}

function latestSnapshotForSeries(
  snapshots: Readonly<Record<string, LiveSnapshot<LolStats>>>,
  seriesId: string
): LiveSnapshot<LolStats> | null {
  let latest: LiveSnapshot<LolStats> | null = null;
  Object.values(snapshots).forEach(snapshot => {
    if (snapshot.series.id !== seriesId) return;
    if (!latest) {
      latest = snapshot;
      return;
    }

    const snapshotTimestamp = snapshotTime(snapshot);
    const latestTimestamp = snapshotTime(latest);
    if (
      snapshotTimestamp > latestTimestamp
      || (snapshotTimestamp === latestTimestamp
        && GAME_STATE_RANK[snapshot.game.state] > GAME_STATE_RANK[latest.game.state])
    ) {
      latest = snapshot;
    }
  });
  return latest;
}

function isActiveSnapshot(snapshot: LiveSnapshot<LolStats> | null): snapshot is LiveSnapshot<LolStats> {
  return snapshot?.game.state === 'live'
    || snapshot?.game.state === 'draft'
    || snapshot?.game.state === 'paused';
}

function mergeScheduleEvents(
  previous: readonly ScheduleEvent[],
  incoming: readonly ScheduleEvent[],
  snapshots: Readonly<Record<string, LiveSnapshot<LolStats>>>,
  pinnedSeriesId: string | null = null
): readonly ScheduleEvent[] {
  const merged: ScheduleEvent[] = incoming.map(event => {
    const latestSnapshot = latestSnapshotForSeries(snapshots, event.series.id);
    if (event.series.state !== 'completed' && isActiveSnapshot(latestSnapshot)) {
      const activeSeriesState = latestSnapshot.game.state === 'paused' ? 'paused' : 'live';
      return {
        ...event,
        series: {
          ...event.series,
          state: activeSeriesState,
          games: latestSnapshot.series.games
        }
      };
    }

    const existing = previous.find(item => item.series.id === event.series.id);
    if (!existing) return event;
    const incomingOnlyHasLazyGame = event.series.games.length > 0
      && event.series.games.every(game => isLazyHistoryGameId(game.id));
    const existingHasCanonicalGames = existing.series.games.some(game => (
      !isLazyHistoryGameId(game.id)
    ));
    if (!incomingOnlyHasLazyGame || !existingHasCanonicalGames) return event;
    return {
      ...event,
      series: {
        ...event.series,
        games: existing.series.games
      }
    };
  });

  if (!pinnedSeriesId || merged.some(event => event.series.id === pinnedSeriesId)) return merged;
  const pinnedEvent = previous.find(event => event.series.id === pinnedSeriesId);
  return pinnedEvent ? [...merged, pinnedEvent] : merged;
}

function catalogueStateRank(event: ScheduleEvent): number {
  if (event.series.state === 'live' || event.series.state === 'paused') return 0;
  if (event.series.state === 'completed') return 2;
  return 1;
}

function isActiveEvent(event: ScheduleEvent): boolean {
  return event.series.state === 'live' || event.series.state === 'paused';
}

function shouldReplaceCatalogueEntry(
  current: CatalogueEntry,
  event: ScheduleEvent,
  view: DataView
): boolean {
  const currentCompleted = current.event.series.state === 'completed';
  const nextCompleted = event.series.state === 'completed';

  // A completed history record is stronger catalogue evidence than a stale
  // active copy from the matches feed. False between-game completions are
  // normalized back to Live when they still carry an active game, and the LPL
  // recovery controller can also resurrect them from fresh telemetry.
  if (currentCompleted !== nextCompleted) return nextCompleted;

  const currentActive = isActiveEvent(current.event);
  const nextActive = isActiveEvent(event);
  if (currentActive !== nextActive) return nextActive;

  if (nextCompleted) return view === 'history' && current.view !== 'history';
  return view === 'matches' && current.view !== 'matches';
}

function catalogueTime(entry: CatalogueEntry): number {
  const value = Date.parse(entry.event.series.scheduledStart);
  return Number.isFinite(value) ? value : 0;
}

export function catalogueEntries(state: AppState): readonly CatalogueEntry[] {
  const entries = new Map<string, CatalogueEntry>();
  (['matches', 'history'] as const).forEach(view => {
    state.events[view].forEach(event => {
      const current = entries.get(event.series.id);
      if (!current || shouldReplaceCatalogueEntry(current, event, view)) {
        entries.set(event.series.id, { event, view });
      }
    });
  });

  return [...entries.values()].sort((left, right) => {
    const stateDifference = catalogueStateRank(left.event) - catalogueStateRank(right.event);
    if (stateDifference) return stateDifference;
    if (left.event.series.state === 'completed') return catalogueTime(right) - catalogueTime(left);
    return catalogueTime(left) - catalogueTime(right);
  });
}

export function filteredCatalogueEntries(state: AppState): readonly CatalogueEntry[] {
  const entries = catalogueEntries(state);
  if (state.matchFilter === 'all') return entries;
  return entries.filter(({ event }) => {
    const seriesState = event.series.state;
    if (state.matchFilter === 'live') return seriesState === 'live' || seriesState === 'paused';
    if (state.matchFilter === 'ended') return seriesState === 'completed';
    return seriesState !== 'live' && seriesState !== 'paused' && seriesState !== 'completed';
  });
}

export function selectionForView(state: AppState, view: DataView): SelectionState {
  return state.selections[view];
}

export function selectedEvent(state: AppState): ScheduleEvent | null {
  const selection = selectionForView(state, state.detailView);
  return state.events[state.detailView].find(event => event.series.id === selection.seriesId) ?? null;
}

export function selectedGame(state: AppState): SeriesGameRef | null {
  const event = selectedEvent(state);
  const selection = selectionForView(state, state.detailView);
  return event?.series.games.find(game => game.id === selection.gameId) ?? null;
}

function eventsWithSnapshotSeries(
  events: readonly ScheduleEvent[],
  snapshot: LiveSnapshot<LolStats>
): readonly ScheduleEvent[] {
  return events.map(event => event.series.id !== snapshot.series.id
    ? event
    : {
        ...event,
        series: {
          ...event.series,
          state: snapshot.series.state,
          games: snapshot.series.games
        }
      });
}

function selectionWithSnapshotGame(
  selection: SelectionState,
  snapshot: LiveSnapshot<LolStats>
): SelectionState {
  if (selection.seriesId !== snapshot.series.id) return selection;
  const selectedGameStillExists = snapshot.series.games.some(game => game.id === selection.gameId);
  if (selectedGameStillExists && !isLazyHistoryGameId(selection.gameId)) return selection;
  return {
    ...selection,
    gameId: snapshot.game.id
  };
}

export function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'set-view':
      return { ...state, activeView: action.view };
    case 'set-filter':
      return { ...state, matchFilter: action.filter };
    case 'set-connection':
      return {
        ...state,
        connectionStatus: action.status,
        connectionMessage: action.message
      };
    case 'schedule-loading':
      return {
        ...state,
        scheduleStatus: { ...state.scheduleStatus, [action.view]: 'loading' },
        scheduleError: { ...state.scheduleError, [action.view]: null }
      };
    case 'schedule-loaded': {
      const pinnedSeriesId = state.activeView === 'match' && state.detailView === action.view
        ? state.selections[action.view].seriesId
        : null;
      const nextEvents = mergeScheduleEvents(
        state.events[action.view],
        action.events,
        state.snapshots,
        pinnedSeriesId
      );
      const nextSelection = selectionForEvents(
        nextEvents,
        state.selections[action.view],
        action.view
      );
      return {
        ...state,
        events: { ...state.events, [action.view]: nextEvents },
        scheduleStatus: { ...state.scheduleStatus, [action.view]: 'ready' },
        scheduleError: { ...state.scheduleError, [action.view]: null },
        selections: { ...state.selections, [action.view]: nextSelection }
      };
    }
    case 'schedule-failed':
      return {
        ...state,
        scheduleStatus: { ...state.scheduleStatus, [action.view]: 'error' },
        scheduleError: { ...state.scheduleError, [action.view]: action.message }
      };
    case 'select-series': {
      const event = state.events[action.view].find(item => item.series.id === action.seriesId);
      if (!event) return state;
      return {
        ...state,
        activeView: 'match',
        detailView: action.view,
        selections: {
          ...state.selections,
          [action.view]: {
            seriesId: action.seriesId,
            gameId: preferredGame(event, action.view)?.id ?? null
          }
        }
      };
    }
    case 'select-game': {
      const selection = state.selections[action.view];
      const event = state.events[action.view].find(item => item.series.id === selection.seriesId);
      if (!event?.series.games.some(game => game.id === action.gameId)) return state;
      return {
        ...state,
        detailView: action.view,
        selections: {
          ...state.selections,
          [action.view]: {
            ...selection,
            gameId: action.gameId
          }
        }
      };
    }
    case 'snapshot-loading':
      return {
        ...state,
        snapshotStatus: { ...state.snapshotStatus, [action.gameId]: 'loading' },
        snapshotError: { ...state.snapshotError, [action.gameId]: null }
      };
    case 'snapshot-received': {
      const gameId = action.snapshot.game.id;
      const snapshot = mergeSnapshot(state.snapshots[gameId], action.snapshot);
      const nextEvents = {
        matches: eventsWithSnapshotSeries(state.events.matches, snapshot),
        history: eventsWithSnapshotSeries(state.events.history, snapshot)
      };
      const nextSelections = {
        matches: selectionWithSnapshotGame(state.selections.matches, snapshot),
        history: selectionWithSnapshotGame(state.selections.history, snapshot)
      };
      return {
        ...state,
        events: nextEvents,
        selections: nextSelections,
        snapshots: { ...state.snapshots, [gameId]: snapshot },
        snapshotStatus: { ...state.snapshotStatus, [gameId]: 'ready' },
        snapshotError: { ...state.snapshotError, [gameId]: null }
      };
    }
    case 'snapshot-failed':
      return {
        ...state,
        snapshotStatus: { ...state.snapshotStatus, [action.gameId]: 'error' },
        snapshotError: { ...state.snapshotError, [action.gameId]: action.message }
      };
  }
}

export type StoreListener = (state: AppState, previous: AppState) => void;

export class AppStore {
  #state: AppState;
  #listeners = new Set<StoreListener>();

  constructor(state: AppState = initialState) {
    this.#state = state;
    if (typeof window !== 'undefined') {
      window.addEventListener(RECOVERED_SNAPSHOT_EVENT, event => {
        const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
        if (!snapshot?.game?.id) return;
        this.dispatch({ type: 'snapshot-received', snapshot });
      });
    }
  }

  getState(): AppState {
    return this.#state;
  }

  dispatch(action: AppAction): void {
    const previous = this.#state;
    const next = reducer(previous, action);
    if (next === previous) return;
    this.#state = next;
    this.#listeners.forEach(listener => listener(next, previous));
  }

  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}