import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) {
    console.log(`${path}: already patched`);
    return false;
  }
  await writeFile(path, after);
  console.log(`${path}: patched`);
  return true;
}

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(from, to);
}

let changed = false;

changed = await patch('packages/adapter-lol/src/riot-provider.ts', source => {
  let next = replaceOnce(
    source,
    "const REQUEST_TIMEOUT_MS = 8_000;\n",
    "const REQUEST_TIMEOUT_MS = 8_000;\nconst EVENT_DETAILS_WAIT_BUDGET_MS = 500;\n",
    'event details default budget'
  );
  next = replaceOnce(
    next,
    "  useDetailItemFallback?: boolean;\n",
    "  useDetailItemFallback?: boolean;\n  eventDetailsWaitBudgetMs?: number;\n",
    'event details option'
  );
  next = replaceOnce(
    next,
    "  const includeDetails = options.includeDetails ?? true;\n  const gameStartTimes = new Map<string, number>();\n  const eventDetailsCache = new Map<string, Promise<Json>>();\n",
    "  const includeDetails = options.includeDetails ?? true;\n  const eventDetailsWaitBudgetMs = options.eventDetailsWaitBudgetMs ?? EVENT_DETAILS_WAIT_BUDGET_MS;\n  const gameStartTimes = new Map<string, number>();\n  const eventDetailsCache = new Map<string, Json>();\n  const eventDetailsInFlight = new Map<string, Promise<Json>>();\n",
    'event details state'
  );
  next = replaceOnce(
    next,
    "    const first = windowCandidate(openingPayload);\n    const afterMs = parseTime(after);\n    if (first?.gameplay && observedMs - first.timestampMs <= 30_000 && (afterMs === null || first.timestampMs > afterMs)) {\n      return first;\n    }\n",
    "    const first = windowCandidate(openingPayload);\n    if (first?.gameplay && observedMs - first.timestampMs <= 30_000) {\n      return first;\n    }\n",
    'opening live frame fast path'
  );
  next = replaceOnce(
    next,
    "  const eventDetails = (matchId: string | null): Promise<Json> => {\n    if (!matchId) return Promise.resolve({});\n    const cached = eventDetailsCache.get(matchId);\n    if (cached) return cached;\n    const request = persisted('getEventDetails', { id: matchId })\n      .then(payloadValue => {\n        const payload = object(payloadValue);\n        const data = object(payload.data);\n        return object(data.event ?? payload.event ?? data);\n      })\n      .catch(error => {\n        eventDetailsCache.delete(matchId);\n        throw error;\n      });\n    eventDetailsCache.set(matchId, request);\n    return request;\n  };\n",
    "  const loadEventDetails = (matchId: string): Promise<Json> => {\n    const pending = eventDetailsInFlight.get(matchId);\n    if (pending) return pending;\n    const request = persisted('getEventDetails', { id: matchId })\n      .then(payloadValue => {\n        const payload = object(payloadValue);\n        const data = object(payload.data);\n        const event = object(data.event ?? payload.event ?? data);\n        eventDetailsCache.set(matchId, event);\n        return event;\n      })\n      .finally(() => {\n        if (eventDetailsInFlight.get(matchId) === request) eventDetailsInFlight.delete(matchId);\n      });\n    eventDetailsInFlight.set(matchId, request);\n    return request;\n  };\n\n  const eventDetails = async (matchId: string | null): Promise<Json> => {\n    if (!matchId) return {};\n    const cached = eventDetailsCache.get(matchId);\n    if (cached) return cached;\n    const request = loadEventDetails(matchId).catch(() => ({}));\n    let timer: ReturnType<typeof setTimeout> | null = null;\n    try {\n      return await Promise.race([\n        request,\n        new Promise<Json>(resolve => {\n          timer = setTimeout(() => resolve({}), eventDetailsWaitBudgetMs);\n        })\n      ]);\n    } finally {\n      if (timer !== null) clearTimeout(timer);\n    }\n  };\n",
    'nonblocking event details'
  );
  return next;
}) || changed;

