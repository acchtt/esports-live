type ObjectiveKey = 'dragons' | 'barons';

type TimerStatus = 'spawn' | 'respawn' | 'up' | 'tracking';

interface ObjectiveCounts {
  blue: number | null;
  red: number | null;
  total: number | null;
}

interface GameTimerState {
  gameId: string;
  gameState: string;
  baseClock: number | null;
  baseWallMs: number;
  lastDomClock: number | null;
  lastCountClock: number | null;
  dragonCount: number | null;
  baronCount: number | null;
  dragonLastKillClock: number | null;
  baronLastKillClock: number | null;
  dragonRespawnSeconds: number;
  updatedAt: number;
}

interface StoredTimerState {
  gameId: string;
  lastCountClock: number | null;
  dragonCount: number | null;
  baronCount: number | null;
  dragonLastKillClock: number | null;
  baronLastKillClock: number | null;
  dragonRespawnSeconds: number;
  updatedAt: number;
}

interface TimerView {
  text: string;
  status: TimerStatus;
  estimated: boolean;
}

const STORAGE_KEY = 'esports-live:v2-objective-timers:v1';
const STORAGE_TTL_MS = 6 * 60 * 60 * 1_000;
const INFERENCE_MAX_CLOCK_GAP_SECONDS = 8;
const TICK_MS = 1_000;
const DRAGON_INITIAL_SPAWN_SECONDS = 5 * 60;
const DRAGON_RESPAWN_SECONDS = 5 * 60;
const ELDER_DRAGON_RESPAWN_SECONDS = 6 * 60;
const BARON_INITIAL_SPAWN_SECONDS = 20 * 60;
const BARON_RESPAWN_SECONDS = 6 * 60;

function parseClock(value: string | null | undefined): number | null {
  const match = /^(\d+):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) return null;
  return minutes * 60 + seconds;
}

function parseCount(value: string | null | undefined): number | null {
  const normalized = String(value ?? '').replace(/[^\d-]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const count = Number(normalized);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function activeGameState(value: string): boolean {
  return value === 'live' || value === 'paused' || value === 'draft';
}

function liveGameState(value: string): boolean {
  return value === 'live';
}

function readStoredStates(): ReadonlyMap<string, StoredTimerState> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const value = JSON.parse(raw) as { games?: readonly StoredTimerState[] };
    const now = Date.now();
    return new Map((value.games ?? [])
      .filter(game => game?.gameId && now - game.updatedAt <= STORAGE_TTL_MS)
      .map(game => [game.gameId, game]));
  } catch {
    return new Map();
  }
}

function objectiveCounts(scoreboard: HTMLElement, key: ObjectiveKey): ObjectiveCounts {
  const card = scoreboard.querySelector<HTMLElement>(`[data-objective="${key}"]`);
  if (!card) return { blue: null, red: null, total: null };
  const blue = parseCount(card.querySelector<HTMLElement>('[data-side="blue"]')?.textContent);
  const red = parseCount(card.querySelector<HTMLElement>('[data-side="red"]')?.textContent);
  return {
    blue,
    red,
    total: blue === null || red === null ? null : blue + red
  };
}

function timerElement(scoreboard: HTMLElement, key: ObjectiveKey): HTMLElement | null {
  const card = scoreboard.querySelector<HTMLElement>(`[data-objective="${key}"]`);
  if (!card) return null;
  let timer = card.querySelector<HTMLElement>('[data-objective-timer]');
  if (!timer) {
    timer = document.createElement('small');
    timer.className = 'objective-timer';
    timer.dataset.objectiveTimer = key;
    timer.setAttribute('aria-live', 'off');
    card.append(timer);
  }
  return timer;
}

function nextDragonRespawnSeconds(counts: ObjectiveCounts): number {
  return Math.max(counts.blue ?? 0, counts.red ?? 0) >= 4
    ? ELDER_DRAGON_RESPAWN_SECONDS
    : DRAGON_RESPAWN_SECONDS;
}

