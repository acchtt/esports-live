import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

const nativeFetch = window.fetch.bind(window);
const latest = new Map<string, LiveSnapshot<LolStats>>();

function sourceMs(snapshot: LiveSnapshot<LolStats>): number | null {
  const parsed = Date.parse(snapshot.quality.sourceTimestamp ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function mergePlayer(previous: LolPlayerState | undefined, incoming: LolPlayerState): LolPlayerState {
  if (!previous) return incoming;
  return {
    id: incoming.id || previous.id,
    handle: incoming.handle ?? previous.handle,
    championId: incoming.championId ?? previous.championId,
    role: incoming.role ?? previous.role,
    level: incoming.level ?? previous.level,
    kills: incoming.kills ?? previous.kills,
    deaths: incoming.deaths ?? previous.deaths,
    assists: incoming.assists ?? previous.assists,
    creepScore: incoming.creepScore ?? previous.creepScore,
    totalGold: incoming.totalGold ?? previous.totalGold,
    items: incoming.items ?? previous.items
  };
}

function mergeTeam(previous: LolTeamState, incoming: LolTeamState): LolTeamState {
  const oldPlayers = new Map(previous.players.map(player => [player.id, player]));
  const players = incoming.players.length ? incoming.players : previous.players;
  return {
    id: incoming.id || previous.id,
    name: incoming.name || previous.name,
    side: incoming.side,
    gold: incoming.gold ?? previous.gold,
    kills: incoming.kills ?? previous.kills,
    objectives: {
      towers: incoming.objectives.towers ?? previous.objectives.towers,
      inhibitors: incoming.objectives.inhibitors ?? previous.objectives.inhibitors,
      dragons: incoming.objectives.dragons ?? previous.objectives.dragons,
      barons: incoming.objectives.barons ?? previous.objectives.barons,
      heralds: incoming.objectives.heralds ?? previous.objectives.heralds,
      grubs: incoming.objectives.grubs ?? previous.objectives.grubs
    },
    players: players.map(player => mergePlayer(oldPlayers.get(player.id), player))
  };
}

function mergeStats(previous: LolStats, incoming: LolStats): LolStats {
  return {
    gameClockSeconds: incoming.gameClockSeconds ?? previous.gameClockSeconds,
    patch: incoming.patch ?? previous.patch,
    blue: mergeTeam(previous.blue, incoming.blue),
    red: mergeTeam(previous.red, incoming.red)
  };
}

function regression(previous: LiveSnapshot<LolStats>, incoming: LiveSnapshot<LolStats>): boolean {
  if (previous.stats && !incoming.stats) return true;
  const oldSource = sourceMs(previous);
  const newSource = sourceMs(incoming);
  if (oldSource !== null && newSource !== null && newSource < oldSource) return true;

  const oldClock = previous.stats?.gameClockSeconds ?? null;
  const newClock = incoming.stats?.gameClockSeconds ?? null;
  return oldClock !== null && newClock !== null && newClock + 2 < oldClock;
}

function consistentSnapshot(incoming: LiveSnapshot<LolStats>): LiveSnapshot<LolStats> {
  const key = incoming.game.id;
  const previous = latest.get(key);
  if (!previous) {
    latest.set(key, incoming);
    return incoming;
  }
  if (regression(previous, incoming)) return previous;
  if (!previous.stats || !incoming.stats) {
    latest.set(key, incoming);
    return incoming;
  }

  const merged: LiveSnapshot<LolStats> = {
    ...incoming,
    stats: mergeStats(previous.stats, incoming.stats)
  };
  latest.set(key, merged);
  return merged;
}

function liveGameRequest(input: RequestInfo | URL): boolean {
  try {
    const value = input instanceof Request ? input.url : String(input);
    const url = new URL(value, window.location.href);
    return /\/v1\/lol\/games\/[^/]+\/live$/.test(url.pathname);
  } catch {
    return false;
  }
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const response = await nativeFetch(input, init);
  if (!response.ok || !liveGameRequest(input)) return response;

  try {
    const body = await response.clone().json() as LiveSnapshot<LolStats>;
    if (!body?.game?.id || body.esport !== 'lol') return response;
    const merged = consistentSnapshot(body);
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.delete('content-length');
    return new Response(JSON.stringify(merged), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return response;
  }
};
