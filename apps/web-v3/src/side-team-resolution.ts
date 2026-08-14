import type { ScheduleEvent } from '@esports-live/core';
import type { LolTeamState } from '@esports-live/adapter-lol';

export type SeriesTeamRef = ScheduleEvent['series']['teams'][number];

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isGenericTeamId(value: string): boolean {
  return /^(?:team)?(?:1|2)$/.test(value) || /^(?:blue|red|100|200)$/.test(value);
}

function handleHasTeamPrefix(
  handle: string | null | undefined,
  code: string | null | undefined
): boolean {
  const rawHandle = String(handle ?? '').trim();
  const rawCode = String(code ?? '').trim();
  if (!rawHandle || rawCode.length < 2 || rawCode.length > 5) return false;
  if (rawHandle.slice(0, rawCode.length).toLowerCase() !== rawCode.toLowerCase()) return false;
  const next = rawHandle[rawCode.length];
  return next === undefined || /[^a-z]/.test(next) || /[A-Z]/.test(next);
}

function rosterMatch(
  candidates: readonly SeriesTeamRef[],
  statsTeam: LolTeamState
): SeriesTeamRef | null {
  const scored = candidates.map(team => ({
    team,
    matches: statsTeam.players.filter(player => handleHasTeamPrefix(player.handle, team.code)).length
  }));
  const best = Math.max(0, ...scored.map(item => item.matches));
  if (best < 2) return null;
  const winners = scored.filter(item => item.matches === best);
  return winners.length === 1 ? winners[0]!.team : null;
}

export function seriesTeamForSide(
  event: ScheduleEvent | null,
  statsTeam: LolTeamState | null,
  fallbackIndex: 0 | 1
): SeriesTeamRef | null {
  if (!event) return null;
  if (!statsTeam) return event.series.teams[fallbackIndex] ?? null;

  const statsId = normalized(statsTeam.id);
  if (statsId && !isGenericTeamId(statsId)) {
    const byId = event.series.teams.find(team => normalized(team.id) === statsId);
    if (byId) return byId;
  }

  const byRoster = rosterMatch(event.series.teams, statsTeam);
  if (byRoster) return byRoster;

  const statsName = normalized(statsTeam.name);
  if (statsName) {
    const byName = event.series.teams.find(team => normalized(team.name) === statsName);
    if (byName) return byName;

    const byCode = event.series.teams.find(team => {
      const code = normalized(team.code);
      return Boolean(code) && (
        statsName === code
        || statsName.startsWith(code)
        || statsName.endsWith(code)
      );
    });
    if (byCode) return byCode;
  }

  return null;
}
