import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  LolProviderClient,
  LolProviderScheduleEntry,
  LolProviderSeries,
  LolProviderSnapshot
} from './provider.ts';
import { createRiotFinalityProvider } from './riot-finality-provider.ts';

const NOW = Date.parse('2026-08-07T12:20:00.000Z');

function series(
  id: string,
  state: LolProviderSeries['state'],
  scheduledStart: string
): LolProviderSeries {
  return {
    id,
    competition: { id: 'lck-cl', name: 'LCK Challengers' },
    teams: [
      { id: `${id}-blue`, name: `${id} Blue`, code: 'BLU' },
      { id: `${id}-red`, name: `${id} Red`, code: 'RED' }
    ],
    bestOf: 3,
    state,
    scheduledStart,
    games: [
      { id: `${id}-game-1`, number: 1, state: state === 'live' ? 'live' : 'unstarted' },
      { id: `${id}-game-2`, number: 2, state: 'unstarted' },
      { id: `${id}-game-3`, number: 3, state: 'unstarted' }
    ]
  };
}

function entry(value: LolProviderSeries): LolProviderScheduleEntry {
  return {
    series: value,
    observedAt: new Date(NOW).toISOString()
  };
}

function payload(id: string, completed: boolean): unknown {
  return {
    data: {
      event: {
        id,
        state: completed ? 'completed' : 'inProgress',
        match: {
          id,
          strategy: { count: 3 },
          teams: [
            { id: `${id}-blue`, result: { gameWins: completed ? 2 : 1 } },
            { id: `${id}-red`, result: { gameWins: 0 } }
          ],
          games: [
            { id: `${id}-game-1`, number: 1, state: completed ? 'completed' : 'inProgress' },
            { id: `${id}-game-2`, number: 2, state: completed ? 'completed' : 'unstarted' },
            { id: `${id}-game-3`, number: 3, state: 'unstarted' }
          ]
        }
      }
    }
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('prioritizes overdue scheduled series when live events would exhaust the finality limit', async () => {
  const nsKt = series(
    'ns-kt-ended',
    'scheduled',
    new Date(NOW - 7 * 60 * 60 * 1_000 - 20 * 60 * 1_000).toISOString()
  );
  const hleKrx = series(
    'hle-krx-ended',
    'scheduled',
    new Date(NOW - 7 * 60 * 60 * 1_000 - 20 * 60 * 1_000).toISOString()
  );
  const olderLive = Array.from({ length: 4 }, (_, index) => series(
    `older-live-${index}`,
    'live',
    new Date(NOW - (7 * 60 + 50 - index * 5) * 60 * 1_000).toISOString()
  ));
  const schedule = [...olderLive.map(entry), entry(nsKt), entry(hleKrx)];
  const requested: string[] = [];

  const base: LolProviderClient = {
    id: 'fixture',
    name: 'Fixture',
    getSchedule: async () => schedule,
    getSnapshot: async (): Promise<LolProviderSnapshot> => {
      throw new Error('Snapshot should not be requested by this regression.');
    }
  };
  const provider = createRiotFinalityProvider(base, {
    apiKey: 'test-key',
    now: () => new Date(NOW),
    scheduleFinalityLimit: 2,
    fetcher: async input => {
      const id = new URL(String(input)).searchParams.get('id') ?? '';
      requested.push(id);
      return json(payload(id, id === nsKt.id || id === hleKrx.id));
    }
  });

  const reconciled = await provider.getSchedule();

  assert.deepEqual(requested.sort(), [hleKrx.id, nsKt.id].sort());
  assert.equal(reconciled.find(item => item.series.id === nsKt.id)?.series.state, 'completed');
  assert.equal(reconciled.find(item => item.series.id === hleKrx.id)?.series.state, 'completed');
});

test('advances stale scheduled probe batches across time windows even on a fresh worker isolate', async () => {
  let currentTime = NOW;
  const stalledOne = series(
    'stalled-one',
    'scheduled',
    new Date(NOW - 9 * 60 * 60 * 1_000).toISOString()
  );
  const stalledTwo = series(
    'stalled-two',
    'scheduled',
    new Date(NOW - 8 * 60 * 60 * 1_000 - 30 * 60 * 1_000).toISOString()
  );
  const nsKt = series(
    'ns-kt-ended',
    'scheduled',
    new Date(NOW - 7 * 60 * 60 * 1_000 - 20 * 60 * 1_000).toISOString()
  );
  const hleKrx = series(
    'hle-krx-ended',
    'scheduled',
    new Date(NOW - 7 * 60 * 60 * 1_000 - 15 * 60 * 1_000).toISOString()
  );
  const schedule = [stalledOne, stalledTwo, nsKt, hleKrx].map(entry);
  const requested: string[] = [];

  const base: LolProviderClient = {
    id: 'fixture',
    name: 'Fixture',
    getSchedule: async () => schedule,
    getSnapshot: async (): Promise<LolProviderSnapshot> => {
      throw new Error('Snapshot should not be requested by this regression.');
    }
  };
  const makeProvider = () => createRiotFinalityProvider(base, {
    apiKey: 'test-key',
    now: () => new Date(currentTime),
    scheduleFinalityLimit: 2,
    fetcher: async input => {
      const id = new URL(String(input)).searchParams.get('id') ?? '';
      requested.push(id);
      return json(payload(id, id === nsKt.id || id === hleKrx.id));
    }
  });

  await makeProvider().getSchedule();
  assert.equal(requested.length, 2);

  currentTime += 15_000;
  const second = await makeProvider().getSchedule();
  assert.equal(new Set(requested).size, 4);
  assert.deepEqual(
    [...new Set(requested)].sort(),
    [stalledOne.id, stalledTwo.id, nsKt.id, hleKrx.id].sort()
  );
  assert.equal(second.find(item => item.series.id === nsKt.id)?.series.state, 'completed');
  assert.equal(second.find(item => item.series.id === hleKrx.id)?.series.state, 'completed');
});
