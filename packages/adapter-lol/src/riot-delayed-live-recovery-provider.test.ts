import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolStats } from './types.ts';
import type { LolProviderClient, LolProviderSnapshot } from './provider.ts';
import { createRiotDelayedLiveRecoveryProvider } from './riot-delayed-live-recovery-provider.ts';

const NOW = '2026-08-04T13:00:00.000Z';
const RECOVERY_CURSOR = '2026-08-04T12:48:00.000Z';

function snapshot(stats: LolStats | null, observedAt = NOW): LolProviderSnapshot {
  return {
    series: {
      id: 'series-1',
      competition: { id: 'league-1', name: 'League' },
      teams: [
        { id: 'blue', name: 'Blue' },
        { id: 'red', name: 'Red' }
      ],
      bestOf: 3,
      state: 'live',
      scheduledStart: NOW,
      games: [{ id: 'game-1', number: 1, state: 'live' }]
    },
    game: { id: 'game-1', number: 1, state: 'live' },
    sourceTimestamp: stats ? '2026-08-04T12:59:50.000Z' : null,
    observedAt,
    advancing: null,
    complete: stats !== null,
    stats,
    ...(stats ? {} : {
      reasons: [{ code: 'telemetry_unavailable', message: 'Riot returned no valid telemetry frame.' }]
    })
  };
}

function provider(getSnapshot: LolProviderClient['getSnapshot']): LolProviderClient {
  return {
    id: 'fake-riot',
    name: 'Fake Riot',
    getSchedule: async () => [],
    getSnapshot
  };
}

test('retries a broad delayed window when the current Riot window is empty', async () => {
  const requested: Array<string | undefined> = [];
  const stats = {} as LolStats;
  const wrapped = createRiotDelayedLiveRecoveryProvider(provider(async (_gameId, after) => {
    requested.push(after);
    return after === RECOVERY_CURSOR ? snapshot(stats) : snapshot(null);
  }), {
    now: () => new Date(NOW),
    recoveryDelaysMs: [12 * 60 * 1_000],
    broadProbeIntervalMs: 0
  });

  const result = await wrapped.getSnapshot('game-1');

  assert.equal(result.stats, stats);
  assert.deepEqual(requested, [undefined, RECOVERY_CURSOR]);
});

test('retains the last verified frame during a temporary live-window gap', async () => {
  const stats = {} as LolStats;
  let call = 0;
  const wrapped = createRiotDelayedLiveRecoveryProvider(provider(async () => {
    call += 1;
    return call === 1 ? snapshot(stats) : snapshot(null, '2026-08-04T13:00:10.000Z');
  }), {
    now: () => new Date(NOW),
    recoveryDelaysMs: [],
    broadProbeIntervalMs: 0
  });

  await wrapped.getSnapshot('game-1');
  const retained = await wrapped.getSnapshot('game-1');

  assert.equal(retained.stats, stats);
  assert.equal(retained.complete, false);
  assert.equal(retained.advancing, false);
  assert.ok(retained.reasons?.some(reason => reason.code === 'delayed_live_window'));
});
