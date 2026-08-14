import assert from 'node:assert/strict';
import test from 'node:test';
import type { TelemetryQuality } from '@esports-live/core';
import { freshnessCopy } from './freshness-copy.ts';

function quality(overrides: Partial<TelemetryQuality> = {}): TelemetryQuality {
  return {
    freshness: 'fresh',
    sourceTimestamp: '2026-08-14T10:00:00.000Z',
    observedAt: '2026-08-14T10:00:08.000Z',
    ageSeconds: 8,
    complete: true,
    advancing: true,
    safeForLiveAnalysis: true,
    reasons: [],
    ...overrides
  };
}

test('describes current live telemetry with its source age', () => {
  assert.deepEqual(freshnessCopy(quality(), 'live'), {
    status: 'live',
    text: 'LIVE DATA · Updated 8s ago',
    title: 'Telemetry is current and updating.'
  });
});

test('makes delayed, stale and stopped feeds explicit', () => {
  assert.equal(freshnessCopy(quality({ freshness: 'degraded', ageSeconds: 47 }), 'live').text,
    'DELAYED DATA · Updated 47s ago');
  assert.equal(freshnessCopy(quality({ freshness: 'stale', ageSeconds: 134 }), 'live').text,
    'STALE DATA · Updated 2m 14s ago');
  assert.equal(freshnessCopy(quality({ advancing: false, ageSeconds: 134 }), 'live').text,
    'FEED NOT UPDATING · Last update 2m 14s ago');
});

test('keeps partial and final snapshots distinguishable', () => {
  assert.deepEqual(
    freshnessCopy(quality({ complete: false, safeForLiveAnalysis: false }), 'live'),
    {
      status: 'partial',
      text: 'LIVE DATA · Updated 8s ago · Partial stats',
      title: 'Telemetry is current and updating.'
    }
  );
  assert.equal(freshnessCopy(quality({ freshness: 'stale', ageSeconds: 4_000 }), 'completed').text,
    'FINAL DATA · Complete snapshot');
});

test('explains missing telemetry and unavailable source timestamps', () => {
  assert.equal(freshnessCopy(null, 'live').text, 'WAITING FOR TELEMETRY');
  assert.equal(freshnessCopy(quality({
    freshness: 'unavailable',
    sourceTimestamp: null,
    ageSeconds: null,
    safeForLiveAnalysis: false
  }), 'live').text, 'DATA AGE UNKNOWN');
});