changed = await patch('packages/adapter-lol/src/riot-current-player-provider.ts', source => {
  let next = replaceOnce(
    source,
    "const REQUEST_TIMEOUT_MS = 3_000;\n",
    "const REQUEST_TIMEOUT_MS = 3_000;\nconst INVENTORY_WAIT_BUDGET_MS = 500;\n",
    'inventory default budget'
  );
  next = replaceOnce(
    next,
    "  useWindowOverlay?: boolean;\n",
    "  useWindowOverlay?: boolean;\n  inventoryWaitBudgetMs?: number;\n",
    'inventory option'
  );
  next = replaceOnce(
    next,
    "function roundedIso(value: number): string {\n  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();\n}\n",
    "function roundedIso(value: number): string {\n  return new Date(Math.floor(value / 10_000) * 10_000).toISOString();\n}\n\nasync function withinBudget<T>(request: Promise<T>, budgetMs: number): Promise<T | null> {\n  let timer: ReturnType<typeof setTimeout> | null = null;\n  try {\n    return await Promise.race([\n      request,\n      new Promise<null>(resolve => {\n        timer = setTimeout(() => resolve(null), budgetMs);\n      })\n    ]);\n  } finally {\n    if (timer !== null) clearTimeout(timer);\n  }\n}\n",
    'budget helper'
  );
  next = replaceOnce(
    next,
    "  const useWindowOverlay = options.useWindowOverlay ?? true;\n",
    "  const useWindowOverlay = options.useWindowOverlay ?? true;\n  const inventoryWaitBudgetMs = options.inventoryWaitBudgetMs ?? INVENTORY_WAIT_BUDGET_MS;\n",
    'inventory configured budget'
  );
  next = replaceOnce(
    next,
    "      const observations = await latestInventoryRequest;\n      if (observations) {\n        const ceilingMs = (latest?.timestampMs ?? sourceMs) + DETAIL_CEILING_MS;\n        stats = mergeInventories(stats, observations, ceilingMs);\n      }\n",
    "      const observations = await withinBudget(latestInventoryRequest.catch(() => null), inventoryWaitBudgetMs);\n      const availableObservations = observations ?? inventoryStates.get(gameId) ?? null;\n      if (availableObservations) {\n        const ceilingMs = (latest?.timestampMs ?? sourceMs) + DETAIL_CEILING_MS;\n        stats = mergeInventories(stats, availableObservations, ceilingMs);\n      }\n",
    'nonblocking inventories'
  );
  return next;
}) || changed;

changed = await patch('packages/adapter-lol/src/riot-provider.test.ts', source => {
  const marker = "test('reuses the direct opening frame when the cursor has not advanced'";
  if (source.includes(marker)) return source;
  return `${source.trimEnd()}\n\n${marker}, async () => {\n  let windowRequests = 0;\n  const provider = createRiotLolProvider({\n    apiKey: 'test-key',\n    includeDetails: false,\n    fetcher: async (input: RequestInfo | URL): Promise<Response> => {\n      const url = new URL(String(input));\n      if (url.pathname.endsWith('/getEventDetails')) return json(eventPayload());\n      if (url.pathname.includes('/window/game-1')) {\n        windowRequests += 1;\n        return json(windowPayload());\n      }\n      return json({ error: 'unexpected_url', url: url.toString() }, 500);\n    },\n    now: () => new Date(NOW)\n  });\n\n  await provider.getSnapshot('game-1');\n  const repeated = await provider.getSnapshot('game-1', SOURCE);\n\n  assert.equal(windowRequests, 2);\n  assert.equal(repeated.sourceTimestamp, SOURCE);\n  assert.ok(repeated.stats);\n});\n\ntest('returns live telemetry before slow event metadata enrichment finishes', async () => {\n  const provider = createRiotLolProvider({\n    apiKey: 'test-key',\n    includeDetails: false,\n    eventDetailsWaitBudgetMs: 5,\n    fetcher: async (input: RequestInfo | URL): Promise<Response> => {\n      const url = new URL(String(input));\n      if (url.pathname.endsWith('/getEventDetails')) {\n        await new Promise(resolve => setTimeout(resolve, 50));\n        return json(eventPayload());\n      }\n      if (url.pathname.includes('/window/game-1')) return json(windowPayload());\n      return json({ error: 'unexpected_url', url: url.toString() }, 500);\n    },\n    now: () => new Date(NOW)\n  });\n\n  const started = Date.now();\n  const result = await provider.getSnapshot('game-1');\n\n  assert.ok(Date.now() - started < 40);\n  assert.equal(result.sourceTimestamp, SOURCE);\n  assert.ok(result.stats);\n});\n`;
}) || changed;

changed = await patch('packages/adapter-lol/src/riot-current-player-provider.test.ts', source => {
  const marker = "test('returns live counters before slow inventory enrichment finishes'";
  if (source.includes(marker)) return source;
  return `${source.trimEnd()}\n\n${marker}, async () => {\n  const delayedSnapshot = structuredClone(snapshot());\n  delayedSnapshot.stats!.blue.players[0]!.items = null;\n  delayedSnapshot.stats!.red.players[0]!.items = null;\n  const provider = createRiotCurrentPlayerProvider(baseProvider(delayedSnapshot), {\n    now: () => new Date(Date.parse(SOURCE) + 60_000),\n    useWindowOverlay: false,\n    inventoryWaitBudgetMs: 5,\n    fetcher: async (): Promise<Response> => {\n      await new Promise(resolve => setTimeout(resolve, 50));\n      return new Response(JSON.stringify(detailPayload(SOURCE, 3078, 3157)), { status: 200 });\n    }\n  });\n\n  const started = Date.now();\n  const first = await provider.getSnapshot('game-1');\n\n  assert.ok(Date.now() - started < 40);\n  assert.ok(first.stats);\n  assert.equal(first.stats?.blue.players[0]?.items, null);\n\n  await new Promise(resolve => setTimeout(resolve, 60));\n  const second = await provider.getSnapshot('game-1', SOURCE);\n  assert.deepEqual(second.stats?.blue.players[0]?.items, ['3078']);\n  assert.deepEqual(second.stats?.red.players[0]?.items, ['3157']);\n});\n`;
}) || changed;

if (!changed) console.log('No source changes were necessary.');
