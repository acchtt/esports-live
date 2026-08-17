import { metadataForSeries } from './schedule-metadata.ts';

const DAY_MS = 86_400_000;
const COUNTDOWN_REFRESH_MS = 30_000;

function isV2BaselinePath(pathname = window.location.pathname): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

function activeFilter(filters: HTMLElement): string {
  return filters.querySelector<HTMLElement>('[data-match-filter].active')?.dataset.matchFilter ?? 'all';
}

function localDateKey(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Schedule';
  const today = new Date();
  const todayKey = localDateKey(today.toISOString());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const key = localDateKey(value);
  if (key === todayKey) return 'Today';
  if (key === localDateKey(tomorrow.toISOString())) return 'Tomorrow';
  return date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function countdownCopy(value: string): string {
  const start = new Date(value).getTime();
  if (!Number.isFinite(start)) return 'Time pending';
  const delta = start - Date.now();
  if (delta <= 0 && delta > -30 * 60_000) return 'Starting now';
  if (delta <= 0) return 'Scheduled';
  const minutes = Math.max(1, Math.ceil(delta / 60_000));
  if (minutes < 60) return `Starts in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return `Starts in ${hours}h${remainder ? ` ${remainder}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `Starts in ${days}d ${hours % 24}h`;
}

function utcCalendarTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function downloadCalendar(seriesId: string): void {
  const metadata = metadataForSeries(seriesId);
  if (!metadata) return;
  const start = new Date(metadata.scheduledStart);
  if (!Number.isFinite(start.getTime())) return;
  const durationHours = metadata.bestOf >= 5 ? 5 : metadata.bestOf >= 3 ? 3 : 2;
  const end = new Date(start.getTime() + durationHours * 60 * 60_000);
  const matchup = `${metadata.teams[0].name} vs ${metadata.teams[1].name}`;
  const description = `${metadata.competition || 'League of Legends'} · Best of ${metadata.bestOf}`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ARENA//Esports Live//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcs(seriesId)}@arena.esports-live`,
    `DTSTAMP:${utcCalendarTime(new Date())}`,
    `DTSTART:${utcCalendarTime(start)}`,
    `DTEND:${utcCalendarTime(end)}`,
    `SUMMARY:${escapeIcs(matchup)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${metadata.teams[0].code || metadata.teams[0].name}-${metadata.teams[1].code || metadata.teams[1].name}.ics`
    .replace(/[^a-z0-9_.-]+/gi, '-');
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function directCards(grid: HTMLElement): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>(':scope > .match-card')];
}

function groupedCards(grid: HTMLElement): HTMLElement[] {
  return [...grid.querySelectorAll<HTMLElement>(':scope > .catalogue-date-group .match-card')];
}

function createScheduleAccessory(card: HTMLElement): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'scheduled-card-shell';
  const accessory = document.createElement('div');
  accessory.className = 'scheduled-card-accessory';
  const countdown = document.createElement('span');
  countdown.className = 'match-countdown';
  const calendar = document.createElement('button');
  calendar.type = 'button';
  calendar.className = 'calendar-action';
  calendar.dataset.calendarSeries = card.dataset.seriesId ?? '';
  calendar.textContent = '+ Calendar';
  calendar.setAttribute('aria-label', 'Add this match to calendar');
  const metadata = metadataForSeries(card.dataset.seriesId ?? '');
  countdown.textContent = metadata ? countdownCopy(metadata.scheduledStart) : 'Time pending';
  calendar.disabled = !metadata;
  accessory.append(countdown, calendar);
  shell.append(card, accessory);
  return shell;
}

