import type { ScheduleEvent } from '@esports-live/core';
import { readScheduleCache } from './schedule-cache.ts';

const PREGAME_HOLD_BEFORE_MS = 45 * 60 * 1_000;
const PREGAME_HOLD_AFTER_MS = 2 * 60 * 60 * 1_000;
const ACTIVE_HOLD_MS = 10 * 60 * 1_000;

interface SeenEvent {
  event: ScheduleEvent;
  seenAt: number;
}

interface SchedulePayload {
  esport?: unknown;
  events?: readonly ScheduleEvent[];
  [key: string]: unknown;
}

function scheduleUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof Request) return new URL(input.url, window.location.href);
    return new URL(String(input), window.location.href);
  } catch {
    return null;
  }
}

function scheduleStates(url: URL): Set<string> {
  return new Set(
    (url.searchParams.get('states') ?? '')
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isCompletedSchedule(states: Set<string>): boolean {
  return states.size === 1 && states.has('completed');
}

function isActiveSchedule(states: Set<string>): boolean {
  return ['live', 'paused', 'scheduled', 'unknown'].some(state => states.has(state));
}

function eventTime(event: ScheduleEvent): number {
  const parsed = Date.parse(event.series.scheduledStart);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function shouldRetain(
  value: SeenEvent,
  completedSeries: ReadonlySet<string>,
  now: number
): boolean {
  const { event, seenAt } = value;
  if (completedSeries.has(event.series.id)) return false;

  const state = event.series.state;
  if (state === 'completed' || state === 'cancelled') return false;
  if (state === 'live' || state === 'paused') {
    return now - seenAt <= ACTIVE_HOLD_MS;
  }
  if (state !== 'scheduled' && state !== 'unknown') return false;

  const start = Date.parse(event.series.scheduledStart);
  if (!Number.isFinite(start)) return false;
  const untilStart = start - now;
  return untilStart <= PREGAME_HOLD_BEFORE_MS && untilStart >= -PREGAME_HOLD_AFTER_MS;
}

function jsonResponse(response: Response, payload: SchedulePayload): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function installScheduleContinuity(): () => void {
  const upstreamFetch = window.fetch.bind(window);
  const seenActive = new Map<string, SeenEvent>();
  const completedSeries = new Set<string>();

  const seedTime = Date.now();
  (readScheduleCache('matches') ?? []).forEach(event => {
    if (event.series.state === 'completed' || event.series.state === 'cancelled') return;
    seenActive.set(event.series.id, { event, seenAt: seedTime });
  });

  const wrappedFetch: typeof window.fetch = async (input, init) => {
    const response = await upstreamFetch(input, init);
    if (!response.ok) return response;

    const url = scheduleUrl(input);
    if (!url?.pathname.endsWith('/v1/lol/schedule')) return response;

    let payload: SchedulePayload;
    try {
      payload = await response.clone().json() as SchedulePayload;
    } catch {
      return response;
    }
    if (!Array.isArray(payload.events)) return response;

    const states = scheduleStates(url);
    const now = Date.now();

    if (isCompletedSchedule(states)) {
      payload.events.forEach(event => {
        completedSeries.add(event.series.id);
        seenActive.delete(event.series.id);
      });
      return response;
    }
    if (!isActiveSchedule(states)) return response;

    const incoming = payload.events;
    const incomingIds = new Set<string>();
    incoming.forEach(event => {
      const id = event.series.id;
      incomingIds.add(id);
      if (event.series.state === 'completed' || event.series.state === 'cancelled') {
        completedSeries.add(id);
        seenActive.delete(id);
        return;
      }
      completedSeries.delete(id);
      seenActive.set(id, { event, seenAt: now });
    });

    const retained: ScheduleEvent[] = [];
    seenActive.forEach((value, id) => {
      if (incomingIds.has(id)) return;
      if (shouldRetain(value, completedSeries, now)) {
        retained.push(value.event);
      } else {
        seenActive.delete(id);
      }
    });
    if (!retained.length) return response;

    const events = [...incoming, ...retained]
      .sort((left, right) => eventTime(left) - eventTime(right));
    return jsonResponse(response, { ...payload, events });
  };

  window.fetch = wrappedFetch;

  return () => {
    seenActive.clear();
    completedSeries.clear();
    if (window.fetch === wrappedFetch) window.fetch = upstreamFetch;
  };
}
