import type { LiveSnapshot, ScheduleEvent } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import type { DataView } from './state.ts';

export interface HealthResponse {
  ok: boolean;
  service: string;
  schemaVersion: string;
  adapters: readonly string[];
}

interface ScheduleResponse {
  esport: string;
  events: readonly ScheduleEvent[];
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 25_000;

async function requestJson<T>(
  path: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Request timed out.')),
    timeoutMs
  );
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) {
      const value = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(value?.message ?? `API returned ${response.status}`);
    }
    return await response.json() as T;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error('The data request took too long. Try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function loadHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', signal);
}

export async function loadSchedule(
  view: DataView,
  signal?: AbortSignal
): Promise<readonly ScheduleEvent[]> {
  const states = view === 'matches' ? 'live,paused,scheduled' : 'completed';
  const payload = await requestJson<ScheduleResponse>(
    `/v1/lol/schedule?states=${states}`,
    signal
  );
  return payload.events;
}

export function loadSnapshot(
  gameId: string,
  after: string | null,
  signal?: AbortSignal
): Promise<LiveSnapshot<LolStats>> {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  return requestJson<LiveSnapshot<LolStats>>(
    `/v1/lol/games/${encodeURIComponent(gameId)}/live${query}`,
    signal,
    SNAPSHOT_TIMEOUT_MS
  );
}
