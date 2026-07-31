from pathlib import Path

PROVIDER = Path('packages/adapter-lol/src/riot-resolved-provider.ts')
TESTS = Path('packages/adapter-lol/src/riot-resolved-provider.test.ts')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


provider = PROVIDER.read_text()
provider = replace_once(
    provider,
    """function eventTeamDescriptors(event: Json): readonly TeamDescriptor[] {
  return array(object(event.match).teams).map((value, index) => {
    const team = object(value);
    return {
      id: firstString(team, ['id', 'teamId']) ?? `unknown-team-${index + 1}`,
      name: firstString(team, ['name', 'code', 'slug']) ?? `Team ${index + 1}`,
      code: firstString(team, ['code', 'acronym']),
      slug: firstString(team, ['slug']),
      imageUrl: firstString(team, ['image', 'imageUrl', 'alternativeImage', 'logo'])
    };
  });
}
""",
    """function eventTeamDescriptors(event: Json): readonly TeamDescriptor[] {
  return array(object(event.match).teams).map((value, index) => {
    const team = object(value);
    return {
      id: firstString(team, ['id', 'teamId']) ?? `unknown-team-${index + 1}`,
      name: firstString(team, ['name', 'code', 'slug']) ?? `Team ${index + 1}`,
      code: firstString(team, ['code', 'acronym']),
      slug: firstString(team, ['slug']),
      imageUrl: firstString(team, ['image', 'imageUrl', 'alternativeImage', 'logo'])
    };
  });
}

function eventGameIds(event: Json): readonly string[] {
  return array(object(event.match).games)
    .map(value => firstString(object(value), ['id', 'gameId']))
    .filter((value): value is string => value !== null);
}
""",
    'event game IDs helper'
)
provider = replace_once(
    provider,
    """    pool: readonly PlayerRef[],
    selectedSeries: LolProviderSeries
  ): Promise<VerifiedLineupResult> => {
""",
    """    pool: readonly PlayerRef[],
    selectedSeries: LolProviderSeries,
    selectedGameIds: readonly string[]
  ): Promise<VerifiedLineupResult> => {
""",
    'lineup loader signature'
)
provider = replace_once(
    provider,
    """      const selectedStart = Date.parse(selectedSeries.scheduledStart);
      const selectedGames = selectedSeries.games
        .map(game => ({ game, series: selectedSeries }))
        .sort((left, right) => (
          Number(right.game.state === 'completed') - Number(left.game.state === 'completed')
          || right.game.number - left.game.number
        ));
""",
    """      const selectedStart = Date.parse(selectedSeries.scheduledStart);
      const selectedIds = [...new Set([
        ...selectedGameIds,
        ...selectedSeries.games.map(game => game.id)
      ])];
      const selectedGames = selectedIds
        .map((id, index) => ({
          game: selectedSeries.games.find(game => game.id === id) ?? {
            id,
            number: index + 1,
            state: 'unknown' as const
          },
          series: selectedSeries
        }))
        .sort((left, right) => (
          Number(right.game.state === 'completed') - Number(left.game.state === 'completed')
          || right.game.number - left.game.number
        ));
""",
    'selected detail game candidates'
)
provider = replace_once(
    provider,
    """      const detailsLeague = object(detailsEvent.league);
      const scheduleLeague = object(rawEvent.league);
""",
    """      const lineupGameIds = [...new Set([
        ...eventGameIds(detailsEvent),
        ...eventGameIds(rawEvent),
        ...normalized.games.map(game => game.id)
      ])];
      const detailsLeague = object(detailsEvent.league);
      const scheduleLeague = object(rawEvent.league);
""",
    'context lineup game IDs'
)
provider = replace_once(
    provider,
    "const verified = await loadVerifiedLineup(descriptor, normalizedTeam, pool, normalized);",
    "const verified = await loadVerifiedLineup(\n              descriptor,\n              normalizedTeam,\n              pool,\n              normalized,\n              lineupGameIds\n            );",
    'lineup loader call'
)
PROVIDER.write_text(provider)


tests = TESTS.read_text()
tests = replace_once(
    tests,
    """      games: [{ id: 'future-game', number: 1, state: 'unstarted' }]
    }
  };
  const previousEvent = {
    ...currentEvent,
    state: 'completed',
    startTime: '2026-07-30T08:00:00.000Z',
    match: {
      ...currentEvent.match,
      id: 'academy-previous',
      games: [{ id: 'verified-game', number: 1, state: 'completed' }]
    }
  };
""",
    """      games: []
    }
  };
  const detailsEvent = {
    ...currentEvent,
    state: 'completed',
    startTime: '2026-07-30T08:00:00.000Z',
    match: {
      ...currentEvent.match,
      games: [{ id: 'verified-game', number: 1, state: 'completed' }]
    }
  };
""",
    'mixed fixture detail games'
)
tests = replace_once(
    tests,
    "return json({ data: { schedule: { events: [currentEvent, previousEvent] } } });",
    "return json({ data: { schedule: { events: [currentEvent] } } });",
    'mixed fixture schedule'
)
tests = replace_once(
    tests,
    "return json({ data: { event: currentEvent } });",
    "return json({ data: { event: detailsEvent } });",
    'mixed fixture event details'
)
TESTS.write_text(tests)
