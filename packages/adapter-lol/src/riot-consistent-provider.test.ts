import test from 'node:test';
import assert from 'node:assert/strict';
import type { SeriesHistoryRef, TeamRef } from '@esports-live/core';
import type { LolProviderSnapshot } from './provider.ts';
import { mergeMonotonicSnapshot, mergeObservedSeriesHistory, reconcileSeriesHistory } from './riot-consistent-provider.ts';
import type { LolPlayerState, LolStats, LolTeamState } from './types.ts';

const left: TeamRef = { id: 'left', name: 'Left', code: 'L' };
const right: TeamRef = { id: 'right', name: 'Right', code: 'R' };

function player(id: string, items: readonly string[] | null): LolPlayerState {
  return {
    id,
    handle: `P${id}`,
    championId: `C${id}`,
    role: 'top',
    level: 10,
    kills: 1,
    deaths: 1,
    assists: 1,
    creepScore: 100,
    totalGold: 8000,
    items
  };
}

function team(side: 'blue' | 'red', gold: number, items: readonly string[] | null): LolTeamState {
  const offset = side === 'blue' ? 0 : 5;
  return {
    id: side,
    name: side,
    side,
    gold,
    kills: 5,
    objectives: { towers: 2, inhibitors: 0, dragons: [], barons: 0, heralds: 1 },
    players: Array.from({ length: 5 }, (_, index) => player(String(index + 1 + offset), items))
  };
}

function snapshot(sourceTimestamp: string, clock: number, items: readonly string[] | null): LolProviderSnapshot {
  const stats: LolStats = {
    gameClockSeconds: clock,
    patch: '16.14',
    blue: team('blue', 30000 + clock, items),
    red: team('red', 29000 + clock, items)
  };
  return {
    series: {
      id: 'series',
      competition: { id: 'lck', name: 'LCK' },
      teams: [left, right],
      bestOf: 3,
      state: 'live',
      scheduledStart: '2026-07-31T10:00:00.000Z',
      games: [{ id: 'game', number: 1, state: 'live' }]
    },
    game: { id: 'game', number: 1, state: 'live' },
    sourceTimestamp,
    observedAt: sourceTimestamp,
    advancing: true,
    complete: items !== null,
    stats,
    ...(items === null ? {
      reasons: [{ code: 'missing_field', message: 'items missing', field: 'blue.players.0.items' }]
    } : {})
  };
}

test('older snapshots cannot replace newer telemetry', () => {
  const current = snapshot('2026-07-31T10:10:00.000Z', 600, ['3006']);
  const older = snapshot('2026-07-31T10:09:30.000Z', 570, null);
  const merged = mergeMonotonicSnapshot(current, older);
  assert.equal(merged.sourceTimestamp, current.sourceTimestamp);
  assert.equal(merged.stats?.gameClockSeconds, 600);
  assert.deepEqual(merged.stats?.blue.players[0]?.items, ['3006']);
});

test('newer partial snapshots retain previously verified item inventories', () => {
  const current = snapshot('2026-07-31T10:10:00.000Z', 600, ['3006']);
  const newer = snapshot('2026-07-31T10:10:10.000Z', 610, null);
  const merged = mergeMonotonicSnapshot(current, newer);
  assert.equal(merged.sourceTimestamp, newer.sourceTimestamp);
  assert.equal(merged.stats?.gameClockSeconds, 610);
  assert.deepEqual(merged.stats?.blue.players[0]?.items, ['3006']);
});

function history(score: readonly [number, number], gameCount: number): SeriesHistoryRef {
  return {
    bestOf: 3,
    winsRequired: 2,
    drawPossible: false,
    score: [{ team: left, wins: score[0] }, { team: right, wins: score[1] }],
    games: Array.from({ length: gameCount }, (_, index) => ({
      id: `g${index + 1}`,
      number: index + 1,
      state: 'completed' as const,
      blueTeam: index % 2 === 0 ? left : right,
      redTeam: index % 2 === 0 ? right : left,
      winner: null,
      durationSeconds: 1800
    }))
  };
}

test('sweep scores resolve every completed game winner', () => {
  const reconciled = reconcileSeriesHistory(history([2, 0], 2));
  assert.deepEqual(reconciled.games.map(game => game.winner?.id), ['left', 'left']);
});

test('the final clinching game resolves without guessing ambiguous earlier games', () => {
  const reconciled = reconcileSeriesHistory(history([2, 1], 3));
  assert.equal(reconciled.games[2]?.winner?.id, 'left');
  assert.equal(reconciled.games[0]?.winner, null);
  assert.equal(reconciled.games[1]?.winner, null);
});

test('a single completed game resolves from a 1-0 score', () => {
  const reconciled = reconcileSeriesHistory(history([0, 1], 1));
  assert.equal(reconciled.games[0]?.winner?.id, 'right');
});


test('official score transitions preserve every observed completed-game winner', () => {
  const first = mergeObservedSeriesHistory(undefined, history([1, 0], 1));
  const second = mergeObservedSeriesHistory(first, history([1, 1], 2));
  const final = mergeObservedSeriesHistory(second, history([2, 1], 3));
  assert.deepEqual(final.games.map(game => game.winner?.id), ['left', 'right', 'left']);
});

test('first-seen split series keeps ambiguous early winners unresolved', () => {
  const merged = mergeObservedSeriesHistory(undefined, history([2, 1], 3));
  assert.deepEqual(merged.games.map(game => game.winner?.id ?? null), [null, null, 'left']);
});
