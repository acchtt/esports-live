import test from 'node:test';
import assert from 'node:assert/strict';
import { DotaAdapter } from './adapter.ts';
import { createOpenDotaProvider } from './opendota-provider.ts';

const NOW = new Date('2026-08-13T10:30:10.000Z');
const SOURCE_SECONDS = Date.parse('2026-08-13T10:30:00.000Z') / 1_000;

const livePayload = [
  {
    activate_time: Date.parse('2026-08-13T09:45:00.000Z') / 1_000,
    deactivate_time: Date.parse('2026-08-13T10:10:00.000Z') / 1_000,
    league_id: 19719,
    match_id: 'game-one',
    series_id: 1130024,
    game_time: 1_500,
    last_update_time: Date.parse('2026-08-13T10:10:00.000Z') / 1_000,
    team_id_radiant: 10,
    team_id_dire: 20,
    team_name_radiant: 'Team Falcons',
    team_name_dire: 'LGD Gaming',
    radiant_score: 22,
    dire_score: 36,
    radiant_lead: -28_894,
    players: []
  },
  {
    activate_time: Date.parse('2026-08-13T10:17:00.000Z') / 1_000,
    deactivate_time: 0,
    delay: 120,
    league_id: 19719,
    match_id: 'game-two',
    series_id: 1130024,
    game_time: 725,
    last_update_time: SOURCE_SECONDS,
    team_id_radiant: 10,
    team_id_dire: 20,
    team_name_radiant: 'Team Falcons',
    team_name_dire: 'LGD Gaming',
    radiant_score: 3,
    dire_score: 1,
    radiant_lead: 3_204,
    spectators: 6_873,
    players: [
      { account_id: 1, hero_id: 1, team: 0, team_slot: 1 },
      { account_id: 2, hero_id: 2, team: 1, team_slot: 1 }
    ]
  },
  {
    activate_time: Date.parse('2026-08-13T10:00:00.000Z') / 1_000,
    deactivate_time: 0,
    league_id: 0,
    match_id: 'public-game',
    series_id: 0,
    game_time: 900,
    last_update_time: SOURCE_SECONDS,
    team_name_radiant: '',
    team_name_dire: '',
    radiant_score: 10,
    dire_score: 8,
    radiant_lead: 500,
    players: []
  },
  {
    activate_time: Date.parse('2026-08-13T07:00:00.000Z') / 1_000,
    deactivate_time: 0,
    league_id: 19719,
    match_id: 'ghost-game',
    series_id: 999999,
    game_time: 51,
    last_update_time: Date.parse('2026-08-13T07:01:00.000Z') / 1_000,
    team_name_radiant: 'Ghost Radiant',
    team_name_dire: 'Ghost Dire',
    radiant_score: 0,
    dire_score: 0,
    radiant_lead: 0,
    players: []
  }
];

const heroesPayload = {
  1: { id: 1, localized_name: 'Anti-Mage', img: '/apps/dota2/images/dota_react/heroes/antimage.png' },
  2: { id: 2, localized_name: 'Axe', img: '/apps/dota2/images/dota_react/heroes/axe.png' }
};

const leaguesPayload = [
  { leagueid: 19719, name: 'The International 2026', tier: 'premium' }
];

function provider() {
  return createOpenDotaProvider({
    now: () => new Date(NOW),
    fetcher: async input => {
      const path = new URL(String(input)).pathname;
      const payload = path.endsWith('/constants/heroes')
        ? heroesPayload
        : path.endsWith('/leagues')
          ? leaguesPayload
          : livePayload;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
}

test('OpenDota schedule keeps active league series and excludes public games', async () => {
  const adapter = new DotaAdapter(provider());
  const schedule = await adapter.getSchedule({ states: ['live'] });

  assert.equal(schedule.length, 1);
  assert.equal(schedule[0]?.series.esport, 'dota2');
  assert.equal(schedule[0]?.series.id, 'opendota-series:1130024');
  assert.equal(schedule[0]?.series.competition.name, 'The International 2026');
  assert.deepEqual(schedule[0]?.series.teams.map(team => team.name), ['Team Falcons', 'LGD Gaming']);
  assert.deepEqual(schedule[0]?.series.games, [
    { id: 'game-one', number: 1, state: 'completed' },
    { id: 'game-two', number: 2, state: 'live' }
  ]);
});

test('OpenDota snapshot normalizes Dota livescore telemetry and hero metadata', async () => {
  const adapter = new DotaAdapter(provider());
  const snapshot = await adapter.getLiveSnapshot(
    'game-two',
    '2026-08-13T10:29:50.000Z'
  );

  assert.equal(snapshot.esport, 'dota2');
  assert.equal(snapshot.game.number, 2);
  assert.equal(snapshot.stats?.gameClockSeconds, 725);
  assert.equal(snapshot.stats?.radiant.kills, 3);
  assert.equal(snapshot.stats?.dire.kills, 1);
  assert.equal(snapshot.stats?.radiantNetWorthLead, 3_204);
  assert.equal(snapshot.stats?.spectators, 6_873);
  assert.equal(snapshot.stats?.radiant.players[0]?.heroName, 'Anti-Mage');
  assert.equal(snapshot.stats?.dire.players[0]?.heroName, 'Axe');
  assert.equal(snapshot.quality.freshness, 'fresh');
  assert.equal(snapshot.quality.advancing, true);
  assert.equal(snapshot.quality.safeForLiveAnalysis, true);
});

test('OpenDota reuses the last good live feed while rate limited', async () => {
  let current = new Date(NOW);
  let liveCalls = 0;
  const openDota = createOpenDotaProvider({
    now: () => new Date(current),
    cacheTtlMs: 1_000,
    fetcher: async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/constants/heroes')) return Response.json(heroesPayload);
      if (path.endsWith('/leagues')) return Response.json(leaguesPayload);
      liveCalls += 1;
      if (liveCalls > 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '45' }
        });
      }
      return Response.json(livePayload);
    }
  });
  const adapter = new DotaAdapter(openDota);

  assert.equal((await adapter.getSchedule({ states: ['live'] })).length, 1);
  current = new Date(NOW.getTime() + 2_000);
  assert.equal((await adapter.getSchedule({ states: ['live'] })).length, 1);
  current = new Date(NOW.getTime() + 10_000);
  assert.equal((await adapter.getSchedule({ states: ['live'] })).length, 1);
  assert.equal(liveCalls, 2);
});
