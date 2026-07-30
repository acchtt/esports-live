import './styles.css';

interface HealthResponse {
  ok: boolean;
  service: string;
  schemaVersion: string;
  adapters: string[];
}

interface EsportCard {
  id: string;
  name: string;
  description: string;
}

const esports: readonly EsportCard[] = [
  {
    id: 'lol',
    name: 'League of Legends',
    description: 'Series, games, teams, objectives, player state, and verified live telemetry.'
  },
  {
    id: 'cs2',
    name: 'Counter-Strike 2',
    description: 'Adapter boundary reserved for maps, rounds, economy, and player state.'
  },
  {
    id: 'dota2',
    name: 'Dota 2',
    description: 'Adapter boundary reserved for maps, net worth, objectives, and hero state.'
  }
];

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const statusHeading = requiredElement<HTMLElement>('#platform-status');
const statusBadge = requiredElement<HTMLElement>('#status-badge');
const grid = requiredElement<HTMLElement>('#esport-grid');

function renderCards(enabled: readonly string[]): void {
  grid.replaceChildren(...esports.map(esport => {
    const active = enabled.includes(esport.id);
    const card = document.createElement('article');
    card.className = `esport-card${active ? '' : ' disabled'}`;

    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = esport.id.toUpperCase();

    const title = document.createElement('h2');
    title.textContent = esport.name;

    const description = document.createElement('p');
    description.textContent = esport.description;

    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = active ? 'ADAPTER ENABLED' : 'PLANNED';

    card.append(eyebrow, title, description, state);
    return card;
  }));
}

async function connect(): Promise<void> {
  const apiBase = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

  try {
    const response = await fetch(`${apiBase}/health`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const health = await response.json() as HealthResponse;

    statusHeading.textContent = health.ok ? 'API connected' : 'API degraded';
    statusBadge.textContent = health.ok ? `SCHEMA ${health.schemaVersion}` : 'DEGRADED';
    statusBadge.classList.toggle('error', !health.ok);
    renderCards(health.adapters);
  } catch (error) {
    statusHeading.textContent = 'API unavailable';
    statusBadge.textContent = 'OFFLINE';
    statusBadge.classList.add('error');
    renderCards([]);
    console.error(error);
  }
}

void connect();
