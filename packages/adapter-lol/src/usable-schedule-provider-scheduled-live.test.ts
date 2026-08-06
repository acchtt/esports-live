import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderClient, LolProviderScheduleEntry } from './provider.ts';
import { createUsableScheduleProvider } from './usable-schedule-provider.ts';

const nowIso = '2026-08-06T05:23:00.000Z';
const blue = { id: 'dns', name: 'DNS Challengers', code: 'DNS' };
const red = { id: 't1a', name: 'T1 Esports Academy', code: 'T1A' };

function scheduledEntry(startOffsetMs: number): LolProviderScheduleEntry {
  return {
    observedAt: nowIso,
    series: {
      id: 'series-scheduled-live',
      competition: { id: 'lck-cl', name: 'LCK Challengers League' },
      teams: [blue, red],
      bestOf: 3,
      state: 'scheduled',
      scheduledStart: new Date(Date.parse(nowIso) + startOffsetMs).toISOString(),
      games: []
    }
  };
}

function delayedScheduleProvider(entry: LolProviderScheduleEntry): {
  provider: LolProviderClient;
  contextCalls: () => number;
  snapshotCalls: () => readonly string[];
} {
  let contextCalls = 0;
  const snapshotCalls: string[] = [];
  const provider: LolProviderClient = {
    id: 'fixture',
    name: 'Fixture provider',
    async getSchedule() {
      return [entry];
    },
    async getSeriesContext(seriesId) {
      contextCalls += 1;
      return {
        seriesId,
        observedAt: nowIso,
        rosters: [],
        standings: [],
        history: {
          bestOf: 3,
          winsRequired: 2,
          drawPossible: false,
          score: [{ team: blue, wins: 0 }, { team: red, wins: 0 }],
          games: [
            {
              id: 'game-1',
              number: 1,
              state: 'unstarted',
              blueTeam: blue,
              redTeam: red,
              winner: null,
              durationSeconds: null
            },
            {
              id: 'game-2',
              number: 2,
              state: 'unstarted',
              blueTeam: red,
              redTeam: blue,
              winner: null,
              durationSeconds: null
            },
            {
              id: 'game-3',
              number: 3,
              state: 'unstarted',
              blueTeam: blue,
              redTeam: red,
              winner: null,
              durationSeconds: null
            }
          ]
        },
        complete: true,
        reasons: []
      };
    },
    async getSnapshot(gameId) {
      snapshotCalls.push(gameId);
      return {
        series: entry.series,
        game: {
          id: gameId,
          number: Number(gameId.replace('game-', '')),
          state: gameId === 'game-1' ? 'live' : 'unstarted'
        },
        sourceTimestamp: gameId === 'game-1' ? nowIso : null,
        observedAt: nowIso,
        advancing: gameId === 'game-1',
        complete: gameId === 'game-1',
        stats: gameId === 'game-1' ? {} as never : null
      };
    }
  };
  return {
    provider,
    contextCalls: () => contextCalls,
    snapshotCalls: () => snapshotCalls
  };
}

test('promotes an overdue scheduled series when a verified game frame is already live', async () => {
  const fixture = delayedScheduleProvider(scheduledEntry(-23 * 60 * 1_000));
  const provider = createUsableScheduleProvider(fixture.provider, {
    now: () => new Date(nowIso)
  });

  const schedule = await provider.getSchedule();

  assert.equal(fixture.contextCalls(), 1);
  assert.deepEqual(fixture.snapshotCalls(), ['game-1']);
  assert.equal(schedule[0]?.series.state, 'live');
  assert.equal(schedule[0]?.series.games[0]?.state, 'live');
  assert.equal(schedule[0]?.series.teams[0].name, 'DNS Challengers');
  assert.equal(schedule[0]?.series.teams[1].name, 'T1 Esports Academy');
});

test('does not probe a scheduled series before its start time', async () => {
  const fixture = delayedScheduleProvider(scheduledEntry(30 * 60 * 1_000));
  const provider = createUsableScheduleProvider(fixture.provider, {
    now: () => new Date(nowIso)
  });

  const schedule = await provider.getSchedule();

  assert.equal(fixture.contextCalls(), 0);
  assert.deepEqual(fixture.snapshotCalls(), []);
  assert.equal(schedule[0]?.series.state, 'scheduled');
  assert.deepEqual(schedule[0]?.series.games, []);
});
