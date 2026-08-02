import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const style = document.createElement('style');
style.textContent = `
  .completed-final-game-header.live-match-clock-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
  }
  .completed-final-game-header.live-match-clock-header > strong {
    grid-column: 1;
    justify-self: start;
  }
  .completed-final-game-header .live-match-clock-group {
    display: flex;
    grid-column: 2;
    align-items: center;
    justify-content: center;
    justify-self: center;
    gap: 7px;
    min-width: 0;
    color: #8fa0b7;
    font-size: 0.62rem;
    white-space: nowrap;
  }
  .completed-final-game-header .live-match-clock-group::before {
    content: 'GAME TIME';
    color: #708198;
    font-size: 0.48rem;
    font-weight: 900;
    letter-spacing: 0.08em;
  }
  .completed-final-game-header #live-game-clock.live-match-clock {
    min-width: 54px;
    color: #f8fafc;
    font-size: 1.08rem;
    font-weight: 950;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.015em;
    line-height: 1;
    text-align: center;
  }
  @media (max-width: 620px) {
    .completed-final-game-header .live-match-clock-group::before { display: none; }
    .completed-final-game-header #live-game-clock.live-match-clock {
      min-width: 48px;
      font-size: 0.94rem;
    }
  }
`;
document.head.append(style);

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function renderSnapshotClock(snapshot: LiveSnapshot<LolStats>): void {
  const seconds = snapshot.stats?.gameClockSeconds ?? null;

  // The history-style renderer handles the same event and replaces the main panel.
  // Wait until all synchronous snapshot listeners have run before decorating its clock.
  queueMicrotask(() => {
    const element = document.querySelector<HTMLElement>('#live-game-clock');
    if (!element) return;
    const header = element.closest<HTMLElement>('.completed-final-game-header');
    header?.classList.add('live-match-clock-header');
    element.classList.add('live-match-clock');
    element.parentElement?.classList.add('live-match-clock-group');
    element.textContent = formatClock(seconds);
    element.setAttribute('aria-label', `Game time at latest snapshot ${element.textContent}`);
  });
}

window.addEventListener('esports-live:snapshot', event => {
  renderSnapshotClock((event as CustomEvent<LiveSnapshot<LolStats>>).detail);
});
