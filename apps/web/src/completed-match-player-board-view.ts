const DATA_DRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const DATA_DRAGON_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const INVENTORY_SLOTS = 7;

let dataDragonVersion: string | null = null;
let versionPromise: Promise<string | null> | null = null;

const style = document.createElement('style');
style.textContent = `
  .completed-final-telemetry .completed-game-tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 8px;
  }

  .completed-final-telemetry .completed-game-tab {
    min-height: 38px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.018);
    cursor: pointer;
    font-size: .68rem;
    font-weight: 850;
  }

  .completed-final-telemetry .completed-game-tab.active {
    border-color: rgba(56, 189, 248, .38);
    color: #e0f7ff;
    background: rgba(56, 189, 248, .08);
  }

  .completed-final-game[data-board-hidden="true"] {
    display: none !important;
  }

  .completed-final-player.history-player-board {
    display: grid;
    grid-template-areas:
      "profile stats"
      "inventory inventory";
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 9px 12px;
    align-items: center;
    min-height: 76px;
    padding: 10px;
    border: 1px solid rgba(148, 163, 184, .1);
    border-radius: 10px;
    background: rgba(255, 255, 255, .018);
    font-size: .68rem;
  }

  .history-player-profile {
    grid-area: profile;
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr);
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .history-champion-icon {
    position: relative;
    width: 40px;
    height: 40px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, .16);
    border-radius: 9px;
    background: rgba(15, 23, 42, .92);
  }

  .history-champion-icon img,
  .history-item-slot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .history-champion-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #94a3b8;
    font-size: .62rem;
    font-weight: 900;
  }

  .history-player-copy {
    min-width: 0;
  }

  .history-player-copy strong,
  .history-player-copy span {
    display: block;
    overflow-wrap: anywhere;
  }

  .history-player-copy strong {
    color: #f8fafc;
    font-size: .74rem;
  }

  .history-player-copy span {
    margin-top: 3px;
    color: var(--muted);
    font-size: .62rem;
  }

  .history-player-stats {
    grid-area: stats;
    display: grid;
    grid-template-columns: repeat(3, minmax(58px, auto));
    gap: 6px;
  }

  .history-player-stat {
    min-width: 58px;
    padding: 6px 7px;
    border-radius: 8px;
    background: rgba(255, 255, 255, .025);
    text-align: right;
  }

  .history-player-stat span,
  .history-player-stat strong {
    display: block;
  }

  .history-player-stat span {
    color: var(--muted);
    font-size: .52rem;
    letter-spacing: .05em;
  }

  .history-player-stat strong {
    margin-top: 2px;
    color: #f8fafc;
    font-size: .67rem;
  }

  .history-player-inventory {
    grid-area: inventory;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    min-width: 0;
  }

  .history-inventory-label {
    margin-right: 3px;
    color: var(--muted);
    font-size: .52rem;
    font-weight: 850;
    letter-spacing: .06em;
  }

  .history-item-slot {
    width: 28px;
    height: 28px;
    overflow: hidden;
    flex: 0 0 auto;
    border: 1px solid rgba(148, 163, 184, .13);
    border-radius: 6px;
    background: rgba(15, 23, 42, .72);
  }

  .history-item-slot.empty {
    opacity: .42;
  }

  @media (max-width: 920px) {
    .completed-final-player.history-player-board {
      grid-template-areas:
        "profile"
        "stats"
        "inventory";
      grid-template-columns: 1fr;
    }

    .history-player-stat { text-align: left; }
    .history-player-inventory { justify-content: flex-start; overflow-x: auto; }
  }
`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function championKey(value: string): string | null {
  const compact = value.replace(/[^a-z0-9]/gi, '');
  if (!compact || /^\d+$/.test(compact)) return null;
  const aliases: Record<string, string> = {
    Wukong: 'MonkeyKing',
    NunuWillump: 'Nunu',
    RenataGlasc: 'Renata'
  };
  return aliases[compact] ?? compact;
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

async function resolveVersion(): Promise<string | null> {
  if (dataDragonVersion) return dataDragonVersion;
  if (versionPromise) return versionPromise;
  versionPromise = fetch(DATA_DRAGON_VERSIONS, { cache: 'force-cache' })
    .then(response => response.ok ? response.json() : [])
    .then(value => {
      const versions = Array.isArray(value) ? value : [];
      dataDragonVersion = typeof versions[0] === 'string' ? versions[0] : null;
      return dataDragonVersion;
    })
    .catch(() => null);
  return versionPromise;
}

function parseKda(value: string): string {
  return value.match(/(?:\d+|—)\/(?:\d+|—)\/(?:\d+|—)/)?.[0] ?? '— / — / —';
}

function parseCs(value: string): string {
  return value.match(/(?:\d[\d,]*|—)\s*CS/i)?.[0]?.replace(/\s*CS/i, '') ?? '—';
}

function parseGold(value: string): string {
  return value.match(/(?:\d[\d,]*|—)g\b/i)?.[0]?.replace(/g$/i, '') ?? '—';
}

function parseItemIds(value: string): string[] {
  return [...value.matchAll(/\b\d{4}\b/g)]
    .map(match => match[0])
    .filter(item => Number(item) > 0)
    .slice(0, INVENTORY_SLOTS);
}

function statMarkup(label: string, value: string): string {
  return `<div class="history-player-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function inventoryMarkup(items: readonly string[], version: string | null): string {
  const slots = Array.from({ length: INVENTORY_SLOTS }, (_, index) => {
    const itemId = items[index];
    if (!itemId || !version) return '<span class="history-item-slot empty" aria-hidden="true"></span>';
    const url = `${DATA_DRAGON_BASE}/${encodeURIComponent(version)}/img/item/${encodeURIComponent(itemId)}.png`;
    return `<span class="history-item-slot" title="Item ${escapeHtml(itemId)}"><img src="${escapeHtml(url)}" alt="Item ${escapeHtml(itemId)}" /></span>`;
  }).join('');
  return `<div class="history-player-inventory"><span class="history-inventory-label">ITEMS</span>${slots}</div>`;
}

function transformPlayer(row: HTMLElement, version: string | null): void {
  if (row.dataset.boardEnhanced === 'true') return;
  const copy = row.querySelector<HTMLElement>('div');
  const name = copy?.querySelector('strong')?.textContent?.trim() || 'Unknown player';
  const champion = copy?.querySelector('small')?.textContent?.trim() || 'Champion unavailable';
  const spans = [...row.querySelectorAll<HTMLElement>(':scope > span')];
  const combatText = spans[0]?.textContent ?? '';
  const economyText = spans[1]?.textContent ?? '';
  const key = championKey(champion);
  const championUrl = version && key
    ? `${DATA_DRAGON_BASE}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png`
    : null;
  const items = parseItemIds(economyText);

  row.dataset.boardEnhanced = 'true';
  row.classList.add('history-player-board');
  row.innerHTML = `
    <div class="history-player-profile">
      <div class="history-champion-icon">
        ${championUrl ? `<img src="${escapeHtml(championUrl)}" alt="${escapeHtml(champion)}" />` : ''}
        <span class="history-champion-fallback">${escapeHtml(initials(champion))}</span>
      </div>
      <div class="history-player-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(champion)}</span></div>
    </div>
    <div class="history-player-stats">
      ${statMarkup('KDA', parseKda(combatText))}
      ${statMarkup('CS', parseCs(combatText))}
      ${statMarkup('GOLD', parseGold(economyText))}
    </div>
    ${inventoryMarkup(items, version)}`;

  row.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
    }, { once: true });
  });
}

function gameNumber(game: HTMLElement, index: number): string {
  return game.querySelector('.completed-final-game-header strong')?.textContent?.match(/Game\s+(\d+)/i)?.[1]
    ?? String(index + 1);
}

function gameLabel(game: HTMLElement, index: number): string {
  const heading = game.querySelector('.completed-final-game-header strong')?.textContent?.trim();
  return heading || `Game ${index + 1}`;
}

function installTabs(host: HTMLElement): void {
  const games = [...host.querySelectorAll<HTMLElement>('.completed-final-game')];
  if (!games.length) return;
  let tabs = host.querySelector<HTMLElement>('.completed-game-tabs');
  if (!tabs) {
    tabs = document.createElement('div');
    tabs.className = 'completed-game-tabs';
    const heading = host.querySelector('.completed-telemetry-heading');
    heading?.insertAdjacentElement('afterend', tabs);
  }

  const availableNumbers = games.map(gameNumber);
  const selected = host.dataset.selectedFinalGame && availableNumbers.includes(host.dataset.selectedFinalGame)
    ? host.dataset.selectedFinalGame
    : availableNumbers.at(-1)!;
  host.dataset.selectedFinalGame = selected;

  tabs.innerHTML = games.map((game, index) => {
    const number = gameNumber(game, index);
    return `<button type="button" class="completed-game-tab ${number === selected ? 'active' : ''}" data-final-game-tab="${escapeHtml(number)}">${escapeHtml(gameLabel(game, index))}</button>`;
  }).join('');

  games.forEach((game, index) => {
    game.dataset.boardHidden = String(gameNumber(game, index) !== selected);
  });

  tabs.querySelectorAll<HTMLButtonElement>('[data-final-game-tab]').forEach(button => {
    button.addEventListener('click', () => {
      host.dataset.selectedFinalGame = button.dataset.finalGameTab ?? selected;
      installTabs(host);
    });
  });
}

async function enhanceCompletedTelemetry(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#completed-final-telemetry');
  if (!host) return;
  const version = await resolveVersion();
  host.querySelectorAll<HTMLElement>('.completed-final-player').forEach(row => transformPlayer(row, version));
  installTabs(host);
}

let queued = false;
function queueEnhancement(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    void enhanceCompletedTelemetry();
  });
}

new MutationObserver(queueEnhancement).observe(document.body, { childList: true, subtree: true });
queueEnhancement();
