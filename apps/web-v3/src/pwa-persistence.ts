import { Capacitor } from '@capacitor/core';
import type { LiveSnapshot, ScheduleEvent, SeriesContext } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const DB_NAME = 'arena-v3-pwa-history';
const DB_VERSION = 1;
const SERIES_STORE = 'completed-series';
const CONTEXT_STORE = 'completed-contexts';
const SNAPSHOT_STORE = 'completed-snapshots';
const RECENT_FINALITY_GUARD_MS = 12 * 60 * 60 * 1_000;
const FUTURE_COMPLETION_TOLERANCE_MS = 5 * 60 * 1_000;
const MAX_SERIES = 250;
const MAX_CONTEXTS = 250;
const MAX_SNAPSHOTS = 750;

interface StoredSeries {
  id: string;
  savedAt: number;
  event: ScheduleEvent;
}

interface StoredContext {
  id: string;
  savedAt: number;
  context: SeriesContext;
}

interface StoredSnapshot {
  id: string;
  seriesId: string;
  savedAt: number;
  snapshot: LiveSnapshot<LolStats>;
}

interface ScheduleResponse {
  esport?: string;
  events?: readonly ScheduleEvent[];
}

type DurableRecord = StoredSeries | StoredContext | StoredSnapshot;

let databasePromise: Promise<IDBDatabase | null> | null = null;
const pendingSeries = new Map<string, ScheduleEvent>();

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url);
    if (input instanceof URL) return new URL(input.href);
    return new URL(String(input), window.location.href);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

