import type { Freshness, QualityReason, TelemetryQuality } from './domain.ts';

export interface FreshnessPolicy {
  freshSeconds: number;
  degradedSeconds: number;
  futureToleranceSeconds: number;
}

export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  freshSeconds: 30,
  degradedSeconds: 90,
  futureToleranceSeconds: 15
};

export interface QualityInput {
  sourceTimestamp: string | null;
  observedAt?: string;
  complete: boolean;
  advancing?: boolean | null;
  reasons?: readonly QualityReason[];
}

function freshnessFor(ageSeconds: number, policy: FreshnessPolicy): Freshness {
  if (ageSeconds <= policy.freshSeconds) return 'fresh';
  if (ageSeconds <= policy.degradedSeconds) return 'degraded';
  return 'stale';
}

export function assessQuality(
  input: QualityInput,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY
): TelemetryQuality {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const observedMs = Date.parse(observedAt);
  const sourceMs = input.sourceTimestamp ? Date.parse(input.sourceTimestamp) : Number.NaN;
  const reasons = [...(input.reasons ?? [])];

  if (!Number.isFinite(observedMs) || !Number.isFinite(sourceMs)) {
    reasons.push({ code: 'timestamp_unavailable', message: 'A valid source timestamp is required.' });
    return {
      freshness: 'unavailable',
      sourceTimestamp: input.sourceTimestamp,
      observedAt,
      ageSeconds: null,
      complete: input.complete,
      advancing: input.advancing ?? null,
      safeForLiveAnalysis: false,
      reasons
    };
  }

  const skewSeconds = Math.round((sourceMs - observedMs) / 1000);
  if (skewSeconds > policy.futureToleranceSeconds) {
    reasons.push({ code: 'future_timestamp', message: `Source timestamp is ${skewSeconds}s in the future.` });
    return {
      freshness: 'unavailable',
      sourceTimestamp: input.sourceTimestamp,
      observedAt,
      ageSeconds: 0,
      complete: input.complete,
      advancing: input.advancing ?? null,
      safeForLiveAnalysis: false,
      reasons
    };
  }

  const ageSeconds = Math.max(0, Math.round((observedMs - sourceMs) / 1000));
  const freshness = freshnessFor(ageSeconds, policy);
  if (freshness !== 'fresh') {
    reasons.push({
      code: `telemetry_${freshness}`,
      message: `Telemetry is ${ageSeconds}s old and is classified as ${freshness}.`
    });
  }
  if (!input.complete) {
    reasons.push({ code: 'incomplete_snapshot', message: 'Betting-critical fields are incomplete.' });
  }
  if (input.advancing === false) {
    reasons.push({ code: 'not_advancing', message: 'The source timestamp has not advanced.' });
  }

  return {
    freshness,
    sourceTimestamp: input.sourceTimestamp,
    observedAt,
    ageSeconds,
    complete: input.complete,
    advancing: input.advancing ?? null,
    safeForLiveAnalysis: freshness === 'fresh' && input.complete && input.advancing !== false,
    reasons
  };
}
