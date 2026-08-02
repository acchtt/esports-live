from __future__ import annotations

from pathlib import Path
import textwrap


ORIGINAL_CI = """name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Install dependencies
        run: npm install

      - name: Install Chromium
        run: npx playwright install --with-deps chromium

      - name: Typecheck and test
        run: npm run check

      - name: Browser stability smoke test
        run: npm run test:web
"""


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    if old not in source:
        raise RuntimeError(f"Expected source not found in {path}: {old[:120]!r}")
    file.write_text(source.replace(old, new, 1))


replace_once(
    "apps/web/src/main.ts",
    "const SNAPSHOT_POLL_MS = 5_000;",
    "const SNAPSHOT_POLL_MS = 500;",
)

replace_once(
    "apps/api/src/worker.ts",
    """        createRiotCurrentPlayerProvider(createRiotLolConsistentProvider({ apiKey }))
""",
    """        createRiotCurrentPlayerProvider(
          createRiotLolConsistentProvider({
            apiKey,
            includeDetails: false,
            useDetailItemFallback: false
          }),
          { useWindowOverlay: false }
        )
""",
)

replace_once(
    "apps/api/src/worker.ts",
    """    registry.register(new CachedAdapter(new LolAdapter(provider), {
      scheduleTtlMs: 45_000,
      seriesContextTtlMs: 45_000
    }));
""",
    """    registry.register(new CachedAdapter(new LolAdapter(provider), {
      scheduleTtlMs: 45_000,
      liveSnapshotTtlMs: 400,
      seriesContextTtlMs: 45_000
    }));
""",
)

replace_once(
    "packages/adapter-lol/src/riot-provider.ts",
    """  locale?: string;
  now?: () => Date;
}
""",
    """  locale?: string;
  now?: () => Date;
  includeDetails?: boolean;
  useDetailItemFallback?: boolean;
}
""",
)

replace_once(
    "packages/adapter-lol/src/riot-provider.ts",
    """  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const gameStartTimes = new Map<string, number>();
""",
    """  const locale = options.locale ?? 'en-US';
  const now = options.now ?? (() => new Date());
  const includeDetails = options.includeDetails ?? true;
  const gameStartTimes = new Map<string, number>();
  const eventDetailsCache = new Map<string, Promise<Json>>();
""",
)

replace_once(
    "packages/adapter-lol/src/riot-provider.ts",
    """  const eventDetails = async (matchId: string | null): Promise<Json> => {
    if (!matchId) return {};
    const payload = object(await persisted('getEventDetails', { id: matchId }));
    const data = object(payload.data);
    return object(data.event ?? payload.event ?? data);
  };
""",
    """  const eventDetails = (matchId: string | null): Promise<Json> => {
    if (!matchId) return Promise.resolve({});
    const cached = eventDetailsCache.get(matchId);
    if (cached) return cached;
    const request = persisted('getEventDetails', { id: matchId })
      .then(payloadValue => {
        const payload = object(payloadValue);
        const data = object(payload.data);
        return object(data.event ?? payload.event ?? data);
      })
      .catch(error => {
        eventDetailsCache.delete(matchId);
        throw error;
      });
    eventDetailsCache.set(matchId, request);
    return request;
  };
""",
)

replace_once(
    "packages/adapter-lol/src/riot-provider.ts",
    """      const detail = candidate.gameplay ? await details(gameId, candidate.timestamp) : null;
      const effectiveCandidate = detail ? alignWindowCandidate(candidate, detail) : candidate;
      const metadata = object(effectiveCandidate.payload.gameMetadata ?? effectiveCandidate.frame.gameMetadata);
      const matchId = firstString(candidate.payload, ['esportsMatchId']) ?? firstString(metadata, ['esportsMatchId']);
      const event = await eventDetails(matchId).catch(() => ({}));
""",
    """      const candidateMetadata = object(candidate.payload.gameMetadata ?? candidate.frame.gameMetadata);
      const matchId = firstString(candidate.payload, ['esportsMatchId'])
        ?? firstString(candidateMetadata, ['esportsMatchId']);
      const detailRequest: Promise<TimedFrame | null> = includeDetails && candidate.gameplay
        ? details(gameId, candidate.timestamp)
        : Promise.resolve(null);
      const eventRequest = eventDetails(matchId).catch(() => ({}));
      const [detail, event] = await Promise.all([detailRequest, eventRequest]);
      const effectiveCandidate = detail ? alignWindowCandidate(candidate, detail) : candidate;
      const metadata = object(effectiveCandidate.payload.gameMetadata ?? effectiveCandidate.frame.gameMetadata);
""",
)

replace_once(
    "packages/adapter-lol/src/riot-consistent-provider.ts",
    """  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const latestSnapshots = new Map<string, LolProviderSnapshot>();
""",
    """  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const useDetailItemFallback = options.useDetailItemFallback ?? true;
  const latestSnapshots = new Map<string, LolProviderSnapshot>();
""",
)

replace_once(
    "packages/adapter-lol/src/riot-consistent-provider.ts",
    ".then(snapshot => loadItems(gameId, snapshot))",
    ".then(snapshot => useDetailItemFallback ? loadItems(gameId, snapshot) : snapshot)",
)

