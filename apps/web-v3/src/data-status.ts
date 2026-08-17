import { scheduleMetadataUpdatedAt } from './schedule-metadata.ts';

function isV2BaselinePath(pathname = window.location.pathname): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

function elapsedCopy(timestamp: number): string {
  if (!timestamp) return 'just now';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

function makeStatus(): HTMLElement {
  const status = document.createElement('small');
  status.className = 'arena-data-status';
  status.dataset.mode = 'connecting';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const dot = document.createElement('i');
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = 'Connecting…';
  status.append(dot, text);
  return status;
}

export function installDataStatus(root: ParentNode): () => void {
  if (isV2BaselinePath()) return () => undefined;
  const connection = root.querySelector<HTMLElement>('.connection-pill');
  const catalogueCopy = root.querySelector<HTMLElement>('.catalogue-header > div');
  const detailCopy = root.querySelector<HTMLElement>('.detail-header > div');
  const grid = root.querySelector<HTMLElement>('#catalogue-grid');
  const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
  const matchPanel = root.querySelector<HTMLElement>('#match-panel');
  if (!connection || !catalogueCopy || !detailCopy || !grid || !scoreboard || !matchPanel) return () => undefined;

  const catalogueStatus = makeStatus();
  const detailStatus = makeStatus();
  catalogueCopy.append(catalogueStatus);
  detailCopy.append(detailStatus);

  let catalogueUpdatedAt = scheduleMetadataUpdatedAt() || Date.now();
  let matchUpdatedAt = Date.now();
  let forcedOffline = false;

  const set = (element: HTMLElement, mode: string, text: string): void => {
    element.dataset.mode = mode;
    const copy = element.querySelector<HTMLElement>('span');
    if (copy && copy.textContent !== text) copy.textContent = text;
  };

  const sync = (): void => {
    const connectionState = connection.dataset.status ?? 'connecting';
    const offline = forcedOffline || !navigator.onLine || connectionState === 'offline';
    if (offline) {
      set(catalogueStatus, 'offline', 'Offline • showing saved data');
      set(detailStatus, 'offline', 'Offline • showing saved data');
      return;
    }
    if (connectionState !== 'online') {
      set(catalogueStatus, 'connecting', 'Reconnecting…');
      set(detailStatus, 'connecting', 'Reconnecting…');
      return;
    }

    set(catalogueStatus, 'live', `Live data • schedule updated ${elapsedCopy(scheduleMetadataUpdatedAt() || catalogueUpdatedAt)}`);
    const gameState = scoreboard.dataset.gameState ?? '';
    const quality = root.querySelector<HTMLElement>('#quality-text')?.dataset.status ?? '';
    if (quality === 'final' || gameState === 'completed') {
      set(detailStatus, 'final', 'Final • saved for offline');
    } else if (gameState === 'live' || gameState === 'draft' || gameState === 'paused') {
      set(detailStatus, 'live', `Live • stats updated ${elapsedCopy(matchUpdatedAt)}`);
    } else {
      set(detailStatus, 'live', 'Connected • waiting for telemetry');
    }
  };

  const onOnline = (): void => {
    forcedOffline = false;
    sync();
  };
  const onOffline = (): void => {
    forcedOffline = true;
    sync();
  };
  const onSchedule = (): void => {
    catalogueUpdatedAt = Date.now();
    sync();
  };

  const connectionObserver = new MutationObserver(sync);
  connectionObserver.observe(connection, { attributes: true, attributeFilter: ['data-status'] });
  const catalogueObserver = new MutationObserver(() => {
    catalogueUpdatedAt = Date.now();
    sync();
  });
  catalogueObserver.observe(grid, { childList: true, subtree: true });
  const matchObserver = new MutationObserver(() => {
    matchUpdatedAt = Date.now();
    sync();
  });
  matchObserver.observe(scoreboard, { childList: true, subtree: true, characterData: true });
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('arena:v3-schedule-metadata', onSchedule);
  const timer = window.setInterval(sync, 1_000);
  sync();

  return () => {
    connectionObserver.disconnect();
    catalogueObserver.disconnect();
    matchObserver.disconnect();
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('arena:v3-schedule-metadata', onSchedule);
    window.clearInterval(timer);
    catalogueStatus.remove();
    detailStatus.remove();
  };
}
