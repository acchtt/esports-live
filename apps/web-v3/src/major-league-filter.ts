const MINOR_LEAGUE_MARKERS = [
  'challenger',
  'challengers',
  'academy',
  'development',
  'developmental',
  'division 2',
  'tier 2'
] as const;

const LEAGUE_FILTERS = [
  { id: 'lck', label: 'LCK' },
  { id: 'lpl', label: 'LPL' },
  { id: 'lec', label: 'LEC' },
  { id: 'lcs', label: 'LCS' }
] as const;

const LEAGUE_META_SUFFIX = / · (?:LCK|LPL|LEC|LCS)(?: \+ (?:LCK|LPL|LEC|LCS))*$/;

type LeagueFilter = typeof LEAGUE_FILTERS[number]['id'];

function normalizedCompetitionName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function leagueForCompetition(value: string): LeagueFilter | null {
  const name = normalizedCompetitionName(value);
  if (!name) return null;
  if (MINOR_LEAGUE_MARKERS.some(marker => name.includes(marker))) return null;
  if (/^lck\s+cl(?:\s|$)/.test(name)) return null;

  if (/^lck(?:\s|$)/.test(name) || name.includes('league of legends champions korea')) return 'lck';
  if (/^lpl(?:\s|$)/.test(name) || name.includes('league of legends pro league')) return 'lpl';
  if (/^lec(?:\s|$)/.test(name) || name.includes('league of legends emea championship')) return 'lec';

  if (/^lcs(?:\s|$)/.test(name)
    || name === 'league championship series'
    || /^lta(?:\s+(?:north|south))?(?:\s|$)/.test(name)
    || name.includes('league of legends championship of the americas')
    || name.includes('league of the americas')) {
    return 'lcs';
  }

  return null;
}

function competitionName(card: HTMLElement): string {
  return card.querySelector<HTMLElement>('.match-card-top small')?.textContent ?? '';
}

function baseCatalogueMeta(value: string): string | null {
  return value.match(/^(\d+ matches · \d+ shown)(?: · .+)?$/)?.[1] ?? null;
}

function hasLeagueMetaSuffix(value: string): boolean {
  return LEAGUE_META_SUFFIX.test(value);
}

export function installLeagueFilters(root: ParentNode): () => void {
  const statusFilters = root.querySelector<HTMLElement>('.match-filters');
  const grid = root.querySelector<HTMLElement>('#catalogue-grid');
  const meta = root.querySelector<HTMLElement>('#catalogue-meta');
  if (!statusFilters || !grid) return () => undefined;

  root.querySelectorAll<HTMLElement>('[data-major-leagues-filter]').forEach(element => element.remove());

  let pills = root.querySelector<HTMLElement>('.catalogue-filter-pills');
  if (!pills) {
    pills = document.createElement('div');
    pills.className = 'catalogue-filter-pills';
    pills.setAttribute('role', 'group');
    pills.setAttribute('aria-label', 'League filters');
    statusFilters.after(pills);
  }

  const buttons = new Map<LeagueFilter, HTMLButtonElement>();
  LEAGUE_FILTERS.forEach(({ id, label }) => {
    let button = pills?.querySelector<HTMLButtonElement>(`[data-league-filter="${id}"]`) ?? null;
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-pill';
      button.dataset.leagueFilter = id;
      button.textContent = label;
      button.setAttribute('aria-label', `Filter matches by ${label}`);
      button.setAttribute('aria-pressed', 'false');
      pills?.append(button);
    }
    buttons.set(id, button);
  });

  const selected = new Set<LeagueFilter>();
  let syncQueued = false;
  let baseMetaText = baseCatalogueMeta(meta?.textContent ?? '') ?? meta?.textContent ?? '';

  const sync = (): void => {
    syncQueued = false;
    const currentMetaText = meta?.textContent ?? '';
    const currentBase = baseCatalogueMeta(currentMetaText);
    if (currentBase && !hasLeagueMetaSuffix(currentMetaText)) baseMetaText = currentBase;

    const cards = [...grid.querySelectorAll<HTMLElement>('.match-card')];
    let shown = 0;

    cards.forEach(card => {
      const league = leagueForCompetition(competitionName(card));
      const visible = selected.size === 0 || (league !== null && selected.has(league));
      card.hidden = !visible;
      if (visible) {
        card.removeAttribute('aria-hidden');
        shown += 1;
      } else {
        card.setAttribute('aria-hidden', 'true');
      }
    });

    const empty = grid.querySelector<HTMLElement>('[data-league-filters-empty]');
    const needsEmpty = selected.size > 0 && cards.length > 0 && shown === 0;
    if (!needsEmpty) {
      empty?.remove();
    } else if (!empty) {
      const nextEmpty = document.createElement('div');
      nextEmpty.className = 'catalogue-empty';
      nextEmpty.dataset.leagueFiltersEmpty = 'true';
      const title = document.createElement('strong');
      title.textContent = 'No matches for the selected leagues';
      const copy = document.createElement('span');
      copy.textContent = 'Try another status filter or clear the league filters.';
      nextEmpty.append(title, copy);
      grid.append(nextEmpty);
    }

    if (meta) {
      const counts = baseCatalogueMeta(baseMetaText);
      if (selected.size > 0 && counts) {
        const selectedLabels = LEAGUE_FILTERS
          .filter(({ id }) => selected.has(id))
          .map(({ label }) => label)
          .join(' + ');
        const total = counts.match(/^(\d+) matches/)?.[1] ?? String(cards.length);
        meta.textContent = `${total} matches · ${shown} shown · ${selectedLabels}`;
      } else if (selected.size === 0 && counts) {
        meta.textContent = counts;
      }
    }
  };

  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  const removers: Array<() => void> = [];
  buttons.forEach((button, league) => {
    const toggle = (): void => {
      if (selected.has(league)) selected.delete(league);
      else selected.add(league);
      button.classList.toggle('selected', selected.has(league));
      button.setAttribute('aria-pressed', String(selected.has(league)));
      queueSync();
    };
    button.addEventListener('click', toggle);
    removers.push(() => button.removeEventListener('click', toggle));
  });

  const observer = new MutationObserver(queueSync);
  observer.observe(grid, { childList: true });
  sync();

  return () => {
    observer.disconnect();
    removers.forEach(remove => remove());
  };
}
