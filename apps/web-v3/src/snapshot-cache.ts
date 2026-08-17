import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const CACHE_VERSION = 1;
const LIVE_CACHE_MAX_AGE_MS = 90 * 1_000;
const COMPLETED_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const CACHE_PREFIX = 'esports-live:v2:snapshot:';
export const SNAPSHOT_UPDATED_EVENT = 'esports-live:v2-snapshot-updated';

interface StoredSnapshot {
  version: number;
  savedAt: number;
  snapshot: LiveSnapshot<LolStats>;
}

function storageKey(gameId: string): string {
  return `${CACHE_PREFIX}${gameId}`;
}

export function readSnapshotCache(gameId: string): LiveSnapshot<LolStats> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(gameId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSnapshot>;
    const snapshot = value.snapshot as LiveSnapshot<LolStats> | undefined;
    if (value.version !== CACHE_VERSION || typeof value.savedAt !== 'number' || !snapshot?.game?.id) {
      window.localStorage.removeItem(storageKey(gameId));
      return null;
    }
    if (!snapshot.stats) {
      window.localStorage.removeItem(storageKey(gameId));
      return null;
    }
    const maxAge = snapshot.game.state === 'completed'
      ? COMPLETED_CACHE_MAX_AGE_MS
      : LIVE_CACHE_MAX_AGE_MS;
    if (Date.now() - value.savedAt > maxAge) {
      window.localStorage.removeItem(storageKey(gameId));
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function writeSnapshotCache(snapshot: LiveSnapshot<LolStats>): void {
  if (!snapshot.stats) return;
  try {
    const value: StoredSnapshot = {
      version: CACHE_VERSION,
      savedAt: Date.now(),
      snapshot
    };
    window.localStorage.setItem(storageKey(snapshot.game.id), JSON.stringify(value));
  } catch {
    // Storage is an optional acceleration layer; network telemetry remains authoritative.
  }
  window.dispatchEvent(new CustomEvent<LiveSnapshot<LolStats>>(SNAPSHOT_UPDATED_EVENT, {
    detail: snapshot
  }));
}