export class ObjectiveTimerController {
  readonly #root: HTMLElement;
  readonly #games = new Map<string, GameTimerState>();
  readonly #stored = readStoredStates();
  #interval: number | null = null;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  start(): void {
    if (this.#interval !== null) return;
    this.#sync();
    this.#interval = window.setInterval(() => this.#sync(), TICK_MS);
  }

  stop(): void {
    if (this.#interval !== null) window.clearInterval(this.#interval);
    this.#interval = null;
  }

  #state(gameId: string, gameState: string, clock: number | null, now: number): GameTimerState {
    const existing = this.#games.get(gameId);
    if (existing) return existing;
    const stored = this.#stored.get(gameId);
    const state: GameTimerState = {
      gameId,
      gameState,
      baseClock: clock,
      baseWallMs: now,
      lastDomClock: clock,
      lastCountClock: stored?.lastCountClock ?? null,
      dragonCount: stored?.dragonCount ?? null,
      baronCount: stored?.baronCount ?? null,
      dragonLastKillClock: stored?.dragonLastKillClock ?? null,
      baronLastKillClock: stored?.baronLastKillClock ?? null,
      dragonRespawnSeconds: stored?.dragonRespawnSeconds ?? DRAGON_RESPAWN_SECONDS,
      updatedAt: now
    };
    this.#games.set(gameId, state);
    return state;
  }

