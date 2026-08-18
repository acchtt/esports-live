import test from 'node:test';
import assert from 'node:assert/strict';
import type { ScheduleEvent, SeriesContext, TeamRef } from '@esports-live/core';
import { contextHasActiveGame, verifiedFinalEventFromContext } from './match-store.ts';

const blue: TeamRef = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red: TeamRef = { id: 'red', name: 'Red Team', code: 'RED' };

function event(): ScheduleEvent {
  return {
    series: {
      id: 'series-db-finality',
      esport: 'lol',
      competition: { id: 'league', name: 'League' },
      teams: [blue, red],
      bestOf: 3,
      state: 'live',
      scheduledStart: '2026-08-18T00:00:00.000Z',
      games: [{ id: 'game-2', number: 2, state: 'live' }]
    },
    provider: { id: 'fixture', name: 'Fixture' },
    observedAt: '2026-08-18T02:00:00.000Z'
  };
}

function context(secondState: 'completed' | 'live', secondWinner: TeamRef | null): SeriesContext {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: 'series-db-finality',
    provider: { id: 'fixture', name: 'Fixture' },
    observedAt: '2026-08-18T03:00:00.000Z',
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: blue, wins: secondWinner?.id === blue.id ? 2 : 1 },
        { team: red, wins: 0 }
      ],
      games: [
        {
          id: 'game-1',
          number: 1,
          state: 'completed',
          blueTeam: blue,
          redTeam: red,
          winner: blue,
          durationSeconds: 1_800
        },
        {
          id: 'game-2',
          number: 2,
          state: secondState,
          blueTeam: blue,
          redTeam: red,
          winner: secondWinner,
          durationSeconds: secondState === 'completed' ? 1_900 : null
        }
      ]
    },
    complete: secondState === 'completed',
    reasons: []
  };
}

test('durable finality requires distinct completed-game winners that clinch the series', () => {
  const final = verifiedFinalEventFromContext(event(), context('completed', blue));

  assert.ok(final);
  assert.equal(final.series.state, 'completed');
  assert.deepEqual(final.series.score?.map(entry => entry.wins), [2, 0]);
  assert.deepEqual(final.series.games.map(game => game.state), ['completed', 'completed']);
});

test('a fresh active history game vetoes durable Final even when an aggregate score looks clinched', () => {
  const active = context('live', blue);
  active.history!.score = [
    { team: blue, wins: 2 },
    { team: red, wins: 0 }
  ];

  assert.equal(contextHasActiveGame(active), true);
  assert.equal(verifiedFinalEventFromContext(event(), active), null);
});

test('aggregate score without enough completed-game winner evidence cannot become durable Final', () => {
  const partial = context('completed', null);
  partial.history!.score = [
    { team: blue, wins: 2 },
    { team: red, wins: 0 }
  ];

  assert.equal(verifiedFinalEventFromContext(event(), partial), null);
});
