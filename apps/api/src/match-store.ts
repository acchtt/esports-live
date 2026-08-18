import type {
  ScheduleEvent,
  SeriesContext,
  SeriesGameHistoryRef,
  TeamRef
} from '@esports-live/core';

export interface MatchDatabaseStatement {
  bind(...values: unknown[]): MatchDatabaseStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface MatchDatabase {
  prepare(query: string): MatchDatabaseStatement;
  batch(statements: MatchDatabaseStatement[]): Promise<unknown>;
}

export interface MatchStore {
  recordSchedule(events: readonly ScheduleEvent[]): Promise<void>;
  mergeSchedule(events: readonly ScheduleEvent[]): Promise<readonly ScheduleEvent[]>;
  recordSeriesContext(seriesId: string, context: SeriesContext): Promise<void>;
}

interface StoredSeriesRow {
  latest_payload_json: string;
  final_payload_json: string | null;
  final_verified: number;
}

interface StoredFinalRow {
  series_id: string;
  final_payload_json: string | null;
}

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function eventTeamKey(event: ScheduleEvent, team: TeamRef | null | undefined): string | null {
  if (!team) return null;
  const id = team.id?.trim() ?? '';
  const name = normalized(team.name);
  const code = normalized(team.code);

  for (const candidate of event.series.teams) {
    if (id && candidate.id?.trim() === id) return candidate.id;
    if (name && normalized(candidate.name) === name) return candidate.id || name;
    if (code && normalized(candidate.code) === code) return candidate.id || code;
  }
  return null;
}

function activeHistoryGame(game: SeriesGameHistoryRef): boolean {
  return game.state === 'live' || game.state === 'draft' || game.state === 'paused';
}

function finalEventFromContext(
  event: ScheduleEvent,
  context: SeriesContext
): ScheduleEvent | null {
  if (context.seriesId !== event.series.id) return null;
  const history = context.history;
  if (!history || history.games.some(activeHistoryGame)) return null;

  const winsRequired = Math.max(
    1,
    history.winsRequired || Math.floor(Math.max(1, history.bestOf) / 2) + 1
  );
  const winnerCounts = new Map<string, number>();
  const seenGames = new Set<string>();

  for (const game of history.games) {
    if (game.state !== 'completed' || !game.winner) continue;
    const uniqueGame = game.id?.trim() || `game-${game.number}`;
    if (seenGames.has(uniqueGame)) continue;
    seenGames.add(uniqueGame);
    const winnerKey = eventTeamKey(event, game.winner);
    if (!winnerKey) continue;
    winnerCounts.set(winnerKey, (winnerCounts.get(winnerKey) ?? 0) + 1);
  }

  if (![...winnerCounts.values()].some(wins => wins >= winsRequired)) return null;

  const score = event.series.teams.map(team => ({
    team,
    wins: winnerCounts.get(team.id) ?? winnerCounts.get(normalized(team.name)) ?? 0
  })) as [
    { team: TeamRef; wins: number },
    { team: TeamRef; wins: number }
  ];

  return {
    ...event,
    observedAt: context.observedAt || event.observedAt,
    series: {
      ...event.series,
      state: 'completed',
      bestOf: history.bestOf || event.series.bestOf,
      score,
      games: history.games.map(game => ({
        id: game.id,
        number: game.number,
        state: game.state
      }))
    }
  };
}

function parseEvent(value: string | null): ScheduleEvent | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ScheduleEvent;
  } catch {
    return null;
  }
}

function mergedFinalEvent(current: ScheduleEvent, stored: ScheduleEvent): ScheduleEvent {
  return {
    ...current,
    observedAt: current.observedAt,
    series: {
      ...current.series,
      state: 'completed',
      games: stored.series.games,
      ...(stored.series.score ? { score: stored.series.score } : {})
    }
  };
}

