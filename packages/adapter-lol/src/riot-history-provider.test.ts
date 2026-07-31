import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderSeries } from './provider.ts';
import { parseRiotSeriesHistory } from './riot-history-provider.ts';

const left = {
  id: 'normalized-left',
  name: 'Left Team',
  code: 'LEFT'
};
const right = {
  id: 'normalized-right',
  name: 'Right Team',
  code: 'RIGHT'
};

function series(bestOf: number): LolProviderSeries {
  return {
    id: `series-bo${bestOf}`,
    competition: { id: 'test-league', name: 'Test League' },
    teams: [left, right],
    bestOf,
    state: 'completed',
    scheduledStart: '2026-07-31T08:00:00.000Z',
    games: Array.from({ length: bestOf }, (_, index) => ({
      id: `game-${index + 1}`,
      number: index + 1,
      state: 'completed' as const
    }))
  };
}

function details(bestOf: number, winners: readonly ('left' | 'right')[]) {
  const leftWins = winners.filter(winner => winner === 'left').length;
  const rightWins = winners.filter(winner => winner === 'right').length;
  return {
    data: {
      event: {
        id: `series-bo${bestOf}`,
        match: {
          strategy: { type: 'bestOf', count: bestOf },
          teams: [
            { id: 'raw-parent-left', result: { gameWins: leftWins } },
            { id: 'raw-parent-right', result: { gameWins: rightWins } }
          ],
          games: winners.map((winner, index) => {
            const leftSide = index % 2 === 0 ? 'blue' : 'red';
            const rightSide = leftSide === 'blue' ? 'red' : 'blue';
            const duration = index === 0
              ? { durationSeconds: 1_801 }
              : index === 1
                ? { duration: '31:02' }
                : { gameDuration: 1_850_000 };
            return {
              id: `game-${index + 1}`,
              number: index + 1,
              state: 'completed',
              ...duration,
              teams: [
                {
                  id: 'raw-parent-left',
                  side: leftSide,
                  result: { outcome: winner === 'left' ? 'win' : 'loss' }
                },
                {
                  id: 'raw-parent-right',
                  side: rightSide,
                  result: { outcome: winner === 'right' ? 'win' : 'loss' }
                }
              ]
            };
          })
        }
      }
    }
  };
}

const formats = [
  { bestOf: 2, winners: ['left', 'right'] as const, score: [1, 1] as const, required: 2, draw: true },
  { bestOf: 3, winners: ['left', 'right', 'left'] as const, score: [2, 1] as const, required: 2, draw: false },
  {
    bestOf: 5,
    winners: ['left', 'right', 'right', 'left', 'left'] as const,
    score: [3, 2] as const,
    required: 3,
    draw: false
  }
];

for (const format of formats) {
  test(`normalizes BO${format.bestOf} score, winners, sides, and duration`, () => {
    const history = parseRiotSeriesHistory(series(format.bestOf), details(format.bestOf, format.winners));

    assert.equal(history.bestOf, format.bestOf);
    assert.equal(history.winsRequired, format.required);
    assert.equal(history.drawPossible, format.draw);
    assert.deepEqual(history.score.map(row => row.wins), [...format.score]);
    assert.equal(history.games.length, format.bestOf);
    assert.deepEqual(
      history.games.map(game => game.winner?.id),
      format.winners.map(winner => winner === 'left' ? left.id : right.id)
    );
    assert.equal(history.games[0]?.blueTeam?.id, left.id);
    assert.equal(history.games[0]?.redTeam?.id, right.id);
    assert.equal(history.games[1]?.blueTeam?.id, right.id);
    assert.equal(history.games[1]?.redTeam?.id, left.id);
    assert.equal(history.games[0]?.durationSeconds, 1_801);
    assert.equal(history.games[1]?.durationSeconds, 1_862);
    if (format.bestOf >= 3) assert.equal(history.games[2]?.durationSeconds, 1_850);
  });
}

test('keeps unknown results explicit when Riot only publishes game slots', () => {
  const history = parseRiotSeriesHistory(series(3), {
    data: {
      event: {
        match: {
          strategy: { count: 3 },
          teams: [
            { id: 'raw-parent-left', result: { gameWins: 0 } },
            { id: 'raw-parent-right', result: { gameWins: 0 } }
          ],
          games: [{
            id: 'game-1',
            number: 1,
            state: 'unstarted',
            teams: [
              { id: 'raw-parent-left', side: 'blue' },
              { id: 'raw-parent-right', side: 'red' }
            ]
          }]
        }
      }
    }
  });

  assert.equal(history.games[0]?.state, 'unstarted');
  assert.equal(history.games[0]?.winner, null);
  assert.equal(history.games[0]?.durationSeconds, null);
  assert.equal(history.games[0]?.blueTeam?.id, left.id);
  assert.equal(history.games[0]?.redTeam?.id, right.id);
});