function updateGroupedSchedule(grid: HTMLElement): void {
  grid.querySelectorAll<HTMLElement>('.catalogue-date-group').forEach(group => {
    const cards = [...group.querySelectorAll<HTMLElement>('.match-card')];
    group.hidden = cards.length > 0 && !cards.some(card => !card.hidden);
    cards.forEach(card => {
      const shell = card.closest<HTMLElement>('.scheduled-card-shell');
      const countdown = shell?.querySelector<HTMLElement>('.match-countdown');
      const calendar = shell?.querySelector<HTMLButtonElement>('.calendar-action');
      const metadata = metadataForSeries(card.dataset.seriesId ?? '');
      if (countdown) countdown.textContent = metadata ? countdownCopy(metadata.scheduledStart) : 'Time pending';
      if (calendar) calendar.disabled = !metadata;
    });
  });
}

function groupUpcoming(grid: HTMLElement): void {
  const cards = directCards(grid);
  if (!cards.length) {
    updateGroupedSchedule(grid);
    return;
  }

  const groups = new Map<string, { label: string; start: number; cards: HTMLElement[] }>();
  cards.forEach(card => {
    const metadata = metadataForSeries(card.dataset.seriesId ?? '');
    const start = metadata ? new Date(metadata.scheduledStart).getTime() : Number.POSITIVE_INFINITY;
    const key = metadata ? localDateKey(metadata.scheduledStart) ?? 'unknown' : 'unknown';
    const group = groups.get(key) ?? {
      label: metadata ? localDateLabel(metadata.scheduledStart) : 'Schedule',
      start,
      cards: []
    };
    group.cards.push(card);
    group.start = Math.min(group.start, start);
    groups.set(key, group);
  });

  const fragment = document.createDocumentFragment();
  [...groups.values()]
    .sort((left, right) => left.start - right.start)
    .forEach(group => {
      const section = document.createElement('section');
      section.className = 'catalogue-date-group';
      section.dataset.scheduleGroup = 'true';
      const header = document.createElement('header');
      const title = document.createElement('strong');
      const count = document.createElement('span');
      title.textContent = group.label;
      count.textContent = `${group.cards.length} match${group.cards.length === 1 ? '' : 'es'}`;
      header.append(title, count);
      const list = document.createElement('div');
      list.className = 'catalogue-date-list';
      group.cards.forEach(card => list.append(createScheduleAccessory(card)));
      section.append(header, list);
      fragment.append(section);
    });
  grid.replaceChildren(fragment);
  updateGroupedSchedule(grid);
}

function createResultsTools(pills: HTMLElement): HTMLElement {
  const toolbar = document.createElement('section');
  toolbar.className = 'results-tools';
  toolbar.hidden = true;
  toolbar.setAttribute('aria-label', 'Results search and date filters');

  const search = document.createElement('label');
  search.className = 'results-search';
  const searchLabel = document.createElement('span');
  searchLabel.textContent = 'Search teams';
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'T1, Gen.G, Fnatic…';
  input.autocomplete = 'off';
  input.dataset.resultsSearch = 'true';
  search.append(searchLabel, input);

  const date = document.createElement('label');
  date.className = 'results-date-filter';
  const dateLabel = document.createElement('span');
  dateLabel.textContent = 'Date';
  const select = document.createElement('select');
  select.dataset.resultsDays = 'true';
  const dateOptions: readonly (readonly [string, string])[] = [
    ['all', 'All time'],
    ['7', 'Last 7 days'],
    ['30', 'Last 30 days'],
    ['90', 'Last 90 days']
  ];
  dateOptions.forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
  date.append(dateLabel, select);

  const summary = document.createElement('span');
  summary.className = 'results-filter-summary';
  summary.dataset.resultsSummary = 'true';
  summary.textContent = 'All results';
  toolbar.append(search, date, summary);
  pills.after(toolbar);
  return toolbar;
}

