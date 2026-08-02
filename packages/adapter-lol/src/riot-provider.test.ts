import test from 'node:test';
import assert from 'node:assert/strict';
import { LolAdapter } from './adapter.ts';
import { createRiotLolProvider, riotWindowProbeTimes } from './riot-provider.ts';

const NOW = '2026-07-31T08:10:00.000Z';
const SOURCE = '2026-07-31T08:09:50.000Z';

function json(value: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function eventPayload() {
  return {
    data: {
      event: {
        id: 'match-1',
        state: 'inProgress',
        startTime: '2026-07-31T08:00:00.000Z',
        league: { id: 'lck', name: 'LCK', region: 'KR' },
        match: {
          id: 'match-1',
          strategy: { count: 3 },
          teams: [
            { id: 'team-a', name: 'Team A', code: 'A' },
            { id: 'team-b', name: 'Team B', code: 'B' }
          ],
          games: [{
            id: 'game-1',
            number: 1,
            state: 'inProgress',
            teams: [
              { id: 'team-a', side: 'blue' },
              { id: 'team-b', side: 'red' }
            ],
            vods: [{ firstFrameTime: '2026-07-31T08:00:00.000Z', startMillis: 0 }]
          }]
        }
      }
    }
  };
}

function participant(id: number) {
  return {
    participantId: id,
    level: 7,
    kills: id === 1 ? 2 : 0,
    deaths: 0,
    assists: 1,
    creepScore: 70,
    totalGold: 6000
  };
}

function windowPayload() {
  const metadata = (start: number) => Array.from({ length: 5 }, (_, index) => ({
    participantId: start + index,
    summonerName: `Player ${start + index}`,
    championId: `Champion${start + index}`,
    role: ['top', 'jungle', 'mid', 'bottom', 'support'][index]
  }));
  return {
    esportsMatchId: 'match-1',
    gameMetadata: {
      esportsMatchId: 'match-1',
      patchVersion: '26.14',
      blueTeamMetadata: { esportsTeamId: 'team-a', participantMetadata: metadata(1) },
      redTeamMetadata: { esportsTeamId: 'team-b', participantMetadata: metadata(6) }
    },
    frames: [{
      rfc460Timestamp: SOURCE,
      blueTeam: {
        totalGold: 30000,
        totalKills: 2,
        towers: 2,
        inhibitors: 0,
        dragons: ['infernal'],
        barons: 0,
        heralds: 1,
        objectives: { horde: { kills: 4 } },
        participants: Array.from({ length: 5 }, (_, index) => participant(index + 1))
      },
      redTeam: {
        totalGold: 28500,
        totalKills: 0,
        towers: 1,
        inhibitors: 0,
        dragons: [],
        barons: 0,
        heralds: 0,
        objectives: { horde: { kills: 2 } },
        participants: Array.from({ length: 5 }, (_, index) => participant(index + 6))
      }
    }]
  };
}

function detailsPayload() {
  const older = new Date(Date.parse(SOURCE) - 10_000).toISOString();
  return {
    frames: [
      {
        rfc460Timestamp: older,
        participants: Array.from({ length: 10 }, (_, index) => ({
          ...participant(index + 1),
          kills: 1,
          items: [{ itemID: 1001 }]
        }))
      },
      {
        rfc460Timestamp: SOURCE,
        participants: Array.from({ length: 10 }, (_, index) => ({
          ...participant(index + 1),
          kills: 4,
          items: [{ itemID: 3006 }, { itemID: 3363 }]
        }))
      }
    ]
  };
}

function fetcher(options: { includeDetails?: boolean } = {}) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getSchedule')) {
      return json({ data: { schedule: { events: [eventPayload().data.event] } } });
    }
    if (url.pathname.endsWith('/getEventDetails')) return json(eventPayload());
    if (url.pathname.includes('/window/game-1')) return json(windowPayload());
    if (url.pathname.includes('/details/game-1')) {
      return options.includeDetails === false ? json(null, 204) : json(detailsPayload());
    }
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };
}

test('Riot live-window probes are bounded and include delayed anchors', () => {
  const probes = riotWindowProbeTimes(Date.parse(NOW));
  assert.deepEqual(probes, [
    null,
    '2026-07-31T08:09:40.000Z',
    '2026-07-31T08:09:00.000Z',
    '2026-07-31T08:08:00.000Z',
    '2026-07-31T08:06:00.000Z',
    '2026-07-31T08:04:00.000Z'
  ]);
});

