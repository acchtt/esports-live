import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { readSnapshotCache, SNAPSHOT_UPDATED_EVENT } from './snapshot-cache.ts';

type Side = 'blue' | 'red';

interface GrubState {
  blue: number | null;
  red: number | null;
  gameState: string;
}

const LIVE_UNAVAILABLE_COPY = 'LIVE N/A';
const LIVE_UNAVAILABLE_EXPLANATION = 'Riot live telemetry does not provide Void Grub counts.';

function normalizedCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stateFromSnapshot(snapshot: LiveSnapshot<LolStats>): GrubState | null {
  if (!snapshot.stats) return null;
  return {
    blue: normalizedCount(snapshot.stats.blue.objectives.grubs),
    red: normalizedCount(snapshot.stats.red.objectives.grubs),
    gameState: snapshot.game.state
  };
}

function createScore(side: Side): HTMLElement {
  const score = document.createElement('b');
  score.dataset.side = side;
  score.textContent = '—';
  return score;
}

function ensureCard(root: ParentNode): HTMLElement | null {
  const grid = root.querySelector<HTMLElement>('.objective-grid');
  if (!grid) return null;

  const existing = grid.querySelector<HTMLElement>('[data-objective="grubs"]');
  if (existing) return existing;

  const card = document.createElement('article');
  card.dataset.objective = 'grubs';

  const label = document.createElement('span');
  label.textContent = 'GRUBS';

  const scores = document.createElement('strong');
  const separator = document.createElement('i');
  separator.textContent = '−';
  const unavailable = document.createElement('em');
  unavailable.dataset.grubsLiveUnavailable = 'true';
  unavailable.textContent = LIVE_UNAVAILABLE_COPY;
  unavailable.hidden = true;
  scores.append(createScore('blue'), separator, createScore('red'), unavailable);
  card.append(label, scores);

  const barons = grid.querySelector('[data-objective="barons"]');
  grid.insertBefore(card, barons);
  return card;
}

function setScore(card: ParentNode, side: Side, value: number | null): void {
  const score = card.querySelector<HTMLElement>(`[data-side="${side}"]`);
  if (!score) return;
  const next = value === null ? '—' : value.toLocaleString();
  if (score.textContent !== next) score.textContent = next;
}

function isLiveUnavailable(state: GrubState | undefined): boolean {
  if (!state || state.blue !== null || state.red !== null) return false;
  return state.gameState === 'live' || state.gameState === 'paused';
}

function setLiveUnavailable(card: HTMLElement, unavailable: boolean): void {
  if (card.dataset.availability === (unavailable ? 'live-unavailable' : 'scores')) return;
  card.dataset.availability = unavailable ? 'live-unavailable' : 'scores';
  card.querySelectorAll<HTMLElement>('strong > b, strong > i').forEach(element => {
    element.hidden = unavailable;
  });
  const message = card.querySelector<HTMLElement>('[data-grubs-live-unavailable]');
  if (message) message.hidden = !unavailable;
  if (unavailable) {
    card.title = LIVE_UNAVAILABLE_EXPLANATION;
    card.setAttribute('aria-label', `Grubs: ${LIVE_UNAVAILABLE_COPY}. ${LIVE_UNAVAILABLE_EXPLANATION}`);
  } else {
    card.removeAttribute('title');
    card.removeAttribute('aria-label');
  }
}

export function installGrubsObjective(root: HTMLElement): () => void {
  const values = new Map<string, GrubState>();
  let syncQueued = false;

  const remember = (snapshot: LiveSnapshot<LolStats>): void => {
    const state = stateFromSnapshot(snapshot);
    if (state) values.set(snapshot.game.id, state);
  };

  const sync = (): void => {
    const card = ensureCard(root);
    if (!card) return;
    const gameId = root.querySelector<HTMLElement>('#scoreboard')?.dataset.gameId ?? '';
    let state = gameId ? values.get(gameId) : undefined;
    if (!state && gameId) {
      const cached = readSnapshotCache(gameId);
      if (cached) {
        remember(cached);
        state = values.get(gameId);
      }
    }
    const unavailable = isLiveUnavailable(state);
    setLiveUnavailable(card, unavailable);
    if (!unavailable) {
      setScore(card, 'blue', state?.blue ?? null);
      setScore(card, 'red', state?.red ?? null);
    }
  };

  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      sync();
    });
  };

  const snapshotUpdated = (event: Event): void => {
    const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
    if (!snapshot?.game?.id) return;
    remember(snapshot);
    queueSync();
  };

  window.addEventListener(SNAPSHOT_UPDATED_EVENT, snapshotUpdated);
  const observer = new MutationObserver(queueSync);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-game-id']
  });
  queueSync();

  return () => {
    observer.disconnect();
    window.removeEventListener(SNAPSHOT_UPDATED_EVENT, snapshotUpdated);
  };
}
