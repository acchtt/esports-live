import type { ScheduleEvent } from '@esports-live/core';
import type { DataView } from './state.ts';

const CACHE_VERSION = 1;
const CACHE_MAX_AGE_MS = 15 * 60 * 1_000;
const CACHE_PREFIX = 'esports-live:v2:schedule:';
const HISTORY_CACHE_LIMIT = 24;

interface StoredSchedule {
  version: number;
  savedAt: number;
  events: readonly ScheduleEvent[];
}

function storageKey(view: DataView): string {
  return `${CACHE_PREFIX}${view}`;
}

function eventTime(event: ScheduleEvent): number {
  const value = Date.parse(event.series.scheduledStart);
  return Number.isFinite(value) ? value : 0;
}

function boundedEvents(view: DataView, events: readonly ScheduleEvent[]): readonly ScheduleEvent[] {
  if (view !== 'history' || events.length <= HISTORY_CACHE_LIMIT) return events;
  return [...events]
    .sort((left, right) => eventTime(right) - eventTime(left))
    .slice(0, HISTORY_CACHE_LIMIT);
}

export function readScheduleCache(view: DataView): readonly ScheduleEvent[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey(view));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSchedule>;
    if (value.version !== CACHE_VERSION || typeof value.savedAt !== 'number' || !Array.isArray(value.events)) {
      window.localStorage.removeItem(storageKey(view));
      return null;
    }
    if (Date.now() - value.savedAt > CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(storageKey(view));
      return null;
    }
    return boundedEvents(view, value.events as readonly ScheduleEvent[]);
  } catch {
    return null;
  }
}

export function writeScheduleCache(view: DataView, events: readonly ScheduleEvent[]): void {
  try {
    const value: StoredSchedule = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      events: boundedEvents(view, events)
    };
    window.localStorage.setItem(storageKey(view), JSON.stringify(value));
  } catch {
    // Storage is an optional acceleration layer; live requests remain authoritative.
  }
}
