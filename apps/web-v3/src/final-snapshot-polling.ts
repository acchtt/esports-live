import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import { loadSnapshot } from './api.ts';
import { writeSnapshotCache } from './snapshot-cache.ts';

const FINAL_SNAPSHOT_POLL_MS = 2_000;
const RECOVERED_SNAPSHOT_EVENT = 'esports-live:v2-recovered-snapshot';

/**
 * Completed-game telemetry can continue settling after a provider/history feed has
 * already marked the game Final. Keep probing the selected Final game while the
 * detail view is visible so a premature finality flag cannot freeze an older frame.
 *
 * Final probes deliberately omit `after`; loadSnapshot will issue the existing
 * cache-busted full snapshot request and preserve the normal finality merge rules.
 */
export function installFinalSnapshotPolling(root: HTMLElement): () => void {
  let disposed = false;
  let controller: AbortController | null = null;

  const poll = async (): Promise<void> => {
    if (disposed || document.hidden || controller) return;

    const matchPanel = root.querySelector<HTMLElement>('#match-panel');
    const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
    const gameId = scoreboard?.dataset.gameId?.trim() ?? '';
    const final = scoreboard?.dataset.gameState === 'completed';
    if (matchPanel?.hidden !== false || !final || !gameId) return;

    const nextController = new AbortController();
    controller = nextController;

    try {
      const snapshot = await loadSnapshot(gameId, null, nextController.signal);
      if (disposed || nextController.signal.aborted) return;
      writeSnapshotCache(snapshot);
      window.dispatchEvent(new CustomEvent<LiveSnapshot<LolStats>>(
        RECOVERED_SNAPSHOT_EVENT,
        { detail: snapshot }
      ));
    } catch {
      // Final settling probes are opportunistic. The normal snapshot path owns
      // user-facing errors and the next interval will retry automatically.
    } finally {
      if (controller === nextController) controller = null;
    }
  };

  const timer = window.setInterval(() => void poll(), FINAL_SNAPSHOT_POLL_MS);
  const visibilityChanged = (): void => {
    if (document.hidden) {
      controller?.abort();
      controller = null;
      return;
    }
    void poll();
  };

  document.addEventListener('visibilitychange', visibilityChanged);

  return () => {
    disposed = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', visibilityChanged);
    controller?.abort();
    controller = null;
  };
}
