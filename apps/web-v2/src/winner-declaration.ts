import type {
  LiveSnapshot,
  SeriesContext,
  SeriesGameHistoryRef,
  TeamRef
} from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

interface CompletedGameWinner {
  gameId: string;
  gameNumber: number;
  seriesId: string;
  team: TeamRef;
  side: 'blue' | 'red' | null;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const RESULT_RETRY_MS = 5_000;
const RESULT_TIMEOUT_MS = 12_000;

function normalizedTeamName(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sameTeam(left: TeamRef | null | undefined, right: TeamRef | null | undefined): boolean {
  if (!left || !right) return false;
  if (left.id?.trim() && right.id?.trim() && left.id.trim() === right.id.trim()) return true;
  const leftName = normalizedTeamName(left.name);
  const rightName = normalizedTeamName(right.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

function winnerSide(game: SeriesGameHistoryRef, winner: TeamRef): 'blue' | 'red' | null {
  if (sameTeam(winner, game.blueTeam)) return 'blue';
  if (sameTeam(winner, game.redTeam)) return 'red';
  return null;
}

function teamTag(team: TeamRef): string {
  if (team.code?.trim()) return team.code.trim();
  const words = team.name.split(/\s+/).filter(Boolean);
  return words.length > 1
    ? words.map(word => word[0]?.toUpperCase() ?? '').join('').slice(0, 4)
    : team.name.slice(0, 4).toUpperCase();
}

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new Error('Final result request timed out.')),
    RESULT_TIMEOUT_MS
  );
  const abort = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Final result request returned ${response.status}.`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function loadCompletedGameWinner(
  gameId: string,
  signal?: AbortSignal
): Promise<CompletedGameWinner | null> {
  const snapshot = await requestJson<LiveSnapshot<LolStats>>(
    `/v1/lol/games/${encodeURIComponent(gameId)}/live?final=winner-${Date.now()}`,
    signal
  );
  const seriesId = snapshot.series.id;
  if (!seriesId) return null;

  const context = await requestJson<SeriesContext>(
    `/v1/lol/series/${encodeURIComponent(seriesId)}/context?final=winner-${Date.now()}`,
    signal
  );
  const game = context.history?.games.find(candidate => candidate.id === snapshot.game.id)
    ?? context.history?.games.find(candidate => (
      candidate.number === snapshot.game.number && candidate.state === 'completed'
    ))
    ?? null;
  if (!game?.winner) return null;

  return {
    gameId,
    gameNumber: game.number,
    seriesId,
    team: game.winner,
    side: winnerSide(game, game.winner)
  };
}

export class WinnerDeclarationController {
  readonly #root: HTMLElement;
  readonly #results = new Map<string, CompletedGameWinner>();
  #observer: MutationObserver | null = null;
  #requestController: AbortController | null = null;
  #retryTimer: number | null = null;
  #activeGameId = '';
  #syncQueued = false;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  start(): void {
    if (this.#observer) return;
    this.#observer = new MutationObserver(() => this.#queueSync());
    this.#observer.observe(this.#root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-game-state', 'data-game-id', 'aria-busy']
    });
    document.addEventListener('visibilitychange', this.#visibilityChanged);
    this.#sync();
  }

  stop(): void {
    this.#observer?.disconnect();
    this.#observer = null;
    document.removeEventListener('visibilitychange', this.#visibilityChanged);
    this.#cancelPending();
  }

  readonly #visibilityChanged = (): void => {
    if (document.hidden) {
      this.#cancelPending();
      return;
    }
    this.#queueSync();
  };

  #queueSync(): void {
    if (this.#syncQueued) return;
    this.#syncQueued = true;
    queueMicrotask(() => {
      this.#syncQueued = false;
      this.#sync();
    });
  }

  #cancelPending(): void {
    this.#requestController?.abort();
    this.#requestController = null;
    if (this.#retryTimer !== null) window.clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #scoreboard(): HTMLElement | null {
    return this.#root.querySelector<HTMLElement>('#scoreboard');
  }

  #resetResultMetadata(scoreboard: HTMLElement): void {
    delete scoreboard.dataset.winnerTeamId;
    delete scoreboard.dataset.winnerSide;
    this.#root.querySelector<HTMLElement>('#gold-lead')?.removeAttribute('title');
  }

  #applyPending(scoreboard: HTMLElement): void {
    const label = this.#root.querySelector<HTMLElement>('#gold-lead-label');
    const value = this.#root.querySelector<HTMLElement>('#gold-lead');
    if (!label || !value) return;
    if (label.textContent !== 'FINAL RESULT') label.textContent = 'FINAL RESULT';
    if (value.textContent !== 'PENDING') value.textContent = 'PENDING';
    if (value.dataset.side !== 'neutral') value.dataset.side = 'neutral';
    value.removeAttribute('title');
    delete scoreboard.dataset.winnerTeamId;
    delete scoreboard.dataset.winnerSide;
  }

  #applyWinner(scoreboard: HTMLElement, result: CompletedGameWinner): void {
    const label = this.#root.querySelector<HTMLElement>('#gold-lead-label');
    const value = this.#root.querySelector<HTMLElement>('#gold-lead');
    const notice = this.#root.querySelector<HTMLElement>('#scoreboard-notice');
    if (!label || !value) return;

    if (label.textContent !== 'WINNER') label.textContent = 'WINNER';
    const tag = teamTag(result.team);
    if (value.textContent !== tag) value.textContent = tag;
    const side = result.side ?? 'neutral';
    if (value.dataset.side !== side) value.dataset.side = side;
    value.title = result.team.name;
    scoreboard.dataset.winnerTeamId = result.team.id;
    scoreboard.dataset.winnerSide = side;
    if (notice) {
      const message = `${result.team.name} won Game ${result.gameNumber}.`;
      if (notice.textContent !== message) notice.textContent = message;
    }
  }

  #scheduleRetry(gameId: string): void {
    if (this.#retryTimer !== null || document.hidden) return;
    this.#retryTimer = window.setTimeout(() => {
      this.#retryTimer = null;
      if (this.#activeGameId === gameId) void this.#resolve(gameId);
    }, RESULT_RETRY_MS);
  }

  async #resolve(gameId: string): Promise<void> {
    if (this.#requestController || document.hidden || this.#activeGameId !== gameId) return;
    const controller = new AbortController();
    this.#requestController = controller;
    try {
      const result = await loadCompletedGameWinner(gameId, controller.signal);
      if (controller.signal.aborted || this.#activeGameId !== gameId) return;
      if (!result) {
        this.#scheduleRetry(gameId);
        return;
      }
      this.#results.set(gameId, result);
      const scoreboard = this.#scoreboard();
      if (scoreboard?.dataset.gameId === gameId && scoreboard.dataset.gameState === 'completed') {
        this.#applyWinner(scoreboard, result);
      }
    } catch {
      if (!controller.signal.aborted && this.#activeGameId === gameId) {
        this.#scheduleRetry(gameId);
      }
    } finally {
      if (this.#requestController === controller) this.#requestController = null;
    }
  }

  #sync(): void {
    const scoreboard = this.#scoreboard();
    if (!scoreboard) return;
    const gameId = scoreboard.dataset.gameId?.trim() ?? '';
    const final = scoreboard.dataset.gameState === 'completed';
    const ready = scoreboard.getAttribute('aria-busy') !== 'true';

    if (!final || !gameId || !ready) {
      if (gameId !== this.#activeGameId || !final) {
        this.#cancelPending();
        this.#activeGameId = final ? gameId : '';
      }
      if (!final) this.#resetResultMetadata(scoreboard);
      return;
    }

    if (this.#activeGameId !== gameId) {
      this.#cancelPending();
      this.#activeGameId = gameId;
    }

    const cached = this.#results.get(gameId);
    if (cached) {
      this.#applyWinner(scoreboard, cached);
      return;
    }

    this.#applyPending(scoreboard);
    if (!this.#requestController && this.#retryTimer === null) void this.#resolve(gameId);
  }
}

export function installWinnerDeclaration(root: HTMLElement): WinnerDeclarationController {
  const controller = new WinnerDeclarationController(root);
  controller.start();
  window.addEventListener('beforeunload', () => controller.stop(), { once: true });
  return controller;
}
