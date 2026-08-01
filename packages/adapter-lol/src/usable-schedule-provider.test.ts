import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderClient, LolProviderScheduleEntry } from './provider.ts';
import { createUsableScheduleProvider } from './usable-schedule-provider.ts';

const observedAt = '2026-08-01T13:00:00.000Z';
const left = { id: 'real-left', name: 'Real Left' };
const right = { id: 'real-right', name: 'Real Right' };

function sparseEntry(state: 'live' | 'scheduled' = 'live'): LolProviderScheduleEntry {
  return {
    observedAt,
    series: {
      id: 'series-1',
      competition: { id: 'lcp', name: 'LCP' },
      teams: [
        { id: 'team-1', name: 'Team 1' },
        { id: 'team-2', name: 'Team 2' }
      ],
      bestOf: 1,
      state,
      scheduledStart: observedAt,
      games: []
    }
  };
}

function baseProvider(entry: LolProviderScheduleEntry, withHistory: boolean): LolProviderClient {
  return {
    id: 'test',
    name: 'Test provider',
    async getSchedule() {
      return [entry];
    },
    async getSnapshot() {
      throw new Error('unused');
    },
    async getSeriesContext(seriesId) {
      return {
        seriesId,
        observedAt,
        rosters: [],
        standings: [],
        ...(withHistory ? {
          history: {
            bestOf: 3,
            winsRequired: 2,
            drawPossible: false,
            score: [
              { team: left, wins: 0 },
              { team: right, wins: 0 }
            ],
            games: [{
              id: 'game-1',
              number: 1,
              state: 'live',
              blueTeam: left,
              redTeam: right,
              winner: null,
              durationSeconds: null
            }]
          }
        } : {}),
        complete: withHistory
      };
    }
  };
}

test('enriches a sparse live event from series history', async () => {
  const provider = createUsableScheduleProvider(baseProvider(sparseEntry(), true));
  const schedule = await provider.getSchedule();

  assert.equal(schedule.length, 1);
  assert.equal(schedule[0]?.series.teams[0].name, 'Real Left');
  assert.equal(schedule[0]?.series.teams[1].name, 'Real Right');
  assert.equal(schedule[0]?.series.bestOf, 3);
  assert.equal(schedule[0]?.series.games[0]?.id, 'game-1');
});

test('suppresses a live placeholder that cannot be resolved', async () => {
  const provider = createUsableScheduleProvider(baseProvider(sparseEntry(), false));
  assert.deepEqual(await provider.getSchedule(), []);
});

test('retains scheduled entries before Riot publishes game IDs', async () => {
  let contextCalls = 0;
  const base = baseProvider(sparseEntry('scheduled'), false);
  const getSeriesContext = base.getSeriesContext!;
  base.getSeriesContext = async seriesId => {
    contextCalls += 1;
    return getSeriesContext(seriesId);
  };

  const schedule = await createUsableScheduleProvider(base).getSchedule();
  assert.equal(schedule.length, 1);
  assert.equal(contextCalls, 0);
});
