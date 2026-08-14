import test from 'node:test';
import assert from 'node:assert/strict';
import { DotaAdapter } from './adapter.ts';
import { createFallbackDotaProvider } from './fallback-provider.ts';
import type { DotaProviderClient } from './provider.ts';
import { createSteamDotaProvider } from './steam-provider.ts';

const NOW = new Date('2026-08-14T08:00:10.000Z');
const SOURCE_SECONDS = Date.parse('2026-08-14T08:00:00.000Z') / 1_000;

const topLivePayload = {
  game_list: [
    {
      activate_time: Date.parse('2026-08-14T07:42:00.000Z') / 1_000,
      deactivate_time: 0,
      delay: 120,
      league_id: 19719,
      match_id: 'valve-game-one',
      server_steam_id: '90270000000000001',
      series_id: 1200444,
      game_time: 1_085,
      last_update_time: SOURCE_SECONDS,
      team_id_radiant: 10,
      team_id_dire: 20,
      team_name_radiant: 'Team Falcons',
      team_name_dire: 'LGD Gaming',
      radiant_score: 11,
      dire_score: 7,
      radiant_lead: 4_250,
      spectators: 7_001,
      players: [
        { account_id: 1, hero_id: 1, team: 0, team_slot: 1 },
        { account_id: 2, hero_id: 2, team: 1, team_slot: 1 }
      ]
    },
    {
      activate_time: Date.parse('2026-08-14T07:45:00.000Z') / 1_000,
      deactivate_time: 0,
      league_id: 0,
      match_id: 'public-game',
      game_time: 900,
      last_update_time: SOURCE_SECONDS,
      team_name_radiant: '',
      team_name_dire: '',
      radiant_score: 5,
      dire_score: 4,
      radiant_lead: 100,
      players: []
    }
  ]
};

const heroesPayload = {
  result: {
    heroes: [
      { id: 1, name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage' },
      { id: 2, name: 'npc_dota_hero_axe', localized_name: 'Axe' }
    ]
  }
};

const realtimePayload = {
  match: {
    server_steam_id: '90270000000000001',
    matchId: 'valve-game-one',
    timestamp: Date.parse('2026-08-14T08:00:08.000Z') / 1_000,
    game_time: 1_092,
    league_id: 19719
  },
  teams: [
    { team_number: 2, team_id: 10, team_name: 'Team Falcons', score: 12 },
    { team_number: 3, team_id: 20, team_name: 'LGD Gaming', score: 8 }
  ],
  buildings: [],
  graph_data: { graph_gold: [4_250, 4_800, 5_120] },
  delta_frame: false
};

function provider(requests: URL[]) {
  return createSteamDotaProvider({
    apiKey: 'private-steam-key',
    now: () => new Date(NOW),
    fetcher: async input => {
      const url = new URL(String(input));
      requests.push(url);
      const payload = url.pathname.includes('GetHeroes')
        ? heroesPayload
        : url.pathname.includes('GetRealtimeStats')
          ? realtimePayload
          : topLivePayload;
      return Response.json(payload);
    }
  });
}

test('Valve schedule exposes only active professional Dota games', async () => {
  const requests: URL[] = [];
  const adapter = new DotaAdapter(provider(requests));
  const schedule = await adapter.getSchedule({ states: ['live'] });

  assert.equal(schedule.length, 1);
  assert.equal(schedule[0]?.provider.name, 'Valve Dota Live');
  assert.equal(schedule[0]?.series.id, 'steam-series:1200444');
  assert.equal(schedule[0]?.series.competition.name, 'Dota 2 League 19719');
  assert.deepEqual(schedule[0]?.series.teams.map(team => team.name), [
    'Team Falcons',
    'LGD Gaming'
  ]);
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.pathname ?? '', /GetTopLiveGame/);
  assert.equal(requests[0]?.searchParams.get('key'), 'private-steam-key');
  assert.equal(requests[0]?.searchParams.get('partner'), '1');
});

