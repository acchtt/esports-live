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
    """  const byHandle = new Map<string, PlayerRef[]>();
  for (const player of pool) {
    const key = normalizedText(player.handle);
    byHandle.set(key, [...(byHandle.get(key) ?? []), player]);
  }

  const verified = array(selected.participantMetadata).flatMap(value => {
    const participant = object(value);
    const handle = firstString(participant, ['summonerName', 'name']);
    const role = canonicalRole(firstString(participant, ['role', 'roleSlug']));
    if (!handle || !role) return [];
    const matches = byHandle.get(normalizedText(handle)) ?? [];
    const catalogMatch = matches.find(player => canonicalRole(player.role ?? null) === role)
      ?? matches[0]
      ?? null;
    const syntheticHandle = normalizedText(handle).replaceAll(' ', '-');
    return [{
      ...(catalogMatch ?? {
        id: `verified:${normalizedTeam.id}:${syntheticHandle}`,
        handle,
        teamId: normalizedTeam.id
      }),
      handle,
      teamId: normalizedTeam.id,
      role
    } satisfies PlayerRef];
  });
""",
    """  const byId = new Map(pool.map(player => [player.id, player] as const));
  const byHandle = new Map<string, PlayerRef[]>();
  for (const player of pool) {
    const key = normalizedText(player.handle);
    byHandle.set(key, [...(byHandle.get(key) ?? []), player]);
  }

  const verified = array(selected.participantMetadata).flatMap(value => {
    const participant = object(value);
    const rawHandle = firstString(participant, ['summonerName', 'name']);
    const esportsPlayerId = firstString(participant, ['esportsPlayerId', 'playerId']);
    const role = canonicalRole(firstString(participant, ['role', 'roleSlug']));
    if (!rawHandle || !role) return [];
    const directMatch = esportsPlayerId ? byId.get(esportsPlayerId) : undefined;
    const handleMatches = byHandle.get(normalizedText(rawHandle)) ?? [];
    const catalogMatch = directMatch
      ?? handleMatches.find(player => canonicalRole(player.role ?? null) === role)
      ?? handleMatches[0]
      ?? null;
    const handle = catalogMatch?.handle ?? rawHandle;
    const syntheticHandle = normalizedText(handle).replaceAll(' ', '-');
    return [{
      ...(catalogMatch ?? {
        id: esportsPlayerId ?? `verified:${normalizedTeam.id}:${syntheticHandle}`,
        handle,
        teamId: normalizedTeam.id
      }),
      handle,
      teamId: normalizedTeam.id,
      role
    } satisfies PlayerRef];
  });
""",
    'player identity mapping'
)
provider = replace_once(
    provider,
    """      const selectedStart = Date.parse(selectedSeries.scheduledStart);
      const candidateGames = [...recentSeries.values()]
        .filter(series => (
          !Number.isFinite(selectedStart)
          || !Number.isFinite(Date.parse(series.scheduledStart))
          || Date.parse(series.scheduledStart) <= selectedStart + EVENT_TIME_TOLERANCE_MS
        ))
        .filter(series => series.teams.some(team => seriesTeamMatchesDescriptor(team, descriptor)))
        .flatMap(series => series.games.map(game => ({ game, series })))
        .sort((left, right) => (
          Number(right.game.state === 'completed') - Number(left.game.state === 'completed')
          || Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart)
          || right.game.number - left.game.number
        ));
""",
    """      const selectedStart = Date.parse(selectedSeries.scheduledStart);
      const selectedGames = selectedSeries.games
        .map(game => ({ game, series: selectedSeries }))
        .sort((left, right) => (
          Number(right.game.state === 'completed') - Number(left.game.state === 'completed')
          || right.game.number - left.game.number
        ));
      const historicalGames = [...recentSeries.values()]
        .filter(series => series.id !== selectedSeries.id)
        .filter(series => (
          !Number.isFinite(selectedStart)
          || !Number.isFinite(Date.parse(series.scheduledStart))
          || Date.parse(series.scheduledStart) <= selectedStart + EVENT_TIME_TOLERANCE_MS
        ))
        .filter(series => series.teams.some(team => seriesTeamMatchesDescriptor(team, descriptor)))
        .flatMap(series => series.games.map(game => ({ game, series })))
        .sort((left, right) => (
          Number(right.game.state === 'completed') - Number(left.game.state === 'completed')
          || Date.parse(right.series.scheduledStart) - Date.parse(left.series.scheduledStart)
          || right.game.number - left.game.number
        ));
      const candidateGames = [...selectedGames, ...historicalGames];
""",
    'candidate game priority'
)
PROVIDER.write_text(provider)


tests = TESTS.read_text()
tests = replace_once(
    tests,
    """      const metadata = (teamId: string, handles: readonly string[]) => ({
        esportsTeamId: teamId,
        participantMetadata: handles.map((summonerName, index) => ({
          participantId: index + 1,
          summonerName,
          role: roles[index]
        }))
      });
      return json({
        gameMetadata: {
          blueTeamMetadata: metadata('t1-academy-id', academyHandles),
          redTeamMetadata: metadata('dk-challengers-id', dkHandles)
        },
""",
    """      const metadata = (teamId: string, prefix: string, handles: readonly string[]) => ({
        esportsTeamId: teamId,
        participantMetadata: handles.map((handle, index) => ({
          participantId: index + 1,
          esportsPlayerId: `${teamId}-${handle}`,
          summonerName: `${prefix} ${handle}`,
          role: roles[index]
        }))
      });
      return json({
        gameMetadata: {
          blueTeamMetadata: metadata('t1-academy-id', 'T1A', academyHandles),
          redTeamMetadata: metadata('dk-challengers-id', 'DK', dkHandles)
        },
""",
    'prefixed telemetry fixture'
)
TESTS.write_text(tests)
