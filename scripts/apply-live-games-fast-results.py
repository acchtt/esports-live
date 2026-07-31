from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "packages/adapter-lol/src/riot-context-provider.ts",
    """    const signaledGames = new Map(eventGames(liveEvent).map(game => [game.id, game] as const));
    const games = entry.series.games.map(game => {
      const signal = signaledGames.get(game.id);
      return signal && signal.state !== 'unknown' ? { ...game, state: signal.state } : game;
    });
""",
    """    const gamesById = new Map(entry.series.games.map(game => [game.id, game] as const));
    for (const signal of eventGames(liveEvent)) {
      const existing = gamesById.get(signal.id);
      gamesById.set(signal.id, existing
        ? { ...existing, state: signal.state !== 'unknown' ? signal.state : existing.state }
        : signal);
    }
    const games = [...gamesById.values()].sort((left, right) => left.number - right.number);
"""
)

replace_once(
    "packages/adapter-lol/src/riot-context-provider.test.ts",
    """test('getLive failure leaves the base schedule available', async () => {
""",
    """test('getLive supplies game IDs when the base schedule omits them', async () => {
  const baseEvent = scheduleEvent();
  baseEvent.match.games = [];
  const liveEvent = scheduleEvent('inProgress');
  liveEvent.match.games = [
    { id: 'game-1', number: 1, state: 'completed' },
    { id: 'game-2', number: 2, state: 'inProgress' },
    { id: 'game-3', number: 3, state: 'unstarted' }
  ];
  const provider = createRiotLolContextProvider({
    apiKey: 'test-key',
    fetcher: async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/getSchedule')) {
        return json({ data: { schedule: { events: [baseEvent] } } });
      }
      if (url.pathname.endsWith('/getLive')) {
        return json({ data: { schedule: { events: [liveEvent] } } });
      }
      return json({ error: 'unexpected_url', url: url.toString() }, 500);
    },
    now: () => new Date(NOW)
  });

  const schedule = await provider.getSchedule();
  assert.equal(schedule[0]?.series.state, 'live');
  assert.deepEqual(schedule[0]?.series.games.map(game => [game.id, game.state]), [
    ['game-1', 'completed'],
    ['game-2', 'live'],
    ['game-3', 'unstarted']
  ]);
});

test('getLive failure leaves the base schedule available', async () => {
"""
)

replace_once(
    "apps/web/src/main.ts",
    """const SNAPSHOT_POLL_MS = 3_000;
const SCHEDULE_POLL_MS = 15_000;
""",
    """const SNAPSHOT_POLL_MS = 3_000;
const SCHEDULE_POLL_MS = 15_000;
const ACTIVE_SCHEDULE_GRACE_MS = 6 * 60 * 60 * 1_000;
"""
)

replace_once(
    "apps/web/src/main.ts",
    """function stateLabel(event: ScheduleEvent): string {
""",
    """function isActiveListing(event: ScheduleEvent): boolean {
  if (event.series.state === 'live' || event.series.state === 'paused') return true;
  if (event.series.state !== 'scheduled') return false;
  const start = Date.parse(event.series.scheduledStart);
  return !Number.isFinite(start) || start >= Date.now() - ACTIVE_SCHEDULE_GRACE_MS;
}

function stateLabel(event: ScheduleEvent): string {
"""
)

replace_once(
    "apps/web/src/main.ts",
    """    events = [...payload.events].sort((left, right) => {
""",
    """    events = payload.events.filter(isActiveListing).sort((left, right) => {
"""
)

replace_once(
    "apps/web/src/completed-matches-view.ts",
    """const RESULT_LIMIT = 12;
const CANDIDATE_LIMIT = 24;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_CONTEXT_CONCURRENCY = 3;
""",
    """const RESULT_LIMIT = 12;
const CANDIDATE_LIMIT = 16;
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_CONTEXT_CONCURRENCY = 4;
"""
)

replace_once(
    "apps/web/src/completed-matches-view.ts",
    """    .sort((left, right) => Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart))
    .slice(0, CANDIDATE_LIMIT);
""",
    """    .sort((left, right) => (
      Number(right.series.state === 'completed') - Number(left.series.state === 'completed')
      || Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart)
    ))
    .slice(0, CANDIDATE_LIMIT);
"""
)

replace_once(
    "apps/web/src/completed-matches-view.ts",
    """      const resolved = await mapWithConcurrency(candidates, MAX_CONTEXT_CONCURRENCY, async event => {
        try {
          const context = await contextFor(event.series.id);
          return context.history && isEnded(event, context.history)
            ? { event, context, history: context.history } satisfies CompletedMatch
            : null;
        } catch {
          return null;
        }
      });
      completedMatches = resolved
        .filter((match): match is CompletedMatch => match !== null)
        .slice(0, RESULT_LIMIT);
""",
    """      completedMatches = [];
      let initialSelectionMade = false;
      const resolved = await mapWithConcurrency(candidates, MAX_CONTEXT_CONCURRENCY, async event => {
        try {
          const context = await contextFor(event.series.id);
          const match = context.history && isEnded(event, context.history)
            ? { event, context, history: context.history } satisfies CompletedMatch
            : null;
          if (match) {
            completedMatches = [...completedMatches, match]
              .sort((left, right) => (
                Date.parse(right.event.series.scheduledStart) - Date.parse(left.event.series.scheduledStart)
              ))
              .slice(0, RESULT_LIMIT);
            renderList();
            if (!selectedSeriesId && !initialSelectionMade && completedMatches[0]) {
              initialSelectionMade = true;
              selectCompleted(completedMatches[0].event.series.id);
            }
          }
          return match;
        } catch {
          return null;
        }
      });
      completedMatches = resolved
        .filter((match): match is CompletedMatch => match !== null)
        .sort((left, right) => (
          Date.parse(right.event.series.scheduledStart) - Date.parse(left.event.series.scheduledStart)
        ))
        .slice(0, RESULT_LIMIT);
"""
)

replace_once(
    "apps/web/src/styles.css",
    """.schedule-list {
  display: grid;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  max-height: calc(100vh - 266px);
}

.match-card {
  width: 100%;
""",
    """.schedule-list {
  display: grid;
  grid-auto-rows: max-content;
  align-content: start;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  max-height: calc(100vh - 266px);
}
.schedule-list > * { min-width: 0; }

.match-card {
  display: block;
  position: relative;
  width: 100%;
  min-height: max-content;
  overflow: hidden;
"""
)

replace_once(
    "apps/web/src/styles.css",
    """.match-card-top { justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--muted); font-size: 0.68rem; }
.match-card > strong { display: block; font-size: 0.88rem; line-height: 1.4; }
""",
    """.match-card-top { justify-content: space-between; gap: 12px; margin-bottom: 10px; color: var(--muted); font-size: 0.68rem; }
.match-card-top > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.match-state { flex: 0 0 auto; }
.match-card > strong { display: block; overflow-wrap: anywhere; font-size: 0.88rem; line-height: 1.4; }
"""
)

print("Applied live-game, fast-results, stale-list, and card-layout fixes.")