test('Valve snapshot prefers newer realtime scores, clock, and gold lead', async () => {
  const requests: URL[] = [];
  const adapter = new DotaAdapter(provider(requests));
  const snapshot = await adapter.getLiveSnapshot(
    'valve-game-one',
    '2026-08-14T07:59:50.000Z'
  );

  assert.equal(snapshot.stats?.gameClockSeconds, 1_092);
  assert.equal(snapshot.stats?.radiant.kills, 12);
  assert.equal(snapshot.stats?.dire.kills, 8);
  assert.equal(snapshot.stats?.radiantNetWorthLead, 5_120);
  assert.equal(snapshot.stats?.spectators, 7_001);
  assert.equal(snapshot.stats?.radiant.players[0]?.heroName, 'Anti-Mage');
  assert.equal(snapshot.stats?.dire.players[0]?.heroName, 'Axe');
  assert.match(snapshot.stats?.radiant.players[0]?.heroImageUrl ?? '', /antimage\.png$/);
  assert.equal(snapshot.quality.freshness, 'fresh');
  assert.equal(snapshot.quality.safeForLiveAnalysis, true);
  assert.ok(snapshot.quality.reasons.some(reason => reason.code === 'realtime_stats_provider'));
  assert.equal(requests.filter(url => url.pathname.includes('GetTopLiveGame')).length, 1);
  assert.equal(requests.filter(url => url.pathname.includes('GetHeroes')).length, 1);
  const realtimeRequest = requests.find(url => url.pathname.includes('GetRealtimeStats'));
  assert.equal(realtimeRequest?.searchParams.get('server_steam_id'), '90270000000000001');
});

test('Valve snapshot keeps top-live telemetry when realtime access is rejected', async () => {
  const valve = createSteamDotaProvider({
    apiKey: 'private-steam-key',
    now: () => new Date(NOW),
    fetcher: async input => {
      const path = new URL(String(input)).pathname;
      if (path.includes('GetHeroes')) return Response.json(heroesPayload);
      if (path.includes('GetRealtimeStats')) {
        return new Response('forbidden', { status: 403 });
      }
      return Response.json(topLivePayload);
    }
  });
  const snapshot = await new DotaAdapter(valve).getLiveSnapshot('valve-game-one');

  assert.equal(snapshot.stats?.gameClockSeconds, 1_085);
  assert.equal(snapshot.stats?.radiant.kills, 11);
  assert.equal(snapshot.stats?.dire.kills, 7);
  assert.ok(snapshot.quality.reasons.some(reason => (
    reason.code === 'realtime_stats_unavailable'
    && reason.message.includes('403')
  )));
});

test('fallback is used on failure but not for a valid empty Valve feed', async () => {
  let primaryScheduleCalls = 0;
  let fallbackScheduleCalls = 0;
  const emptyPrimary: DotaProviderClient = {
    id: 'primary',
    name: 'Primary',
    async getSchedule() {
      primaryScheduleCalls += 1;
      return [];
    },
    async getSnapshot() {
      throw new Error('not found');
    }
  };
  const fallback: DotaProviderClient = {
    id: 'fallback',
    name: 'Fallback',
    async getSchedule() {
      fallbackScheduleCalls += 1;
      return [];
    },
    async getSnapshot() {
      throw new Error('not found');
    }
  };

  const providerWithFallback = createFallbackDotaProvider(emptyPrimary, fallback);
  assert.deepEqual(await providerWithFallback.getSchedule(), []);
  assert.equal(primaryScheduleCalls, 1);
  assert.equal(fallbackScheduleCalls, 0);

  const failingPrimary: DotaProviderClient = {
    ...emptyPrimary,
    async getSchedule() {
      throw new Error('Valve unavailable');
    }
  };
  assert.deepEqual(
    await createFallbackDotaProvider(failingPrimary, fallback).getSchedule(),
    []
  );
  assert.equal(fallbackScheduleCalls, 1);
});

test('Valve request failures never expose the private API key', async () => {
  const valve = createSteamDotaProvider({
    apiKey: 'do-not-expose-this-key',
    fetcher: async input => {
      throw new Error(`failed request: ${String(input)}`);
    }
  });

  await assert.rejects(
    valve.getSchedule(),
    error => error instanceof Error
      && error.message === 'Valve Dota Live request failed.'
      && !error.message.includes('do-not-expose-this-key')
  );
});