replace_once(
    "packages/adapter-lol/src/riot-current-player-provider.ts",
    """export interface RiotCurrentPlayerProviderOptions {
  fetcher?: FetchLike;
}
""",
    """export interface RiotCurrentPlayerProviderOptions {
  fetcher?: FetchLike;
  now?: () => Date;
  useWindowOverlay?: boolean;
}
""",
)

replace_once(
    "packages/adapter-lol/src/riot-current-player-provider.ts",
    """function mergeInventories(
  stats: LolStats,
  observations: ReadonlyMap<string, InventoryObservation>,
  ceilingMs: number
): LolStats {
  return {
    ...stats,
    blue: mergeInventoryTeam(stats.blue, observations, ceilingMs),
    red: mergeInventoryTeam(stats.red, observations, ceilingMs)
  };
}
""",
    """function mergeInventories(
  stats: LolStats,
  observations: ReadonlyMap<string, InventoryObservation>,
  ceilingMs: number
): LolStats {
  return {
    ...stats,
    blue: mergeInventoryTeam(stats.blue, observations, ceilingMs),
    red: mergeInventoryTeam(stats.red, observations, ceilingMs)
  };
}

function unresolvedItemFields(stats: LolStats): ReadonlySet<string> {
  const unresolved = new Set<string>();
  for (const team of [stats.blue, stats.red]) {
    team.players.forEach((player, index) => {
      if (player.items === null) unresolved.add(`${team.side}.players.${index}.items`);
    });
  }
  return unresolved;
}

function withResolvedItemReasons(snapshot: LolProviderSnapshot, stats: LolStats): LolProviderSnapshot {
  const unresolved = unresolvedItemFields(stats);
  const reasons = (snapshot.reasons ?? []).filter(reason => (
    !reason.field?.endsWith('.items') || unresolved.has(reason.field)
  ));
  const { reasons: _oldReasons, ...base } = snapshot;
  return {
    ...base,
    stats,
    complete: reasons.length === 0,
    ...(reasons.length ? { reasons } : {})
  };
}
""",
)

replace_once(
    "packages/adapter-lol/src/riot-current-player-provider.ts",
    """  const fetcher = options.fetcher ?? fetch;
  const detailProbeStates = new Map<string, DetailProbeState>();
""",
    """  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const useWindowOverlay = options.useWindowOverlay ?? true;
  const detailProbeStates = new Map<string, DetailProbeState>();
""",
)

replace_once(
    "packages/adapter-lol/src/riot-current-player-provider.ts",
    """    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const latestWindowRequest = requestLive(fetcher, 'window', gameId);
      const latestInventoryRequest = latestWindowRequest.then(payload => {
        const latest = newestFrame(payload);
        return latest ? loadInventories(gameId, latest.timestampMs) : null;
      });
      const snapshot = await base.getSnapshot(gameId, after);
      if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;

      const sourceMs = parseTime(snapshot.sourceTimestamp);
      if (sourceMs === null) return snapshot;

      const latestWindow = await latestWindowRequest;
      const latest = newestFrame(latestWindow);
      let frame = alignedFrame(latestWindow, sourceMs);
      if (!frame) {
        const targeted = await requestLive(fetcher, 'window', gameId, roundedIso(sourceMs - 30_000));
        frame = alignedFrame(targeted, sourceMs);
      }

      let stats = frame ? mergeStats(snapshot.stats, frame) : snapshot.stats;
      const observations = await latestInventoryRequest;
      if (observations && latest) {
        stats = mergeInventories(stats, observations, latest.timestampMs + DETAIL_CEILING_MS);
      }

      return {
        ...snapshot,
        stats
      };
    }
""",
    """    async getSnapshot(gameId: string, after?: string): Promise<LolProviderSnapshot> {
      const latestWindowRequest = useWindowOverlay
        ? requestLive(fetcher, 'window', gameId)
        : null;
      const latestInventoryRequest = latestWindowRequest
        ? latestWindowRequest.then(payload => {
            const latest = newestFrame(payload);
            return latest ? loadInventories(gameId, latest.timestampMs) : null;
          })
        : loadInventories(gameId, now().getTime());
      const snapshot = await base.getSnapshot(gameId, after);
      if (!snapshot.stats || !snapshot.sourceTimestamp) return snapshot;

      const sourceMs = parseTime(snapshot.sourceTimestamp);
      if (sourceMs === null) return snapshot;

      let stats = snapshot.stats;
      let latest: TimedFrame | null = null;
      if (latestWindowRequest) {
        const latestWindow = await latestWindowRequest;
        latest = newestFrame(latestWindow);
        let frame = alignedFrame(latestWindow, sourceMs);
        if (!frame) {
          const targeted = await requestLive(fetcher, 'window', gameId, roundedIso(sourceMs - 30_000));
          frame = alignedFrame(targeted, sourceMs);
        }
        if (frame) stats = mergeStats(stats, frame);
      }

      const observations = await latestInventoryRequest;
      if (observations) {
        const ceilingMs = (latest?.timestampMs ?? sourceMs) + DETAIL_CEILING_MS;
        stats = mergeInventories(stats, observations, ceilingMs);
      }

      return withResolvedItemReasons(snapshot, stats);
    }
""",
)

