import test from 'node:test';
import assert from 'node:assert/strict';
import type { LolProviderSeries, LolProviderSnapshot } from './provider.ts';
import { createRiotGrubsRecovery, parseRiotSeriesHistory } from './riot-history-provider.ts';

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

function finalSnapshotWithoutGrubs(): LolProviderSnapshot {
  const match = series(3);
  return {
    series: match,
    game: match.games[2]!,
    sourceTimestamp: '2026-08-10T10:31:35.000Z',
    observedAt: '2026-08-10T10:31:36.000Z',
    advancing: false,
    complete: true,
    stats: {
      gameClockSeconds: 31 * 60 + 35,
      patch: '26.15.1',
      blue: {
        id: left.id,
        name: left.name,
        side: 'blue',
        gold: 55_000,
        kills: 13,
        objectives: {
          towers: 8,
          inhibitors: 1,
          dragons: ['infernal', 'cloud', 'mountain', 'ocean'],
          barons: 1,
          heralds: 1,
          grubs: null
        },
        players: []
      },
      red: {
        id: right.id,
        name: right.name,
        side: 'red',
        gold: 45_000,
        kills: 7,
        objectives: {
          towers: 1,
          inhibitors: 0,
          dragons: ['hextech'],
          barons: 0,
          heralds: 0,
          grubs: null
        },
        players: []
      }
    }
  };
}

test('recovers final-game Grubs from earlier Riot windows and caches the result', async () => {
  const requested: URL[] = [];
  const recover = createRiotGrubsRecovery(async input => {
    const url = new URL(String(input));
    requested.push(url);
    return new Response(JSON.stringify({
      frames: [{
        rfc460Timestamp: url.searchParams.get('startingTime'),
        blueTeam: {
          objectives: { horde: { kills: 4 } }
        },
        redTeam: {
          objectiveCounts: { grubs: [{}, {}] }
        }
      }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }, 'test-key');

  const snapshot = finalSnapshotWithoutGrubs();
  const recovered = await recover('game-3', snapshot);

  assert.equal(recovered.stats?.blue.objectives.grubs, 4);
  assert.equal(recovered.stats?.red.objectives.grubs, 2);
  assert.equal(requested.length, 4);
  assert.ok(requested.every(url => url.pathname.endsWith('/window/game-3')));
  assert.ok(requested.every(url => url.searchParams.has('startingTime')));

  const repeated = await recover('game-3', snapshot);
  assert.equal(repeated.stats?.blue.objectives.grubs, 4);
  assert.equal(repeated.stats?.red.objectives.grubs, 2);
  assert.equal(requested.length, 4);
});

test('does not issue history probes when the current Riot frame already has Grubs', async () => {
  let requests = 0;
  const recover = createRiotGrubsRecovery(async () => {
    requests += 1;
    return new Response(null, { status: 404 });
  }, 'test-key');
  const snapshot = finalSnapshotWithoutGrubs();
  snapshot.stats!.blue.objectives.grubs = 3;
  snapshot.stats!.red.objectives.grubs = 0;

  const recovered = await recover('game-3', snapshot);
  assert.equal(recovered.stats?.blue.objectives.grubs, 3);
  assert.equal(recovered.stats?.red.objectives.grubs, 0);
  assert.equal(requests, 0);
});
