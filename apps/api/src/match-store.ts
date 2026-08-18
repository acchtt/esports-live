import type {
  ScheduleEvent,
  SeriesContext,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import { mergeObservedSeriesHistory } from '@esports-live/adapter-lol';

const D1_BATCH_CHUNK = 40;
const D1_LOOKUP_CHUNK = 40;

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
  persistSeriesContext(seriesId: string, context: SeriesContext): Promise<SeriesContext>;
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

interface StoredContextRow {
  payload_json: string;
}

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sameTeam(left: TeamRef | null | undefined, right: TeamRef | null | undefined): boolean {
  if (!left || !right) return false;
  if (left.id?.trim() && right.id?.trim() && left.id.trim() === right.id.trim()) return true;
  const leftName = normalized(left.name);
  const rightName = normalized(right.name);
  if (leftName && rightName && leftName === rightName) return true;
  const leftCode = normalized(left.code);
  const rightCode = normalized(right.code);
  return Boolean(leftCode && rightCode && leftCode === rightCode);
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

function historyTeamsMatch(previous: SeriesHistoryRef, incoming: SeriesHistoryRef): boolean {
  return sameTeam(previous.score[0]?.team, incoming.score[0]?.team)
    && sameTeam(previous.score[1]?.team, incoming.score[1]?.team);
}

function historyTeamIndex(history: SeriesHistoryRef, winner: TeamRef | null): 0 | 1 | null {
  if (!winner) return null;
  if (sameTeam(history.score[0]?.team, winner)) return 0;
  if (sameTeam(history.score[1]?.team, winner)) return 1;
  return null;
}

function restoreIncomingActiveStates(
  merged: SeriesHistoryRef,
  incoming: SeriesHistoryRef
): SeriesHistoryRef {
  const incomingById = new Map(incoming.games.map(game => [game.id, game]));
  const incomingByNumber = new Map(incoming.games.map(game => [game.number, game]));
  return {
    ...merged,
    games: merged.games.map(game => {
      const current = incomingById.get(game.id) ?? incomingByNumber.get(game.number);
      if (!current || !activeHistoryGame(current)) return game;
      // A current active state is preserved here instead of being overwritten by
      // older completed state. Only a separate, already-clinched completed-game
      // sequence below may prove that a later active slot is a phantom.
      return { ...game, state: current.state };
    })
  };
}

export function reconcileClinchedTrailingHistory(history: SeriesHistoryRef): SeriesHistoryRef {
  const winsRequired = Math.max(
    1,
    history.winsRequired || Math.floor(Math.max(1, history.bestOf) / 2) + 1
  );
  const counts: [number, number] = [0, 0];
  const seenGames = new Set<string>();
  let clinchNumber: number | null = null;
  let winnerIndex: 0 | 1 | null = null;

  const completed = [...history.games]
    .filter(game => game.state === 'completed' && game.winner)
    .sort((left, right) => left.number - right.number);

  for (const game of completed) {
    const key = game.id?.trim() || `game-${game.number}`;
    if (seenGames.has(key)) continue;
    seenGames.add(key);
    const index = historyTeamIndex(history, game.winner);
    if (index === null) continue;
    counts[index] += 1;
    if (counts[index] >= winsRequired) {
      clinchNumber = game.number;
      winnerIndex = index;
      break;
    }
  }

  if (clinchNumber === null || winnerIndex === null) return history;
  if ((history.score[winnerIndex]?.wins ?? 0) < winsRequired) return history;

  let changed = false;
  const games = history.games.map(game => {
    if (game.number <= clinchNumber || !activeHistoryGame(game)) return game;
    changed = true;
    return { ...game, state: 'unstarted' as const };
  });
  return changed ? { ...history, games } : history;
}

export function mergePersistedSeriesContext(
  previous: SeriesContext | null,
  incoming: SeriesContext
): SeriesContext {
  if (!incoming.history) return incoming;

  const previousHistory = previous?.seriesId === incoming.seriesId
    && previous.history
    && historyTeamsMatch(previous.history, incoming.history)
    ? previous.history
    : undefined;
  const monotonic = mergeObservedSeriesHistory(previousHistory, incoming.history);
  const activeSafe = restoreIncomingActiveStates(monotonic, incoming.history);
  const history = reconcileClinchedTrailingHistory(activeSafe);
  return { ...incoming, history };
}

async function runBatches(
  db: MatchDatabase,
  statements: readonly MatchDatabaseStatement[]
): Promise<void> {
  for (let offset = 0; offset < statements.length; offset += D1_BATCH_CHUNK) {
    await db.batch(statements.slice(offset, offset + D1_BATCH_CHUNK));
  }
}

export function contextHasActiveGame(context: SeriesContext): boolean {
  return context.history?.games.some(activeHistoryGame) ?? false;
}

export function verifiedFinalEventFromContext(
  event: ScheduleEvent,
  context: SeriesContext
): ScheduleEvent | null {
  if (context.seriesId !== event.series.id) return null;
  const history = context.history;
  if (!history || contextHasActiveGame(context)) return null;

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
      games: history.games
        .filter(game => game.state === 'completed')
        .map(game => ({
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

function parseContext(value: string | null): SeriesContext | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as SeriesContext;
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

      await runBatches(db, statements);
    },

    async mergeSchedule(events) {
      if (!events.length) return events;
      const ids = [...new Set(events.map(event => event.series.id))];
      const finals = new Map<string, ScheduleEvent>();

      for (let offset = 0; offset < ids.length; offset += D1_LOOKUP_CHUNK) {
        const chunk = ids.slice(offset, offset + D1_LOOKUP_CHUNK);
        const placeholders = chunk.map(() => '?').join(',');
        const result = await db.prepare(`
          SELECT series_id, final_payload_json
          FROM match_series
          WHERE final_verified = 1
            AND final_payload_json IS NOT NULL
            AND series_id IN (${placeholders})
        `).bind(...chunk).all<StoredFinalRow>();

        for (const row of result.results ?? []) {
          const event = parseEvent(row.final_payload_json);
          if (event) finals.set(row.series_id, event);
        }
      }

      return events.map(event => {
        if (event.series.state === 'completed') return event;
        const finalEvent = finals.get(event.series.id);
        return finalEvent ? mergedFinalEvent(event, finalEvent) : event;
      });
    },

    async persistSeriesContext(seriesId, incomingContext) {
      const now = new Date().toISOString();
      const seriesRow = await db.prepare(`
        SELECT latest_payload_json, final_payload_json, final_verified
        FROM match_series
        WHERE series_id = ?
      `).bind(seriesId).first<StoredSeriesRow>();
      const contextRow = await db.prepare(`
        SELECT payload_json
        FROM match_contexts
        WHERE series_id = ?
      `).bind(seriesId).first<StoredContextRow>();
      const context = mergePersistedSeriesContext(
        parseContext(contextRow?.payload_json ?? null),
        incomingContext
      );
      const history = context.history;
      const hasActiveGame = contextHasActiveGame(context);

      // A direct context request can arrive before the catalogue has written its
      // schedule row. In that case serve the reconciled provider context without
      // turning a missing FK parent into an API failure.
      if (!seriesRow) return context;

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
        await runBatches(db, statements);
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
        return context;
      }

      const latest = parseEvent(seriesRow.latest_payload_json);
      if (!latest) return context;
      const finalEvent = verifiedFinalEventFromContext(latest, context);
      if (!finalEvent) return context;

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
      return context;
    }
  };
}