test('Riot provider normalizes schedule entries', async () => {
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: fetcher(),
    now: () => new Date(NOW)
  });
  const schedule = await provider.getSchedule();
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0]?.series.id, 'match-1');
  assert.equal(schedule[0]?.series.competition.id, 'lck');
  assert.equal(schedule[0]?.series.games[0]?.id, 'game-1');
});

test('Riot provider includes the first older schedule page', async () => {
  const upcomingEvent = eventPayload().data.event;
  upcomingEvent.id = 'upcoming-event';
  upcomingEvent.match.id = 'upcoming-match';
  upcomingEvent.state = 'unstarted';
  const liveEvent = structuredClone(eventPayload().data.event);
  liveEvent.id = 'older-live-event';
  liveEvent.match.id = 'older-live-match';
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (!url.pathname.endsWith('/getSchedule')) {
        return json({ error: 'unexpected_url', url: url.toString() }, 500);
      }
      if (url.searchParams.get('pageToken') === 'older-page') {
        return json({ data: { schedule: { events: [liveEvent], pages: {} } } });
      }
      return json({
        data: { schedule: { events: [upcomingEvent], pages: { older: 'older-page' } } }
      });
    },
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.deepEqual(schedule.map(entry => [entry.series.id, entry.series.state]), [
    ['upcoming-match', 'scheduled'],
    ['older-live-match', 'live']
  ]);
});

test('Riot provider treats a non-clinching partial score as live when the schedule state is stale', async () => {
  const staleEvent = eventPayload().data.event;
  staleEvent.state = 'unstarted';
  staleEvent.match.games = [];
  staleEvent.match.teams = staleEvent.match.teams.map((team, index) => ({
    ...team,
    result: { gameWins: index, outcome: null }
  }));
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/getSchedule')) {
        return json({ data: { schedule: { events: [staleEvent] } } });
      }
      return json({ error: 'unexpected_url', url: url.toString() }, 500);
    },
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'live');
});

test('Riot provider does not infer live after a team has clinched the series', async () => {
  const completedEvent = eventPayload().data.event;
  completedEvent.state = 'completed';
  completedEvent.match.teams = completedEvent.match.teams.map((team, index) => ({
    ...team,
    result: { gameWins: index === 0 ? 2 : 0, outcome: null }
  }));
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/getSchedule')) {
        return json({ data: { schedule: { events: [completedEvent] } } });
      }
      return json({ error: 'unexpected_url', url: url.toString() }, 500);
    },
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'completed');
});

test('Riot provider emits a complete normalized gameplay snapshot', async () => {
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: fetcher(),
    now: () => new Date(NOW)
  });
  const adapter = new LolAdapter(provider);
  const snapshot = await adapter.getLiveSnapshot('game-1');

  assert.equal(snapshot.series.state, 'live');
  assert.equal(snapshot.game.state, 'live');
  assert.equal(snapshot.stats?.gameClockSeconds, 590);
  assert.equal(snapshot.stats?.blue.gold, 30000);
  assert.equal(snapshot.stats?.blue.objectives.grubs, 4);
  assert.deepEqual(snapshot.stats?.blue.players[0]?.items, ['3006', '3363']);
  assert.equal(snapshot.stats?.blue.players[0]?.kills, 4);
  assert.equal(snapshot.quality.freshness, 'fresh');
  assert.equal(snapshot.quality.complete, true);
  assert.equal(snapshot.quality.safeForLiveAnalysis, true);
});

test('missing Riot detail frames remain visible but unsafe', async () => {
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: fetcher({ includeDetails: false }),
    now: () => new Date(NOW)
  });
  const adapter = new LolAdapter(provider);
  const snapshot = await adapter.getLiveSnapshot('game-1');

  assert.equal(snapshot.stats?.blue.gold, 30000);
  assert.equal(snapshot.stats?.blue.players[0]?.items, null);
  assert.equal(snapshot.quality.complete, false);
  assert.equal(snapshot.quality.safeForLiveAnalysis, false);
  assert.ok(snapshot.quality.reasons.some(reason => reason.field === 'blue.players.0.items'));
});