function isHistorySchedule(url: URL): boolean {
  if (!url.pathname.endsWith('/v1/lol/schedule')) return false;
  const states = (url.searchParams.get('states') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return states.length === 1 && states[0] === 'completed';
}

function seriesContextId(url: URL): string | null {
  const match = url.pathname.match(/\/v1\/lol\/series\/([^/]+)\/context$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function snapshotGameId(url: URL): string | null {
  const match = url.pathname.match(/\/v1\/lol\/games\/([^/]+)\/live$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function relevantRequest(url: URL): boolean {
  return isHistorySchedule(url) || Boolean(seriesContextId(url)) || Boolean(snapshotGameId(url));
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (databasePromise) return databasePromise;

  databasePromise = new Promise(resolve => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SERIES_STORE)) {
        const store = database.createObjectStore(SERIES_STORE, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt');
      }
      if (!database.objectStoreNames.contains(CONTEXT_STORE)) {
        const store = database.createObjectStore(CONTEXT_STORE, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt');
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const store = database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt');
        store.createIndex('seriesId', 'seriesId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function putRecord(storeName: string, record: DurableRecord): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(storeName, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(storeName).put(record);
  await done;
}

async function getRecord<T>(storeName: string, id: string): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;
  const transaction = database.transaction(storeName, 'readonly');
  const done = transactionDone(transaction);
  const value = await requestValue(transaction.objectStore(storeName).get(id)) as T | undefined;
  await done;
  return value ?? null;
}

async function getAllRecords<T>(storeName: string): Promise<readonly T[]> {
  const database = await openDatabase();
  if (!database) return [];
  const transaction = database.transaction(storeName, 'readonly');
  const done = transactionDone(transaction);
  const values = await requestValue(transaction.objectStore(storeName).getAll()) as readonly T[];
  await done;
  return values;
}

async function pruneStore(storeName: string, maximum: number): Promise<void> {
  const records = [...await getAllRecords<DurableRecord>(storeName)];
  if (records.length <= maximum) return;
  records.sort((left, right) => right.savedAt - left.savedAt);
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(storeName, 'readwrite');
  const done = transactionDone(transaction);
  records.slice(maximum).forEach(record => transaction.objectStore(storeName).delete(record.id));
  await done;
}

function winsRequired(bestOf: number): number {
  return Math.floor(Math.max(1, bestOf) / 2) + 1;
}

function stableCompletedEvent(event: ScheduleEvent, now = Date.now()): boolean {
  if (event.series.state !== 'completed') return false;
  if (event.series.games.some(game => (
    game.state === 'live' || game.state === 'draft' || game.state === 'paused'
  ))) return false;

  const scheduledStart = Date.parse(event.series.scheduledStart);
  if (Number.isFinite(scheduledStart) && scheduledStart > now + FUTURE_COMPLETION_TOLERANCE_MS) {
    return false;
  }

  const required = winsRequired(event.series.bestOf);
  const decisiveScore = event.series.score?.some(entry => entry.wins >= required) ?? false;
  const completedGames = event.series.games.filter(game => game.state === 'completed').length;
  const oldEnough = Number.isFinite(scheduledStart)
    && now - scheduledStart >= RECENT_FINALITY_GUARD_MS;
  return decisiveScore && (completedGames >= required || oldEnough);
}

function stableCompletedContext(context: SeriesContext): boolean {
  const history = context.history;
  if (!history) return false;
  if (history.games.some(game => (
    game.state === 'live' || game.state === 'draft' || game.state === 'paused'
  ))) return false;
  const required = Math.max(
    1,
    history.winsRequired || winsRequired(history.bestOf)
  );
  const completedGames = history.games.filter(game => game.state === 'completed').length;
  const decisiveScore = history.score?.some(entry => entry.wins >= required) ?? false;
  return decisiveScore && completedGames >= required;
}

function eventWithContext(event: ScheduleEvent, context: SeriesContext): ScheduleEvent {
  const history = context.history;
  if (!history) return event;
  const contextGames = history.games.map(game => ({
    id: game.id,
    number: game.number,
    state: game.state
  }));
  const games = contextGames.length ? contextGames : event.series.games;
  if (history.score?.length) {
    return {
      ...event,
      series: {
        ...event.series,
        score: history.score,
        games
      }
    };
  }
  return {
    ...event,
    series: {
      ...event.series,
      games
    }
  };
}

async function rememberSeries(event: ScheduleEvent): Promise<void> {
  await putRecord(SERIES_STORE, {
    id: event.series.id,
    savedAt: Date.now(),
    event
  } satisfies StoredSeries);
  await pruneStore(SERIES_STORE, MAX_SERIES);
}

async function rememberHistory(events: readonly ScheduleEvent[]): Promise<void> {
  for (const event of events) {
    if (event.series.state !== 'completed') continue;
    pendingSeries.set(event.series.id, event);
    if (stableCompletedEvent(event)) await rememberSeries(event);
  }
}

async function rememberContext(context: SeriesContext): Promise<void> {
  if (!stableCompletedContext(context)) return;
  await putRecord(CONTEXT_STORE, {
    id: context.seriesId,
    savedAt: Date.now(),
    context
  } satisfies StoredContext);
  await pruneStore(CONTEXT_STORE, MAX_CONTEXTS);

  const pending = pendingSeries.get(context.seriesId);
  if (pending) await rememberSeries(eventWithContext(pending, context));
}

async function rememberSnapshot(snapshot: LiveSnapshot<LolStats>): Promise<void> {
  if (snapshot.game.state !== 'completed' || !snapshot.stats) return;
  await putRecord(SNAPSHOT_STORE, {
    id: snapshot.game.id,
    seriesId: snapshot.series.id,
    savedAt: Date.now(),
    snapshot
  } satisfies StoredSnapshot);
  await pruneStore(SNAPSHOT_STORE, MAX_SNAPSHOTS);
}

async function readHistory(): Promise<readonly ScheduleEvent[]> {
  const stored = [...await getAllRecords<StoredSeries>(SERIES_STORE)];
  const contexts = await getAllRecords<StoredContext>(CONTEXT_STORE);
  const contextBySeries = new Map(contexts.map(record => [record.id, record.context]));
  return stored
    .sort((left, right) => {
      const leftTime = Date.parse(left.event.series.scheduledStart);
      const rightTime = Date.parse(right.event.series.scheduledStart);
      return (Number.isFinite(rightTime) ? rightTime : right.savedAt)
        - (Number.isFinite(leftTime) ? leftTime : left.savedAt);
    })
    .map(record => {
      const context = contextBySeries.get(record.id);
      return context ? eventWithContext(record.event, context) : record.event;
    });
}

async function readContext(seriesId: string): Promise<SeriesContext | null> {
  const stored = await getRecord<StoredContext>(CONTEXT_STORE, seriesId);
  return stored?.context ?? null;
}

async function readSnapshot(gameId: string): Promise<LiveSnapshot<LolStats> | null> {
  const stored = await getRecord<StoredSnapshot>(SNAPSHOT_STORE, gameId);
  return stored?.snapshot ?? null;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-arena-data-source': 'pwa-history'
    }
  });
}

function markDurableFallback(): void {
  document.documentElement.dataset.v3DataSource = 'cache';
  const pill = document.querySelector<HTMLElement>('.connection-pill');
  pill?.setAttribute('aria-label', 'Cached data; reconnecting');
}

async function rememberResponse(url: URL, response: Response): Promise<void> {
  if (!response.ok) return;
  try {
    if (isHistorySchedule(url)) {
      const payload = await response.clone().json() as ScheduleResponse;
      if (Array.isArray(payload.events)) await rememberHistory(payload.events);
      return;
    }

    if (seriesContextId(url)) {
      const context = await response.clone().json() as SeriesContext;
      if (context?.seriesId) await rememberContext(context);
      return;
    }

    if (snapshotGameId(url)) {
      const snapshot = await response.clone().json() as LiveSnapshot<LolStats>;
      if (snapshot?.game?.id) await rememberSnapshot(snapshot);
    }
  } catch {
    // Durable PWA history is optional; never let persistence block live data.
  }
}

async function durableFallback(url: URL): Promise<Response | null> {
  try {
    if (isHistorySchedule(url)) {
      const events = await readHistory();
      return events.length ? jsonResponse({ esport: 'lol', events }) : null;
    }

    const seriesId = seriesContextId(url);
    if (seriesId) {
      const context = await readContext(seriesId);
      return context ? jsonResponse(context) : null;
    }

    const gameId = snapshotGameId(url);
    if (gameId) {
      const snapshot = await readSnapshot(gameId);
      return snapshot ? jsonResponse(snapshot) : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function installPwaPersistence(): void {
  if (Capacitor.isNativePlatform()) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (
      !url
      || requestMethod(input, init) !== 'GET'
      || !relevantRequest(url)
    ) {
      return nativeFetch(input, init);
    }

    try {
      const response = await nativeFetch(input, init);
      await rememberResponse(url, response);
      return response;
    } catch (error) {
      const fallback = await durableFallback(url);
      if (!fallback) throw error;
      markDurableFallback();
      return fallback;
    }
  };
}
