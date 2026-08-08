import type { ScheduleEvent } from '@esports-live/core';

function updateScheduledLabel(selection: ScheduleEvent): void {
  if (selection.series.state !== 'scheduled') return;
  requestAnimationFrame(() => {
    const label = document.querySelector<HTMLElement>(
      '#series-hero .series-hero-live-context > span > span'
    );
    if (label) label.textContent = 'Awaiting game';
  });
}

window.addEventListener('esports-live:selection', event => {
  updateScheduledLabel((event as CustomEvent<ScheduleEvent>).detail);
});
