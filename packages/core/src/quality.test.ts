import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality } from './quality.ts';

const observedAt = '2026-07-31T00:00:00.000Z';

test('fresh complete advancing telemetry is safe', () => {
  const quality = assessQuality({
    sourceTimestamp: '2026-07-30T23:59:50.000Z',
    observedAt,
    complete: true,
    advancing: true
  });

  assert.equal(quality.freshness, 'fresh');
  assert.equal(quality.ageSeconds, 10);
  assert.equal(quality.safeForLiveAnalysis, true);
});

test('degraded telemetry is never safe', () => {
  const quality = assessQuality({
    sourceTimestamp: '2026-07-30T23:59:00.000Z',
    observedAt,
    complete: true,
    advancing: true
  });

  assert.equal(quality.freshness, 'degraded');
  assert.equal(quality.safeForLiveAnalysis, false);
});

test('fresh incomplete telemetry is never safe', () => {
  const quality = assessQuality({
    sourceTimestamp: '2026-07-30T23:59:55.000Z',
    observedAt,
    complete: false
  });

  assert.equal(quality.freshness, 'fresh');
  assert.equal(quality.safeForLiveAnalysis, false);
  assert.ok(quality.reasons.some(reason => reason.code === 'incomplete_snapshot'));
});
