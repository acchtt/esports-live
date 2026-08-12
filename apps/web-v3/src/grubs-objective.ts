import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { readSnapshotCache, SNAPSHOT_UPDATED_EVENT } from './snapshot-cache.ts';

type Side = 'blue' | 'red';

interface GrubState {
  blue: number | null;
  red: number | null;
}

function normalizedCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stateFromSnapshot(snapshot: LiveSnapshot<LolStats>): GrubState | null {
  if (!snapshot.stats) return null;
  return {
    blue: normalizedCount(snapshot.stats.blue.objectives.grubs),
    red: normalizedCount(snapshot.stats.red.objectives.grubs)
  };
}

function hasCompleteCounts(state: GrubState | undefined): state is { blue: number; red: number } {
  return state?.blue !== null && state?.blue !== undefined
    && state.red !== null && state.red !== undefined;
}

function createScore(side: Side): HTMLElement {
  const score = document.createElement('b');
  score.dataset.side = side;
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
  scores.append(createScore('blue'), separator, createScore('red'));
  card.append(label, scores);

  const barons = grid.querySelector('[data-objective="barons"]');
  grid.insertBefore(card, barons);
  return card;
}

function removeCard(root: ParentNode): void {
  root.querySelector<HTMLElement>('[data-objective="grubs"]')?.remove();
}

function setScore(card: ParentNode, side: Side, value: number): void {
  const score = card.querySelector<HTMLElement>(`[data-side="${side}"]`);
  if (!score) return;
  const next = value.toLocaleString();
  if (score.textContent !== next) score.textContent = next;
}

export function installGrubsObjective(root: HTMLElement): () => void {
  const values = new Map<string, GrubState>();
  let syncQueued = false;

  const remember = (snapshot: LiveSnapshot<LolStats>): void => {
    const state = stateFromSnapshot(snapshot);
    if (state) values.set(snapshot.game.id, state);
  };

  const sync = (): void => {
    const gameId = root.querySelector<HTMLElement>('#scoreboard')?.dataset.gameId ?? '';
    let state = gameId ? values.get(gameId) : undefined;
    if (!state && gameId) {
      const cached = readSnapshotCache(gameId);
      if (cached) {
        remember(cached);
        state = values.get(gameId);
      }
    }

    if (!hasCompleteCounts(state)) {
      removeCard(root);
      return;
    }

    const card = ensureCard(root);
    if (!card) return;
    setScore(card, 'blue', state.blue);
    setScore(card, 'red', state.red);
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