test('aligns team and participant frames before normalization', async () => {
  const older = new Date(Date.parse(SOURCE) - 10_000).toISOString();
  const requested: URL[] = [];
  const customFetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.pathname.endsWith('/getEventDetails')) return json(eventPayload());
    if (url.pathname.includes('/window/game-1')) {
      const payload = windowPayload();
      const newestFrame = payload.frames[0]!;
      payload.frames = [
        {
          ...structuredClone(newestFrame),
          rfc460Timestamp: older,
          blueTeam: { ...structuredClone(newestFrame.blueTeam), totalGold: 29000 },
          redTeam: { ...structuredClone(newestFrame.redTeam), totalGold: 28000 }
        },
        newestFrame
      ];
      return json(payload);
    }
    if (url.pathname.includes('/details/game-1')) {
      return json({
        frames: [{
          rfc460Timestamp: older,
          participants: Array.from({ length: 10 }, (_, index) => ({
            ...participant(index + 1),
            items: [{ itemID: 3006 }]
          }))
        }]
      });
    }
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };

  const adapter = new LolAdapter(createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: customFetcher,
    now: () => new Date(NOW)
  }));
  const snapshot = await adapter.getLiveSnapshot('game-1');

  assert.equal(snapshot.quality.sourceTimestamp, older);
  assert.equal(snapshot.stats?.blue.gold, 29000);
  assert.deepEqual(snapshot.stats?.blue.players[0]?.items, ['3006']);
  const detailRequest = requested.find(url => url.pathname.includes('/details/game-1'));
  assert.equal(detailRequest?.searchParams.get('startingTime'), '2026-07-31T08:08:50.000Z');
  assert.equal(detailRequest?.searchParams.has('participantIds'), false);
});


test('uses the opening Riot window frame as a game-clock fallback', async () => {
  const opening = '2026-07-31T08:00:00.000Z';
  const current = '2026-07-31T08:09:50.000Z';
  const customFetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getEventDetails')) {
      const payload = eventPayload();
      payload.data.event.match.games[0]!.vods = [];
      return json(payload);
    }
    if (url.pathname.includes('/window/game-1')) {
      const payload = windowPayload();
      if (!url.searchParams.has('startingTime')) {
        const frame = structuredClone(payload.frames[0]!);
        frame.rfc460Timestamp = opening;
        frame.blueTeam.totalGold = 0;
        frame.redTeam.totalGold = 0;
        frame.blueTeam.participants = frame.blueTeam.participants.map(player => ({ ...player, creepScore: 0, level: 1 }));
        frame.redTeam.participants = frame.redTeam.participants.map(player => ({ ...player, creepScore: 0, level: 1 }));
        payload.frames = [frame];
      } else {
        payload.frames[0]!.rfc460Timestamp = current;
      }
      return json(payload);
    }
    if (url.pathname.includes('/details/game-1')) return json(detailsPayload());
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };

  const adapter = new LolAdapter(createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: customFetcher,
    now: () => new Date(NOW)
  }));
  const snapshot = await adapter.getLiveSnapshot('game-1');
  assert.equal(snapshot.stats?.gameClockSeconds, 590);
});

test('reuses the direct opening frame when the cursor has not advanced', async () => {
  let windowRequests = 0;
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    includeDetails: false,
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/getEventDetails')) return json(eventPayload());
      if (url.pathname.includes('/window/game-1')) {
        windowRequests += 1;
        return json(windowPayload());
      }
      return json({ error: 'unexpected_url', url: url.toString() }, 500);
    },
    now: () => new Date(NOW)
  });

  await provider.getSnapshot('game-1');
  const repeated = await provider.getSnapshot('game-1', SOURCE);

  assert.equal(windowRequests, 2);
  assert.equal(repeated.sourceTimestamp, SOURCE);
  assert.ok(repeated.stats);
});

test('returns live telemetry before slow event metadata enrichment finishes', async () => {
  const provider = createRiotLolProvider({
    apiKey: 'test-key',
    includeDetails: false,
    eventDetailsWaitBudgetMs: 5,
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/getEventDetails')) {
        await new Promise(resolve => setTimeout(resolve, 50));
        return json(eventPayload());
      }
      if (url.pathname.includes('/window/game-1')) return json(windowPayload());
      return json({ error: 'unexpected_url', url: url.toString() }, 500);
    },
    now: () => new Date(NOW)
  });

  const started = Date.now();
  const result = await provider.getSnapshot('game-1');

  assert.ok(Date.now() - started < 40);
  assert.equal(result.sourceTimestamp, SOURCE);
  assert.ok(result.stats);
});
