import type { QualityReason } from '@esports-live/core';
import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';

export interface RiotDelayedLiveRecoveryOptions {
  now?: () => Date;
  recoveryDelaysMs?: readonly number[];
  broadProbeIntervalMs?: number;
}

const DEFAULT_RECOVERY_DELAYS_MS = [8 * 60 * 1_000, 15 * 60 * 1_000, 30 * 60 * 1_000] as const;
const DEFAULT_BROAD_PROBE_INTERVAL_MS = 15_000;

const RECOVERY_REASON: QualityReason = {
  code: 'delayed_live_window',
  message: 'The latest Riot telemetry window is temporarily unavailable; the last verified frame is being retained.'
};

function recoverable(snapshot: LolProviderSnapshot): boolean {
  if (snapshot.stats || snapshot.game.state === 'completed') return false;
  const codes = new Set((snapshot.reasons ?? []).map(reason => reason.code));
  return codes.has('telemetry_unavailable')
    || codes.has('timestamp_unavailable')
    || codes.has('pregame_or_unknown');
}

function sourceTime(snapshot: LolProviderSnapshot): number {
  const parsed = Date.parse(snapshot.sourceTimestamp ?? '');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function retainLastVerified(
  previous: LolProviderSnapshot,
  incoming: LolProviderSnapshot
): LolProviderSnapshot {
  const reasons = [...(previous.reasons ?? [])];
  if (!reasons.some(reason => reason.code === RECOVERY_REASON.code)) reasons.push(RECOVERY_REASON);
  return {
    ...previous,
    observedAt: incoming.observedAt,
    advancing: false,
    complete: false,
    reasons
  };
}

export function createRiotDelayedLiveRecoveryProvider(
  base: LolProviderClient,
  options: RiotDelayedLiveRecoveryOptions = {}
): LolProviderClient {
  const now = options.now ?? (() => new Date());
  const recoveryDelaysMs = options.recoveryDelaysMs ?? DEFAULT_RECOVERY_DELAYS_MS;
  const broadProbeIntervalMs = options.broadProbeIntervalMs ?? DEFAULT_BROAD_PROBE_INTERVAL_MS;
  const lastVerified = new Map<string, LolProviderSnapshot>();
  const lastBroadProbeAt = new Map<string, number>();

  const remember = (gameId: string, snapshot: LolProviderSnapshot): LolProviderSnapshot => {
    if (snapshot.stats) lastVerified.set(gameId, snapshot);
    return snapshot;
  };

  const getSnapshot = async (gameId: string, after?: string): Promise<LolProviderSnapshot> => {
    const initial = remember(gameId, await base.getSnapshot(gameId, after));
    if (!recoverable(initial)) return initial;

    const nowMs = now().getTime();
    const lastProbe = lastBroadProbeAt.get(gameId) ?? Number.NEGATIVE_INFINITY;
    if (nowMs - lastProbe >= broadProbeIntervalMs) {
      lastBroadProbeAt.set(gameId, nowMs);
      const recovered = await Promise.all(recoveryDelaysMs.map(async delayMs => {
        const recoveryCursor = new Date(nowMs - Math.max(1_000, delayMs)).toISOString();
        return base.getSnapshot(gameId, recoveryCursor).catch(() => null);
      }));
      const best = recovered
        .filter((snapshot): snapshot is LolProviderSnapshot => snapshot !== null && snapshot.stats !== null)
        .sort((left, right) => sourceTime(right) - sourceTime(left))[0];
      if (best) return remember(gameId, best);
    }

    const previous = lastVerified.get(gameId);
    return previous?.stats ? retainLastVerified(previous, initial) : initial;
  };

  return {
    id: base.id,
    name: base.name,
    ...(base.sourceUrl ? { sourceUrl: base.sourceUrl } : {}),
    getSchedule: () => base.getSchedule(),
    getSnapshot,
    ...(base.getSeriesContext
      ? { getSeriesContext: (seriesId: string) => base.getSeriesContext!(seriesId) }
      : {})
  };
}