export function installCatalogueExperience(root: ParentNode): () => void {
  if (isV2BaselinePath()) return () => undefined;
  const filters = root.querySelector<HTMLElement>('.match-filters');
  const pills = root.querySelector<HTMLElement>('.catalogue-filter-pills');
  const grid = root.querySelector<HTMLElement>('#catalogue-grid');
  if (!filters || !pills || !grid) return () => undefined;

  document.documentElement.dataset.arenaV3Enhanced = 'true';
  const resultsTools = createResultsTools(pills);
  const search = resultsTools.querySelector<HTMLInputElement>('[data-results-search]')!;
  const dateSelect = resultsTools.querySelector<HTMLSelectElement>('[data-results-days]')!;
  const summary = resultsTools.querySelector<HTMLElement>('[data-results-summary]')!;
  let syncQueued = false;

  const syncResults = (): void => {
    const active = activeFilter(filters) === 'ended';
    resultsTools.hidden = !active;
    if (!active) {
      grid.querySelectorAll<HTMLElement>('.match-card[data-results-match]').forEach(card => {
        delete card.dataset.resultsMatch;
      });
      return;
    }

    const query = search.value.trim().toLowerCase();
    const days = dateSelect.value === 'all' ? null : Number(dateSelect.value);
    const cutoff = days ? Date.now() - days * DAY_MS : null;
    let matching = 0;
    let visible = 0;
    const cards = [...grid.querySelectorAll<HTMLElement>('.match-card')];
    cards.forEach(card => {
      const metadata = metadataForSeries(card.dataset.seriesId ?? '');
      const timestamp = metadata ? new Date(metadata.scheduledStart).getTime() : NaN;
      const textMatches = !query || (card.textContent ?? '').toLowerCase().includes(query);
      const dateMatches = cutoff === null || (Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= Date.now() + DAY_MS);
      const matches = textMatches && dateMatches;
      card.dataset.resultsMatch = String(matches);
      if (matches) matching += 1;
      if (matches && !card.hidden) visible += 1;
    });
    summary.textContent = visible === matching
      ? `${matching} result${matching === 1 ? '' : 's'}`
      : `${visible} of ${matching} results in selected leagues`;
  };

  const sync = (): void => {
    syncQueued = false;
    const filter = activeFilter(filters);
    if (filter === 'upcoming') groupUpcoming(grid);
    else if (groupedCards(grid).length) {
      // Core normally replaces the grouped schedule when the status tab changes.
      // If a late metadata event arrives first, leave the current DOM alone until that render.
      updateGroupedSchedule(grid);
    }
    syncResults();
  };

  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  const onClick = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const calendar = target?.closest<HTMLButtonElement>('[data-calendar-series]');
    if (calendar?.dataset.calendarSeries) {
      event.preventDefault();
      event.stopPropagation();
      downloadCalendar(calendar.dataset.calendarSeries);
      return;
    }
    if (target?.closest('[data-match-filter], [data-league-filter]')) queueSync();
  };

  const onInput = (): void => syncResults();
  const onMetadata = (): void => {
    if (activeFilter(filters) === 'upcoming') {
      const unknown = [...grid.querySelectorAll<HTMLElement>('.catalogue-date-group .match-card')]
        .some(card => metadataForSeries(card.dataset.seriesId ?? '') && card.closest('.catalogue-date-group')?.querySelector('header strong')?.textContent === 'Schedule');
      if (unknown) {
        const cards = groupedCards(grid);
        grid.replaceChildren(...cards);
      }
    }
    queueSync();
  };

  const observer = new MutationObserver(queueSync);
  observer.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  root.addEventListener('click', onClick);
  search.addEventListener('input', onInput);
  dateSelect.addEventListener('change', onInput);
  window.addEventListener('arena:v3-schedule-metadata', onMetadata);
  const interval = window.setInterval(() => {
    if (activeFilter(filters) === 'upcoming') updateGroupedSchedule(grid);
  }, COUNTDOWN_REFRESH_MS);
  queueSync();

  return () => {
    observer.disconnect();
    root.removeEventListener('click', onClick);
    search.removeEventListener('input', onInput);
    dateSelect.removeEventListener('change', onInput);
    window.removeEventListener('arena:v3-schedule-metadata', onMetadata);
    window.clearInterval(interval);
    resultsTools.remove();
  };
}
