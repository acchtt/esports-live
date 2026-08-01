import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

let clockBaseSeconds: number | null = null;
let clockStartedAt = 0;
let clockAdvancing = false;
let clockTimer: number | null = null;

const style = document.createElement('style');
style.textContent = `
  .completed-final-game-header .live-match-clock-group {
    display: flex;
    align-items: center;
    justify-content: flex-end;
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
    text-align: right;
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

function stopClock(): void {
  if (clockTimer !== null) window.clearInterval(clockTimer);
  clockTimer = null;
  clockBaseSeconds = null;
  clockStartedAt = 0;
  clockAdvancing = false;
}

function displayedSeconds(): number | null {
  if (clockBaseSeconds === null) return null;
  if (!clockAdvancing) return clockBaseSeconds;
  const elapsed = Math.max(0, Math.floor((Date.now() - clockStartedAt) / 1_000));
  return clockBaseSeconds + elapsed;
}

function updateClock(): void {
  const element = document.querySelector<HTMLElement>('#live-game-clock');
  if (!element) return;
  element.classList.add('live-match-clock');
  element.parentElement?.classList.add('live-match-clock-group');
  element.textContent = formatClock(displayedSeconds());
  element.setAttribute('aria-label', `Game time ${element.textContent}`);
}

function startClock(snapshot: LiveSnapshot<LolStats>): void {
  stopClock();
  clockBaseSeconds = snapshot.stats?.gameClockSeconds ?? null;
  clockStartedAt = Date.now();
  clockAdvancing = snapshot.game.state === 'live' && snapshot.quality.advancing !== false;

  // The history-style renderer handles the same event and replaces the main panel.
  // Wait until all synchronous snapshot listeners have run before decorating its clock.
  queueMicrotask(updateClock);

  if (clockBaseSeconds !== null && clockAdvancing) {
    clockTimer = window.setInterval(updateClock, 250);
  }
}

window.addEventListener('esports-live:snapshot', event => {
  startClock((event as CustomEvent<LiveSnapshot<LolStats>>).detail);
});

window.addEventListener('beforeunload', stopClock);