  #currentClock(state: GameTimerState, now: number): number | null {
    if (state.baseClock === null) return null;
    if (!liveGameState(state.gameState)) return state.baseClock;
    return state.baseClock + Math.max(0, now - state.baseWallMs) / 1_000;
  }

  #observeCounts(
    state: GameTimerState,
    clock: number | null,
    dragons: ObjectiveCounts,
    barons: ObjectiveCounts,
    now: number
  ): void {
    const closeEnough = clock !== null
      && state.lastCountClock !== null
      && clock >= state.lastCountClock
      && clock - state.lastCountClock <= INFERENCE_MAX_CLOCK_GAP_SECONDS;

    if (dragons.total !== null) {
      if (state.dragonCount !== null && dragons.total > state.dragonCount) {
        state.dragonLastKillClock = closeEnough ? clock : null;
        state.dragonRespawnSeconds = nextDragonRespawnSeconds(dragons);
      } else if (state.dragonCount !== null && dragons.total < state.dragonCount) {
        state.dragonLastKillClock = null;
      }
      state.dragonCount = dragons.total;
    }

    if (barons.total !== null) {
      if (state.baronCount !== null && barons.total > state.baronCount) {
        state.baronLastKillClock = closeEnough ? clock : null;
      } else if (state.baronCount !== null && barons.total < state.baronCount) {
        state.baronLastKillClock = null;
      }
      state.baronCount = barons.total;
    }

    if (clock !== null) state.lastCountClock = clock;
    state.updatedAt = now;
  }

  #timerView(
    key: ObjectiveKey,
    state: GameTimerState,
    currentClock: number | null
  ): TimerView {
    if (currentClock === null) return { text: 'TRACKING', status: 'tracking', estimated: false };

    if (key === 'dragons') {
      if (state.dragonCount === null) {
        return { text: 'TRACKING', status: 'tracking', estimated: false };
      }
      if (state.dragonCount === 0) {
        const remaining = DRAGON_INITIAL_SPAWN_SECONDS - currentClock;
        return remaining > 0
          ? { text: `SPAWN ${formatTimer(remaining)}`, status: 'spawn', estimated: false }
          : { text: 'UP', status: 'up', estimated: false };
      }
      if (state.dragonLastKillClock === null) {
        return { text: 'TRACKING', status: 'tracking', estimated: false };
      }
      const remaining = state.dragonLastKillClock + state.dragonRespawnSeconds - currentClock;
      return remaining > 0
        ? { text: `RESPAWN ~${formatTimer(remaining)}`, status: 'respawn', estimated: true }
        : { text: 'UP', status: 'up', estimated: false };
    }

    if (state.baronCount === null) {
      return { text: 'TRACKING', status: 'tracking', estimated: false };
    }
    if (state.baronCount === 0) {
      const remaining = BARON_INITIAL_SPAWN_SECONDS - currentClock;
      return remaining > 0
        ? { text: `SPAWN ${formatTimer(remaining)}`, status: 'spawn', estimated: false }
        : { text: 'UP', status: 'up', estimated: false };
    }
    if (state.baronLastKillClock === null) {
      return { text: 'TRACKING', status: 'tracking', estimated: false };
    }
    const remaining = state.baronLastKillClock + BARON_RESPAWN_SECONDS - currentClock;
    return remaining > 0
      ? { text: `RESPAWN ~${formatTimer(remaining)}`, status: 'respawn', estimated: true }
      : { text: 'UP', status: 'up', estimated: false };
  }

  #renderTimer(scoreboard: HTMLElement, key: ObjectiveKey, view: TimerView | null): void {
    const timer = timerElement(scoreboard, key);
    if (!timer) return;
    const card = timer.closest<HTMLElement>('[data-objective]');
    if (!view) {
      timer.hidden = true;
      card?.classList.remove('has-objective-timer');
      return;
    }
    timer.hidden = false;
    timer.textContent = view.text;
    timer.dataset.status = view.status;
    timer.dataset.estimated = String(view.estimated);
    card?.classList.add('has-objective-timer');
  }

  #persist(): void {
    try {
      const games: StoredTimerState[] = [...this.#games.values()]
        .filter(game => Date.now() - game.updatedAt <= STORAGE_TTL_MS)
        .map(game => ({
          gameId: game.gameId,
          lastCountClock: game.lastCountClock,
          dragonCount: game.dragonCount,
          baronCount: game.baronCount,
          dragonLastKillClock: game.dragonLastKillClock,
          baronLastKillClock: game.baronLastKillClock,
          dragonRespawnSeconds: game.dragonRespawnSeconds,
          updatedAt: game.updatedAt
        }));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ games }));
    } catch {
      // Storage is an optimization only; timers continue in memory when unavailable.
    }
  }

  #sync(): void {
    const scoreboard = this.#root.querySelector<HTMLElement>('#scoreboard');
    if (!scoreboard) return;
    const gameId = scoreboard.dataset.gameId?.trim() ?? '';
    const gameState = scoreboard.dataset.gameState?.trim() ?? 'unknown';
    if (!gameId || !activeGameState(gameState)) {
      this.#renderTimer(scoreboard, 'dragons', null);
      this.#renderTimer(scoreboard, 'barons', null);
      return;
    }

    const now = Date.now();
    const domClock = parseClock(this.#root.querySelector<HTMLElement>('#game-clock')?.textContent);
    const dragons = objectiveCounts(scoreboard, 'dragons');
    const barons = objectiveCounts(scoreboard, 'barons');
    const state = this.#state(gameId, gameState, domClock, now);
    state.gameState = gameState;

    if (domClock !== null && domClock !== state.lastDomClock) {
      state.baseClock = domClock;
      state.baseWallMs = now;
      state.lastDomClock = domClock;
    } else if (state.baseClock === null && domClock !== null) {
      state.baseClock = domClock;
      state.baseWallMs = now;
      state.lastDomClock = domClock;
    }

    this.#observeCounts(state, domClock, dragons, barons, now);
    const currentClock = this.#currentClock(state, now);
    this.#renderTimer(scoreboard, 'dragons', this.#timerView('dragons', state, currentClock));
    this.#renderTimer(scoreboard, 'barons', this.#timerView('barons', state, currentClock));
    this.#persist();
  }
}

export function installObjectiveTimers(root: HTMLElement): ObjectiveTimerController {
  const controller = new ObjectiveTimerController(root);
  controller.start();
  window.addEventListener('beforeunload', () => controller.stop(), { once: true });
  return controller;
}
