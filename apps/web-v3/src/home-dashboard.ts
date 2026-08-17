type HomeSection = 'live' | 'upcoming' | 'recent';

const HOME_LIMITS: Record<HomeSection, number> = {
  live: 6,
  upcoming: 6,
  recent: 4
};

const FILTER_LABELS: Record<string, string> = {
  all: 'Home',
  live: 'Live',
  upcoming: 'Upcoming',
  ended: 'Results'
};

function sectionForCard(card: HTMLElement): HomeSection {
  const state = card.dataset.seriesState;
  if (state === 'live' || state === 'paused') return 'live';
  if (state === 'completed') return 'recent';
  return 'upcoming';
}

function sectionCopy(section: HomeSection, total: number): {
  eyebrow: string;
  title: string;
  copy: string;
  action: string;
  filter: string;
} {
  if (section === 'live') {
    return {
      eyebrow: 'LIVE NOW',
      title: total ? `${total} match${total === 1 ? '' : 'es'} in progress` : 'No matches live right now',
      copy: total ? 'Jump straight into the matches that are happening now.' : 'Up next is ready below when the next series begins.',
      action: 'View live',
      filter: 'live'
    };
  }
  if (section === 'upcoming') {
    return {
      eyebrow: 'UP NEXT',
      title: total ? 'Upcoming matches' : 'No upcoming matches',
      copy: total > HOME_LIMITS.upcoming ? `Showing the next ${HOME_LIMITS.upcoming} of ${total}.` : 'The next scheduled series, ordered by start time.',
      action: 'Full schedule',
      filter: 'upcoming'
    };
  }
  return {
    eyebrow: 'RECENT',
    title: total ? 'Latest results' : 'No recent results',
    copy: total > HOME_LIMITS.recent ? `The latest ${HOME_LIMITS.recent} finals, with the archive one tap away.` : 'Recently completed series.',
    action: 'All results',
    filter: 'ended'
  };
}

function buildSection(section: HomeSection, cards: readonly HTMLElement[]): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.className = `catalogue-section catalogue-section-${section}`;
  wrapper.dataset.homeSection = section;

  const header = document.createElement('header');
  header.className = 'catalogue-section-header';
  const heading = document.createElement('div');
  const copy = sectionCopy(section, cards.length);
  const eyebrow = document.createElement('span');
  eyebrow.textContent = copy.eyebrow;
  const title = document.createElement('strong');
  title.textContent = copy.title;
  const description = document.createElement('small');
  description.textContent = copy.copy;
  heading.append(eyebrow, title, description);

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'catalogue-section-action';
  action.dataset.homeFilter = copy.filter;
  action.textContent = copy.action;
  header.append(heading, action);
  wrapper.append(header);

  const grid = document.createElement('div');
  grid.className = 'catalogue-section-grid';
  const visibleCards = cards.slice(0, HOME_LIMITS[section]);
  visibleCards.forEach(card => grid.append(card));

  if (!visibleCards.length) {
    const empty = document.createElement('div');
    empty.className = 'catalogue-section-empty';
    empty.textContent = section === 'live'
      ? 'Nothing is live at the moment.'
      : section === 'upcoming'
        ? 'No scheduled matches are available.'
        : 'No recent finals are available.';
    grid.append(empty);
  }
  wrapper.append(grid);
  return wrapper;
}

export function installHomeDashboard(root: ParentNode): () => void {
  const panel = root.querySelector<HTMLElement>('#catalogue-panel');
  const grid = root.querySelector<HTMLElement>('#catalogue-grid');
  const meta = root.querySelector<HTMLElement>('#catalogue-meta');
  const heading = panel?.querySelector<HTMLElement>('.catalogue-header h1');
  const filters = panel?.querySelector<HTMLElement>('.match-filters');
  if (!panel || !grid || !filters) return () => undefined;

  if (heading) heading.textContent = 'Match center';
  filters.querySelectorAll<HTMLElement>('[data-match-filter]').forEach(button => {
    const label = FILTER_LABELS[button.dataset.matchFilter ?? ''];
    if (label) button.textContent = label;
  });

  let syncQueued = false;
  const sync = (): void => {
    syncQueued = false;
    const activeFilter = filters.querySelector<HTMLElement>('[data-match-filter].active')?.dataset.matchFilter ?? 'all';
    const existingDashboard = grid.querySelector<HTMLElement>(':scope > [data-home-dashboard]');

    if (activeFilter !== 'all') {
      panel.dataset.homeDashboardActive = 'false';
      return;
    }
    panel.dataset.homeDashboardActive = 'true';
    if (existingDashboard) return;

    const cards = [...grid.querySelectorAll<HTMLElement>(':scope > .match-card')];
    if (!cards.length) return;

    const grouped: Record<HomeSection, HTMLElement[]> = {
      live: [],
      upcoming: [],
      recent: []
    };
    cards.forEach(card => grouped[sectionForCard(card)].push(card));

    const dashboard = document.createElement('div');
    dashboard.className = 'catalogue-home-dashboard';
    dashboard.dataset.homeDashboard = 'true';
    dashboard.append(
      buildSection('live', grouped.live),
      buildSection('upcoming', grouped.upcoming),
      buildSection('recent', grouped.recent)
    );

    const displayed = Object.entries(grouped).reduce((total, [section, entries]) => (
      total + Math.min(entries.length, HOME_LIMITS[section as HomeSection])
    ), 0);
    grid.replaceChildren(dashboard);
    if (meta) meta.textContent = `${cards.length} matches · ${displayed} shown`;
  };

  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  const observer = new MutationObserver(queueSync);
  observer.observe(grid, { childList: true });
  const handleFilter = (): void => queueSync();
  const handleHomeAction = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    const filter = target?.closest<HTMLElement>('[data-home-filter]')?.dataset.homeFilter;
    if (!filter) return;
    filters.querySelector<HTMLButtonElement>(`[data-match-filter="${filter}"]`)?.click();
  };
  filters.addEventListener('click', handleFilter);
  grid.addEventListener('click', handleHomeAction);
  queueSync();

  return () => {
    observer.disconnect();
    filters.removeEventListener('click', handleFilter);
    grid.removeEventListener('click', handleHomeAction);
    delete panel.dataset.homeDashboardActive;
  };
}
