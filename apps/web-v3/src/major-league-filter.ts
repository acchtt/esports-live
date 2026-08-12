const MINOR_LEAGUE_MARKERS = [
  'challenger',
  'challengers',
  'academy',
  'development',
  'developmental',
  'division 2',
  'tier 2'
] as const;

function normalizedCompetitionName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function isMajorLeagueCompetition(value: string): boolean {
  const name = normalizedCompetitionName(value);
  if (!name) return false;
  if (MINOR_LEAGUE_MARKERS.some(marker => name.includes(marker))) return false;

  if (/^(lpl|lck|lec|lcs|lcp)$/.test(name)) return true;
  if (/^lta(?: north| south)?$/.test(name)) return true;

  return name.includes('league of legends pro league')
    || name.includes('league of legends champions korea')
    || name.includes('league of legends emea championship')
    || name === 'league championship series'
    || name.includes('league of the americas')
    || name.includes('league of legends championship pacific');
}

function competitionName(card: HTMLElement): string {
  return card.querySelector<HTMLElement>('.match-card-top small')?.textContent ?? '';
}

export function installMajorLeagueFilter(root: ParentNode): () => void {
  const filters = root.querySelector<HTMLElement>('.match-filters');
  const grid = root.querySelector<HTMLElement>('#catalogue-grid');
  if (!filters || !grid) return () => undefined;

  let button = filters.querySelector<HTMLButtonElement>('[data-major-leagues-filter]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.majorLeaguesFilter = 'true';
    button.textContent = 'Majors';
    button.setAttribute('aria-label', 'Show major leagues only');
    button.setAttribute('aria-pressed', 'false');
    const allButton = filters.querySelector<HTMLElement>('[data-match-filter="all"]');
    allButton?.after(button);
    if (!button.isConnected) filters.prepend(button);
  }

  let majorOnly = false;
  let syncQueued = false;

  const sync = (): void => {
    syncQueued = false;
    const cards = [...grid.querySelectorAll<HTMLElement>('.match-card')];
    let shown = 0;

    cards.forEach(card => {
      const visible = !majorOnly || isMajorLeagueCompetition(competitionName(card));
      card.hidden = !visible;
      if (visible) {
        card.removeAttribute('aria-hidden');
        shown += 1;
      } else {
        card.setAttribute('aria-hidden', 'true');
      }
    });

    grid.querySelector<HTMLElement>('[data-major-leagues-empty]')?.remove();
    if (majorOnly && cards.length > 0 && shown === 0) {
      const empty = document.createElement('div');
      empty.className = 'catalogue-empty';
      empty.dataset.majorLeaguesEmpty = 'true';
      const title = document.createElement('strong');
      title.textContent = 'No major-league matches in this filter';
      const copy = document.createElement('span');
      copy.textContent = 'Try another status filter or turn Majors off.';
      empty.append(title, copy);
      grid.append(empty);
    }
  };

  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  const toggle = (): void => {
    majorOnly = !majorOnly;
    button?.classList.toggle('active', majorOnly);
    button?.setAttribute('aria-pressed', String(majorOnly));
    queueSync();
  };

  button.addEventListener('click', toggle);
  const observer = new MutationObserver(queueSync);
  observer.observe(grid, { childList: true });
  sync();

  return () => {
    observer.disconnect();
    button?.removeEventListener('click', toggle);
  };
}
