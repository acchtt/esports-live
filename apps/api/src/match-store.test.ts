import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  ScheduleEvent,
  SeriesContext,
  SeriesGameHistoryRef,
  TeamRef
} from '@esports-live/core';
import {
  contextHasActiveGame,
  mergePersistedSeriesContext,
  verifiedFinalEventFromContext
} from './match-store.ts';

const blue: TeamRef = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red: TeamRef = { id: 'red', name: 'Red Team', code: 'RED' };

function event(bestOf = 3): ScheduleEvent {
  return {
    series: {
      id: 'series-db-finality',
      esport: 'lol',
      competition: { id: 'league', name: 'League' },
      teams: [blue, red],
      bestOf,
      state: 'live',
      scheduledStart: '2026-08-18T00:00:00.000Z',
      games: [{ id: 'game-2', number: 2, state: 'live' }]
    },
    provider: { id: 'fixture', name: 'Fixture' },
    observedAt: '2026-08-18T02:00:00.000Z'
  };
}

function game(
  number: number,
  state: SeriesGameHistoryRef['state'],
  winner: TeamRef | null = null
): SeriesGameHistoryRef {
  return {
    id: `game-${number}`,
    number,
    state,
    blueTeam: blue,
    redTeam: red,
    winner,
    durationSeconds: state === 'completed' ? 1_800 + number * 10 : null
  };
}

function historyContext(
  score: readonly [number, number],
  games: readonly SeriesGameHistoryRef[],
  bestOf = 3,
  observedAt = '2026-08-18T03:00:00.000Z'
): SeriesContext {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: 'series-db-finality',
    provider: { id: 'fixture', name: 'Fixture' },
    observedAt,
    rosters: [],
    standings: [],
    history: {
      bestOf,
      winsRequired: Math.floor(bestOf / 2) + 1,
      drawPossible: false,
      score: [
        { team: blue, wins: score[0] },
        { team: red, wins: score[1] }
      ],
      games
    },
    complete: false,
    reasons: []
  };
}

function context(secondState: 'completed' | 'live', secondWinner: TeamRef | null): SeriesContext {
  return historyContext(
    [secondWinner?.id === blue.id ? 2 : 1, 0],
    [game(1, 'completed', blue), game(2, secondState, secondWinner)]
  );
}

test('durable finality requires distinct completed-game winners that clinch the series', () => {
  const final = verifiedFinalEventFromContext(event(), context('completed', blue));

  assert.ok(final);
  assert.equal(final.series.state, 'completed');
  assert.deepEqual(final.series.score?.map(entry => entry.wins), [2, 0]);
  assert.deepEqual(final.series.games.map(value => value.state), ['completed', 'completed']);
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

test('persisted score transitions retain completed-game winners across Worker restarts', () => {
  const previous = historyContext(
    [1, 0],
    [game(1, 'completed', blue), game(2, 'live')],
    3,
    '2026-08-18T01:00:00.000Z'
  );
  const incoming = historyContext(
    [1, 1],
    [game(1, 'completed'), game(2, 'completed'), game(3, 'live')],
    3,
    '2026-08-18T02:00:00.000Z'
  );

  const merged = mergePersistedSeriesContext(previous, incoming);

  assert.deepEqual(
    merged.history?.games.slice(0, 2).map(value => value.winner?.id ?? null),
    ['blue', 'red']
  );
  assert.equal(merged.history?.games[2]?.state, 'live');
});

test('a sweep score plus matching completed games clears only the impossible trailing live slot', () => {
  const incoming = historyContext(
    [3, 0],
    [
      game(1, 'completed'),
      game(2, 'completed'),
      game(3, 'completed'),
      game(4, 'live')
    ],
    5
  );

  const merged = mergePersistedSeriesContext(null, incoming);
  const final = verifiedFinalEventFromContext(event(5), merged);

  assert.deepEqual(
    merged.history?.games.map(value => [value.state, value.winner?.id ?? null]),
    [
      ['completed', 'blue'],
      ['completed', 'blue'],
      ['completed', 'blue'],
      ['unstarted', null]
    ]
  );
  assert.equal(contextHasActiveGame(merged), false);
  assert.ok(final);
  assert.deepEqual(final.series.score?.map(entry => entry.wins), [3, 0]);
  assert.equal(final.series.games.length, 3);
});

test('a current active clinching game remains a veto even if older durable history marked it completed', () => {
  const previous = historyContext(
    [2, 1],
    [
      game(1, 'completed', blue),
      game(2, 'completed', red),
      game(3, 'completed', blue)
    ]
  );
  const incoming = historyContext(
    [2, 1],
    [
      game(1, 'completed'),
      game(2, 'completed'),
      game(3, 'live')
    ]
  );

  const merged = mergePersistedSeriesContext(previous, incoming);

  assert.equal(merged.history?.games[2]?.state, 'live');
  assert.equal(contextHasActiveGame(merged), true);
  assert.equal(verifiedFinalEventFromContext(event(), merged), null);
});
