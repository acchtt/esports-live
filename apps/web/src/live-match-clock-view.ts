import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const style = document.createElement('style');
style.textContent = `
  .completed-final-game-header.live-match-clock-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    column-gap: 16px;
  }
  .completed-final-game-header.live-match-clock-header > strong {
    grid-column: 1;
    justify-self: start;
  }
  .completed-final-game-header .live-match-clock-group {
    display: grid;
    grid-column: 2;
    place-items: center;
    justify-self: center;
    gap: 4px;
    min-width: 76px;
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
    min-width: 58px;
    color: #f8fafc;
    font-size: 1.12rem;
    font-weight: 950;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.015em;
    line-height: 1;
    text-align: center;
  }
  .completed-final-game-header .live-match-clock-patch {
    grid-column: 3;
    justify-self: end;
    color: #8fa0b7;
    font-size: 0.62rem;
    white-space: nowrap;
  }
  @media (max-width: 620px) {
    .completed-final-game-header.live-match-clock-header {
      column-gap: 8px;
    }
    .completed-final-game-header .live-match-clock-group {
      min-width: 58px;
    }
    .completed-final-game-header .live-match-clock-group::before {
      font-size: 0.42rem;
    }
    .completed-final-game-header #live-game-clock.live-match-clock {
      min-width: 48px;
      font-size: 0.96rem;
    }
    .completed-final-game-header .live-match-clock-patch {
      max-width: 82px;
      overflow: hidden;
      font-size: 0.54rem;
      text-overflow: ellipsis;
    }
  }
`;
document.head.append(style);

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function patchTextFromGroup(group: HTMLElement, clock: HTMLElement): string {
  return Array.from(group.childNodes)
    .filter(node => node !== clock)
    .map(node => node.textContent ?? '')
    .join(' ')
    .replace(/^[\s·]+/, '')
    .trim();
}

function centerClock(element: HTMLElement): void {
  const group = element.parentElement;
  const header = element.closest<HTMLElement>('.completed-final-game-header');
  if (!group || !header) return;

  const patchText = patchTextFromGroup(group, element);
  group.replaceChildren(element);
  group.classList.add('live-match-clock-group');
  header.classList.add('live-match-clock-header');
  element.classList.add('live-match-clock');

  let patch = header.querySelector<HTMLElement>('.live-match-clock-patch');
  if (!patch) {
    patch = document.createElement('span');
    patch.className = 'live-match-clock-patch';
    header.append(patch);
  }
  if (patchText) patch.textContent = patchText;
  if (!patch.textContent?.trim()) patch.textContent = 'Patch unavailable';
}

function renderSnapshotClock(snapshot: LiveSnapshot<LolStats>): void {
  const seconds = snapshot.stats?.gameClockSeconds ?? null;

  // The history-style renderer handles the same event and replaces the main panel.
  // Wait until all synchronous snapshot listeners have run before decorating its clock.
  queueMicrotask(() => {
    const element = document.querySelector<HTMLElement>('#live-game-clock');
    if (!element) return;
    centerClock(element);
    element.textContent = formatClock(seconds);
    element.setAttribute('aria-label', `Game time at latest snapshot ${element.textContent}`);
  });
}

window.addEventListener('esports-live:snapshot', event => {
  renderSnapshotClock((event as CustomEvent<LiveSnapshot<LolStats>>).detail);
});