export function createD1MatchStore(db: MatchDatabase): MatchStore {
  return {
    async recordSchedule(events) {
      if (!events.length) return;
      const now = new Date().toISOString();
      const statements: MatchDatabaseStatement[] = [];

      for (const event of events) {
        statements.push(db.prepare(`
          INSERT INTO match_series (
            series_id,
            esport,
            competition_id,
            scheduled_start,
            last_state,
            latest_payload_json,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(series_id) DO UPDATE SET
            esport = excluded.esport,
            competition_id = excluded.competition_id,
            scheduled_start = excluded.scheduled_start,
            last_state = excluded.last_state,
            latest_payload_json = excluded.latest_payload_json,
            updated_at = excluded.updated_at
        `).bind(
          event.series.id,
          event.series.esport,
          event.series.competition.id,
          event.series.scheduledStart,
          event.series.state,
          JSON.stringify(event),
          now
        ));

        for (const game of event.series.games) {
          statements.push(db.prepare(`
            INSERT INTO match_games (
              game_id,
              series_id,
              game_number,
              state,
              winner_team_id,
              updated_at
            ) VALUES (?, ?, ?, ?, NULL, ?)
            ON CONFLICT(game_id) DO UPDATE SET
              series_id = excluded.series_id,
              game_number = excluded.game_number,
              state = excluded.state,
              updated_at = excluded.updated_at
          `).bind(
            game.id,
            event.series.id,
            game.number,
            game.state,
            now
          ));
        }
      }

      await db.batch(statements);
    },

    async mergeSchedule(events) {
      if (!events.length) return events;
      const ids = [...new Set(events.map(event => event.series.id))];
      const placeholders = ids.map(() => '?').join(',');
      const result = await db.prepare(`
        SELECT series_id, final_payload_json
        FROM match_series
        WHERE final_verified = 1
          AND final_payload_json IS NOT NULL
          AND series_id IN (${placeholders})
      `).bind(...ids).all<StoredFinalRow>();
      const finals = new Map<string, ScheduleEvent>();

      for (const row of result.results ?? []) {
        const event = parseEvent(row.final_payload_json);
        if (event) finals.set(row.series_id, event);
      }

      return events.map(event => {
        if (event.series.state === 'completed') return event;
        const finalEvent = finals.get(event.series.id);
        return finalEvent ? mergedFinalEvent(event, finalEvent) : event;
      });
    },

    async recordSeriesContext(seriesId, context) {
      const now = new Date().toISOString();
      const history = context.history;
      const hasActiveGame = history?.games.some(activeHistoryGame) ?? false;
      const row = await db.prepare(`
        SELECT latest_payload_json, final_payload_json, final_verified
        FROM match_series
        WHERE series_id = ?
      `).bind(seriesId).first<StoredSeriesRow>();

      await db.prepare(`
        INSERT INTO match_contexts (
          series_id,
          observed_at,
          payload_json,
          updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(series_id) DO UPDATE SET
          observed_at = excluded.observed_at,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `).bind(
        seriesId,
        context.observedAt,
        JSON.stringify(context),
        now
      ).run();

      if (history?.games.length) {
        const statements = history.games.map(game => db.prepare(`
          INSERT INTO match_games (
            game_id,
            series_id,
            game_number,
            state,
            winner_team_id,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id) DO UPDATE SET
            series_id = excluded.series_id,
            game_number = excluded.game_number,
            state = excluded.state,
            winner_team_id = COALESCE(excluded.winner_team_id, match_games.winner_team_id),
            updated_at = excluded.updated_at
        `).bind(
          game.id,
          seriesId,
          game.number,
          game.state,
          game.winner?.id ?? null,
          now
        ));
        await db.batch(statements);
      }

      if (hasActiveGame) {
        await db.prepare(`
          UPDATE match_series
          SET final_verified = 0,
              final_payload_json = NULL,
              final_verified_at = NULL,
              updated_at = ?
          WHERE series_id = ?
        `).bind(now, seriesId).run();
        return;
      }

      const latest = parseEvent(row?.latest_payload_json ?? null);
      if (!latest) return;
      const finalEvent = finalEventFromContext(latest, context);
      if (!finalEvent) return;

      await db.prepare(`
        UPDATE match_series
        SET final_verified = 1,
            final_payload_json = ?,
            final_verified_at = ?,
            updated_at = ?
        WHERE series_id = ?
      `).bind(
        JSON.stringify(finalEvent),
        context.observedAt || now,
        now,
        seriesId
      ).run();
    }
  };
}