test_file = Path("packages/adapter-lol/src/riot-current-player-provider.test.ts")
tests = test_file.read_text()
tests += """

test('uses the wall-clock details frontier without issuing a duplicate window request', async () => {
  const observedNow = new Date(Date.parse(SOURCE) + 60_000);
  const requestedDetails: string[] = [];
  let windowRequests = 0;
  const provider = createRiotCurrentPlayerProvider(baseProvider(snapshot()), {
    now: () => observedNow,
    useWindowOverlay: false,
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.includes('/window/')) {
        windowRequests += 1;
        return new Response(JSON.stringify(windowPayload(SOURCE)), { status: 200 });
      }
      requestedDetails.push(url.searchParams.get('startingTime') ?? '');
      return new Response(JSON.stringify(detailPayload(SOURCE, 3078, 3157)), { status: 200 });
    }
  });

  const result = await provider.getSnapshot('game-1');

  assert.equal(windowRequests, 0);
  assert.deepEqual(requestedDetails, [SOURCE]);
  assert.deepEqual(result.stats?.blue.players[0]?.items, ['3078']);
  assert.deepEqual(result.stats?.red.players[0]?.items, ['3157']);
});
"""
test_file.write_text(tests)

browser_test = textwrap.dedent(
    """
    import { expect, test, type Page, type Route } from '@playwright/test';

    const provider = { id: 'fixture', name: 'Fixture provider' };
    const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
    const red = { id: 'red', name: 'Red Team', code: 'RED' };
    const game = { id: 'game-fast-cadence', number: 1, state: 'live' as const };
    const series = {
      id: 'series-fast-cadence',
      esport: 'lol',
      competition: { id: 'test-league', name: 'Test League', stage: 'Week 1' },
      teams: [blue, red] as const,
      bestOf: 3,
      state: 'live' as const,
      scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
      games: [game]
    };

    async function fulfillJson(route: Route, value: unknown): Promise<void> {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(value)
      });
    }

    async function installFixtures(page: Page): Promise<() => number> {
      let liveRequests = 0;

      await page.route('https://www.riotgames.com/darkroom/original/**', route => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
      }));
      await page.route('**/health', route => fulfillJson(route, {
        ok: true,
        service: 'esports-live-api',
        schemaVersion: '1.0',
        adapters: ['lol']
      }));
      await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
        esport: 'lol',
        events: [{ series, provider, observedAt: new Date().toISOString() }]
      }));
      await page.route('**/v1/lol/series/**/context**', route => fulfillJson(route, {
        schemaVersion: '1.0',
        esport: 'lol',
        seriesId: series.id,
        provider,
        observedAt: new Date().toISOString(),
        rosters: [],
        standings: [],
        history: {
          bestOf: 3,
          winsRequired: 2,
          drawPossible: false,
          score: [{ team: blue, wins: 0 }, { team: red, wins: 0 }],
          games: [{ ...game, blueTeam: blue, redTeam: red, winner: null, durationSeconds: null }]
        },
        complete: true,
        reasons: []
      }));
      await page.route('**/v1/lol/games/**/live**', route => {
        liveRequests += 1;
        const timestamp = new Date(Date.now() + liveRequests * 1_000).toISOString();
        return fulfillJson(route, {
          schemaVersion: '1.0',
          esport: 'lol',
          provider,
          series,
          game,
          stats: {
            gameClockSeconds: 1_200 + liveRequests,
            patch: '26.15.1',
            blue: {
              id: blue.id,
              name: blue.name,
              side: 'blue',
              gold: 30_000 + liveRequests,
              kills: 7,
              objectives: { towers: 4, inhibitors: 0, dragons: [], barons: 0, heralds: 1, grubs: 3 },
              players: []
            },
            red: {
              id: red.id,
              name: red.name,
              side: 'red',
              gold: 29_000,
              kills: 5,
              objectives: { towers: 2, inhibitors: 0, dragons: [], barons: 0, heralds: 1, grubs: 3 },
              players: []
            }
          },
          quality: {
            freshness: 'fresh',
            sourceTimestamp: timestamp,
            observedAt: timestamp,
            ageSeconds: 0,
            complete: true,
            advancing: true,
            safeForLiveAnalysis: true,
            reasons: []
          }
        });
      });

      return () => liveRequests;
    }

    test('polls the selected live game at sub-second cadence', async ({ page }) => {
      const liveRequests = await installFixtures(page);
      await page.goto('/');
      await page.locator('[data-series-id="series-fast-cadence"]').click();
      await expect.poll(liveRequests, { timeout: 3_500, intervals: [100] }).toBeGreaterThanOrEqual(3);
    });
    """
).lstrip()
Path("tests/web/live-fast-cadence.spec.ts").write_text(browser_test)

Path(".github/workflows/ci.yml").write_text(ORIGINAL_CI)
Path(__file__).unlink()
