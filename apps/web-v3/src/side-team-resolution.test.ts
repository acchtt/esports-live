import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScheduleEvent } from '@esports-live/core';
import type { LolPlayerState, LolTeamState } from '@esports-live/adapter-lol';
import { seriesTeamForSide } from './side-team-resolution.ts';

const imageUrl = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E';
const jdg = { id: 'team-1', name: 'Beijing JDG Esports', code: 'JDG', imageUrl };
const al = { id: 'team-2', name: "Anyone's Legend", code: 'AL', imageUrl };
const series = {
  id: '116566854547769728',
  esport: 'lol',
  competition: { id: 'lpl', name: 'LPL' },
  teams: [jdg, al],
  bestOf: 3,
  state: 'live',
  scheduledStart: '2026-08-14T11:00:00.000Z',
  games: [{ id: '116566854547769730', number: 2, state: 'live' }]
} satisfies ScheduleEvent['series'];
const event: ScheduleEvent = {
  series,
  provider: { id: 'fixture', name: 'Fixture' },
  observedAt: '2026-08-14T12:10:00.000Z'
};

function players(prefix: string): LolPlayerState[] {
  return ['Top', 'Jungle', 'Mid', 'Bottom', 'Support'].map((role, index) => ({
    id: `${prefix}-${index}`,
    handle: `${prefix}${role}`,
    championId: null,
    role: role.toLowerCase(),
    level: null,
    kills: null,
    deaths: null,
    assists: null,
    creepScore: null,
    totalGold: null,
    items: null
  }));
}

function statsTeam(id: string, name: string, side: 'blue' | 'red', prefix: string): LolTeamState {
  return {
    id,
    name,
    side,
    gold: null,
    kills: null,
    objectives: {
      towers: null,
      inhibitors: null,
      dragons: null,
      barons: null,
      heralds: null,
      grubs: null
    },
    players: players(prefix)
  };
}

test('uses player roster evidence instead of generic positional team IDs', () => {
  const blue = statsTeam('team-1', 'Blue team', 'blue', 'AL');
  const red = statsTeam('team-2', 'Red team', 'red', 'JDG');

  assert.equal(seriesTeamForSide(event, blue, 0)?.code, 'AL');
  assert.equal(seriesTeamForSide(event, red, 1)?.code, 'JDG');
});

test('keeps specific provider team IDs authoritative', () => {
  const numericEvent: ScheduleEvent = {
    ...event,
    series: {
      ...series,
      teams: [
        { ...jdg, id: '99566404852189289' },
        { ...al, id: '99566404856367466' }
      ]
    }
  };
  const blue = statsTeam('99566404856367466', 'Unknown', 'blue', 'JDG');

  assert.equal(seriesTeamForSide(numericEvent, blue, 0)?.code, 'AL');
});

test('falls back to an exact team name or code when roster data is unavailable', () => {
  const byName = statsTeam('team-1', "Anyone's Legend", 'blue', '');
  const byCode = statsTeam('team-2', 'JDG', 'red', '');
  byName.players = [];
  byCode.players = [];

  assert.equal(seriesTeamForSide(event, byName, 0)?.code, 'AL');
  assert.equal(seriesTeamForSide(event, byCode, 1)?.code, 'JDG');
});
