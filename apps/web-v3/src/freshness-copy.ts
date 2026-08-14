import type { GameState, TelemetryQuality } from '@esports-live/core';

export type FreshnessStatus =
  | 'empty'
  | 'live'
  | 'partial'
  | 'delayed'
  | 'stale'
  | 'paused'
  | 'unavailable'
  | 'final';

export interface FreshnessCopy {
  status: FreshnessStatus;
  text: string;
  title: string;
}

function ageCopy(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 2) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder ? `${minutes}m ${remainder}s ago` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder ? `${hours}h ${minuteRemainder}m ago` : `${hours}h ago`;
}

function reasonTitle(quality: TelemetryQuality): string {
  return quality.reasons.map(reason => reason.message).filter(Boolean).join(' ');
}

function withPartial(text: string, quality: TelemetryQuality): string {
  return quality.complete ? text : `${text} · Partial stats`;
}

export function freshnessCopy(
  quality: TelemetryQuality | null,
  gameState: GameState
): FreshnessCopy {
  if (!quality) {
    return {
      status: 'empty',
      text: 'WAITING FOR TELEMETRY',
      title: 'No telemetry has been received for this game yet.'
    };
  }

  const age = ageCopy(quality.ageSeconds);
  const title = reasonTitle(quality);

  if (gameState === 'completed') {
    return {
      status: 'final',
      text: `FINAL DATA · ${quality.complete ? 'Complete snapshot' : 'Partial snapshot'}`,
      title: title || 'This is the latest final snapshot published by the provider.'
    };
  }

  if (quality.advancing === false) {
    return {
      status: 'paused',
      text: withPartial(
        age ? `FEED NOT UPDATING · Last update ${age}` : 'FEED NOT UPDATING',
        quality
      ),
      title: title || 'The provider source timestamp has stopped advancing.'
    };
  }

  if (quality.freshness === 'stale') {
    return {
      status: 'stale',
      text: withPartial(age ? `STALE DATA · Updated ${age}` : 'STALE DATA', quality),
      title: title || 'Live telemetry is more than 90 seconds old.'
    };
  }

  if (quality.freshness === 'degraded') {
    return {
      status: 'delayed',
      text: withPartial(age ? `DELAYED DATA · Updated ${age}` : 'DELAYED DATA', quality),
      title: title || 'Live telemetry is between 31 and 90 seconds old.'
    };
  }

  if (quality.freshness === 'unavailable' || age === null) {
    return {
      status: 'unavailable',
      text: withPartial('DATA AGE UNKNOWN', quality),
      title: title || 'The provider did not publish a usable source timestamp.'
    };
  }

  return {
    status: quality.complete ? 'live' : 'partial',
    text: withPartial(`LIVE DATA · Updated ${age}`, quality),
    title: title || 'Telemetry is current and updating.'
  };
}
