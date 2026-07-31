from pathlib import Path

PROVIDER = Path('packages/adapter-lol/src/riot-provider.ts')
TESTS = Path('packages/adapter-lol/src/riot-provider.test.ts')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker not found')
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f'{label}: end marker not found')
    return text[:start] + replacement + text[end:]


provider = PROVIDER.read_text()

if 'function alignWindowCandidate(' not in provider:
    provider = replace_once(
        provider,
        "const PARTICIPANT_IDS = '1_2_3_4_5_6_7_8_9_10';\n",
        '',
        'remove participant filter constant'
    )

    provider = replace_once(
        provider,
        """interface Candidate {
  payload: Json;
  frame: Json;
  timestamp: string;
  timestampMs: number;
  gameplay: boolean;
}
""",
        """interface Candidate {
  payload: Json;
  frame: Json;
  timestamp: string;
  timestampMs: number;
  gameplay: boolean;
}

interface TimedFrame {
  frame: Json;
  timestamp: string;
  timestampMs: number;
}
""",
        'add timed frame type'
    )

    provider = replace_once(
        provider,
        """function frameTime(frame: Json): string | null {
  const value = firstString(frame, ['rfc460Timestamp', 'timestamp']);
  return value && parseTime(value) !== null ? value : null;
}
""",
        """function frameTime(frame: Json): string | null {
  const value = firstString(frame, ['rfc460Timestamp', 'timestamp']);
  return value && parseTime(value) !== null ? value : null;
}

function newestTimedFrame(value: unknown, ceilingMs = Number.POSITIVE_INFINITY): TimedFrame | null {
  let selected: TimedFrame | null = null;
  for (const frame of frames(value)) {
    const timestamp = frameTime(frame);
    const timestampMs = timestamp ? parseTime(timestamp) : null;
    if (!timestamp || timestampMs === null || timestampMs > ceilingMs) continue;
    if (!selected || timestampMs > selected.timestampMs) {
      selected = { frame, timestamp, timestampMs };
    }
  }
  return selected;
}
""",
        'add newest timed frame selector'
    )

    provider = replace_once(
        provider,
        """function hasGameplay(frame: Json): boolean {
  const blue = frameTeam(frame, 'blue');
  const red = frameTeam(frame, 'red');
  const players = [...array(blue.participants), ...array(red.participants)].map(object);
  const gold = (firstNumber(blue, ['totalGold', 'gold']) ?? 0)
    + (firstNumber(red, ['totalGold', 'gold']) ?? 0);
  const cs = players.reduce((sum, player) => sum + (firstNumber(player, ['creepScore', 'cs']) ?? 0), 0);
  const level = players.reduce((highest, player) => Math.max(highest, firstNumber(player, ['level']) ?? 0), 0);
  const kills = (firstNumber(blue, ['totalKills', 'kills']) ?? 0)
    + (firstNumber(red, ['totalKills', 'kills']) ?? 0);
  return gold > 5_000 || cs > 0 || level > 1 || kills > 0;
}
""",
        """function hasGameplay(frame: Json): boolean {
  const blue = frameTeam(frame, 'blue');
  const red = frameTeam(frame, 'red');
  const players = [...array(blue.participants), ...array(red.participants)].map(object);
  const gold = (firstNumber(blue, ['totalGold', 'gold']) ?? 0)
    + (firstNumber(red, ['totalGold', 'gold']) ?? 0);
  const cs = players.reduce((sum, player) => sum + (firstNumber(player, ['creepScore', 'cs']) ?? 0), 0);
  const level = players.reduce((highest, player) => Math.max(highest, firstNumber(player, ['level']) ?? 0), 0);
  const kills = (firstNumber(blue, ['totalKills', 'kills']) ?? 0)
    + (firstNumber(red, ['totalKills', 'kills']) ?? 0);
  return gold > 5_000 || cs > 0 || level > 1 || kills > 0;
}

function alignWindowCandidate(candidate: Candidate, detail: TimedFrame): Candidate {
  const aligned = newestTimedFrame(candidate.payload, detail.timestampMs + 1_000);
  if (!aligned || Math.abs(aligned.timestampMs - detail.timestampMs) > 15_000) return candidate;
  return {
    ...candidate,
    frame: aligned.frame,
    timestamp: aligned.timestamp,
    timestampMs: aligned.timestampMs,
    gameplay: hasGameplay(aligned.frame)
  };
}
""",
        'add frame alignment helper'
    )

    provider = replace_once(
        provider,
        """function participantMap(value: unknown, metadata = false): Map<string, Json> {
  const source = metadata ? array(object(value).participantMetadata) : array(frames(value)[0]?.participants);
  return new Map(source.map((entry, index) => {
""",
        """function participantMap(value: unknown, metadata = false): Map<string, Json> {
  const payload = object(value);
  const directParticipants = array(payload.participants);
  const source = metadata
    ? array(payload.participantMetadata)
    : directParticipants.length ? directParticipants : array(newestTimedFrame(value)?.frame.participants);
  return new Map(source.map((entry, index) => {
""",
        'select newest detail frame'
    )

    details_replacement = """  const details = async (gameId: string, timestamp: string): Promise<TimedFrame | null> => {
    const sourceMs = parseTime(timestamp);
    if (sourceMs === null) return null;
    const anchors = [...new Set([
      roundedIso(sourceMs - 60_000),
      roundedIso(sourceMs - 30_000),
      roundedIso(sourceMs - 90_000),
      roundedIso(sourceMs),
      roundedIso(sourceMs - 10_000),
      roundedIso(sourceMs - 120_000)
    ])];

    const primary = await live(`details/${encodeURIComponent(gameId)}`, {
      startingTime: anchors[0]
    }).catch(() => null);
    const primaryFrame = newestTimedFrame(primary, sourceMs + 10_000);
    if (primaryFrame) return primaryFrame;

    const results = await Promise.all(anchors.slice(1).map(startingTime => (
      live(`details/${encodeURIComponent(gameId)}`, { startingTime }).catch(() => null)
    )));
    return results
      .map(result => newestTimedFrame(result, sourceMs + 10_000))
      .filter((entry): entry is TimedFrame => entry !== null)
      .sort((left, right) => right.timestampMs - left.timestampMs)[0] ?? null;
  };

"""
    provider = replace_between(
        provider,
        '  const details = async (gameId: string, timestamp: string)',
        '  const eventDetails = async',
        details_replacement,
        'replace details loader'
    )

    provider = replace_once(
        provider,
        """      const metadata = object(candidate.payload.gameMetadata ?? candidate.frame.gameMetadata);
""",
        """      const detail = candidate.gameplay ? await details(gameId, candidate.timestamp) : null;
      const effectiveCandidate = detail ? alignWindowCandidate(candidate, detail) : candidate;
      const metadata = object(effectiveCandidate.payload.gameMetadata ?? effectiveCandidate.frame.gameMetadata);
""",
        'load aligned detail frame'
    )

    provider = provider.replace(
        'candidate.gameplay && existing.state',
        'effectiveCandidate.gameplay && existing.state'
    )
    provider = provider.replace(
        'candidate.gameplay && baseSeries.state',
        'effectiveCandidate.gameplay && baseSeries.state'
    )
    provider = provider.replace(
        'candidate.timestampMs > afterMs',
        'effectiveCandidate.timestampMs > afterMs'
    )
    provider = provider.replace(
        'if (!candidate.gameplay) {',
        'if (!effectiveCandidate.gameplay) {'
    )
    provider = provider.replace(
        'sourceTimestamp: candidate.timestamp,',
        'sourceTimestamp: effectiveCandidate.timestamp,'
    )

    provider = replace_once(
        provider,
        """      const detailPayload = await details(gameId, candidate.timestamp);
      const detailMap = participantMap(detailPayload);
""",
        """      const detailMap = participantMap(detail?.frame);
""",
        'use selected details frame'
    )

    provider = provider.replace(
        'gameClock(candidate.frame, event, gameId, metadata, candidate.timestampMs)',
        'gameClock(effectiveCandidate.frame, event, gameId, metadata, effectiveCandidate.timestampMs)'
    )
    provider = provider.replace(
        "teamState('blue', candidate.frame",
        "teamState('blue', effectiveCandidate.frame"
    )
    provider = provider.replace(
        "teamState('red', candidate.frame",
        "teamState('red', effectiveCandidate.frame"
    )

    if 'PARTICIPANT_IDS' in provider:
        raise SystemExit('participant filter reference remained after details replacement')
    if 'const detailPayload = await details' in provider:
        raise SystemExit('old detail payload block remained after replacement')
    if provider.count('effectiveCandidate') < 8:
        raise SystemExit('effective candidate replacements were incomplete')

    PROVIDER.write_text(provider)


tests = TESTS.read_text()
if 'aligns team and participant frames before normalization' not in tests:
    tests = replace_once(
        tests,
        """function detailsPayload() {
  return {
    frames: [{
      rfc460Timestamp: SOURCE,
      participants: Array.from({ length: 10 }, (_, index) => ({
        ...participant(index + 1),
        items: [{ itemID: 1001 }, { itemID: 2003 }]
      }))
    }]
  };
}
""",
        """function detailsPayload() {
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
""",
        'expand details fixture'
    )

    tests = replace_once(
        tests,
        "assert.deepEqual(snapshot.stats?.blue.players[0]?.items, ['1001', '2003']);",
        "assert.deepEqual(snapshot.stats?.blue.players[0]?.items, ['3006', '3363']);\n  assert.equal(snapshot.stats?.blue.players[0]?.kills, 4);",
        'assert newest detail frame'
    )

    tests += """

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
"""
    TESTS.write_text(tests)
