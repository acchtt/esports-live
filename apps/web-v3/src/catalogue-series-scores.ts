import type { SeriesContext, SeriesScoreRef } from '@esports-live/core';
import { loadSeriesContext } from './api.ts';

const LIVE_SCORE_CACHE_MS = 12_000;

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sideName(card: HTMLElement, index: number): string {
  return card.querySelectorAll<HTMLElement>('.match-card-teams > strong')[index]
    ?.querySelector<HTMLElement>(':scope > span')
    ?.textContent?.trim() ?? '';
}

function winsForSide(score: readonly SeriesScoreRef[], name: string, index: number): number {
  const key = normalized(name);
  const matched = score.find(entry => (
    normalized(entry.team.name) === key || normalized(entry.team.code) === key
  ));
  return matched?.wins ?? score[index]?.wins ?? 0;
}

function renderScore(card: HTMLElement, context: SeriesContext): void {
  const score = context.history?.score;
  if (!score?.length) return;
  const blueWins = winsForSide(score, sideName(card, 0), 0);
  const redWins = winsForSide(score, sideName(card, 1), 1);
  const label = card.querySelector<HTMLElement>('.match-series-score');
  if (!label) return;
  label.textContent = `${blueWins} – ${redWins}`;
  label.setAttribute('aria-label', `Series score ${blueWins} to ${redWins}`);
  card.dataset.seriesScoreReady = 'true';
  card.dataset.seriesScoreSource = 'context';
  card.dataset.seriesScoreLoadedAt = String(Date.now());
}

export function installCatalogueSeriesScores(root: HTMLElement): () => void {
  const tracked = new WeakSet<HTMLElement>();
  const visible = new Set<HTMLElement>();
  const inFlight = new Map<string, Promise<SeriesContext>>();
  let scanQueued = false;

  const load = (card: HTMLElement): void => {
    if (!card.isConnected || card.dataset.seriesScoreSource === 'schedule') return;
    const seriesId = card.dataset.seriesId?.trim() ?? '';
    const state = card.dataset.seriesState ?? 'unknown';
    if (!seriesId || (state !== 'live' && state !== 'paused' && state !== 'completed')) return;
    if (state === 'completed' && card.dataset.seriesScoreSource === 'context') return;
    const loadedAt = Number(card.dataset.seriesScoreLoadedAt ?? 0);
    if (Number.isFinite(loadedAt) && Date.now() - loadedAt < LIVE_SCORE_CACHE_MS) return;

    let request = inFlight.get(seriesId);
    if (!request) {
      request = loadSeriesContext(
        seriesId,
        undefined,
        state === 'live' || state === 'paused' ? LIVE_SCORE_CACHE_MS : Number.POSITIVE_INFINITY
      );
      inFlight.set(seriesId, request);
      void request.finally(() => {
        if (inFlight.get(seriesId) === request) inFlight.delete(seriesId);
      }).catch(() => undefined);
    }
    void request.then(context => {
      if (card.isConnected && context.seriesId === seriesId) renderScore(card, context);
    }).catch(() => undefined);
  };

  const intersection = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!(entry.target instanceof HTMLElement)) return;
          if (!entry.isIntersecting) {
            visible.delete(entry.target);
            return;
          }
          visible.add(entry.target);
          load(entry.target);
        });
      }, { rootMargin: '160px 0px' })
    : null;

  const scan = (): void => {
    root.querySelectorAll<HTMLElement>('.match-card[data-series-id]').forEach((card, index) => {
      if (tracked.has(card)) return;
      tracked.add(card);
      intersection?.observe(card);
      if (!intersection || index < 4) load(card);
    });
  };

  const queueScan = (): void => {
    if (scanQueued) return;
    scanQueued = true;
    queueMicrotask(() => {
      scanQueued = false;
      scan();
    });
  };

  const observer = new MutationObserver(queueScan);
  observer.observe(root, { childList: true, subtree: true });
  const refreshTimer = window.setInterval(() => {
    visible.forEach(card => {
      if (!card.isConnected) visible.delete(card);
      else load(card);
    });
  }, LIVE_SCORE_CACHE_MS);
  queueScan();

  return () => {
    observer.disconnect();
    intersection?.disconnect();
    window.clearInterval(refreshTimer);
    visible.clear();
    inFlight.clear();
  };
}
