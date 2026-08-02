import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

const DATA_DRAGON_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const INVENTORY_SLOTS = 7;

type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];

const style = document.createElement('style');
style.textContent = `
  .team-card {
    container-type: inline-size;
  }

  .player-list.telemetry-player-list {
    gap: 6px;
    margin-top: 11px;
  }

  .telemetry-player-board {
    display: grid;
    grid-template-areas:
      "champion copy level kda cs gold"
      "inventory inventory inventory inventory inventory inventory";
    grid-template-columns: 34px minmax(78px, 1fr) 34px 50px 32px 46px;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: 62px;
    padding: 8px 9px;
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.2);
  }

  .team-card.blue .telemetry-player-board {
    border-left: 2px solid rgba(56, 189, 248, 0.52);
  }

  .team-card.red .telemetry-player-board {
    border-left: 2px solid rgba(251, 113, 133, 0.52);
  }

  .telemetry-champion {
    grid-area: champion;
    position: relative;
    width: 34px;
    height: 34px;
    overflow: hidden;
    border: 0;
    border-radius: 7px;
    background: transparent;
    box-shadow: none;
  }

  .telemetry-champion img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .telemetry-champion-fallback {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #94a3b8;
    font-size: .6rem;
    font-weight: 900;
  }

  .telemetry-champion img:not([hidden]) + .telemetry-champion-fallback {
    display: none;
  }

  .telemetry-player-copy {
    grid-area: copy;
    min-width: 0;
  }

  .telemetry-player-copy strong,
  .telemetry-player-copy span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .telemetry-player-copy strong {
    color: #f1f5f9;
    font-size: .72rem;
    line-height: 1.2;
  }

  .telemetry-player-copy span {
    margin-top: 2px;
    color: #8190a6;
    font-size: .53rem;
    text-transform: capitalize;
  }

  .telemetry-level {
    grid-area: level;
    color: #bfdbfe;
    font-size: .5rem;
    font-weight: 850;
    text-align: center;
    white-space: nowrap;
  }

  .telemetry-player-stat {
    min-width: 0;
    text-align: right;
  }

  .telemetry-player-stat.kda { grid-area: kda; }
  .telemetry-player-stat.cs { grid-area: cs; }
  .telemetry-player-stat.gold { grid-area: gold; }

  .telemetry-player-stat span,
  .telemetry-player-stat strong {
    display: block;
    white-space: nowrap;
  }

  .telemetry-player-stat span {
    color: #68788f;
    font-size: .42rem;
    font-weight: 850;
    letter-spacing: .06em;
  }

  .telemetry-player-stat strong {
    margin-top: 2px;
    color: #dbe5f3;
    font-size: .6rem;
  }

  .telemetry-inventory {
    grid-area: inventory;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 22px;
    padding-left: 40px;
  }

  .telemetry-inventory-label {
    margin-right: 2px;
    color: #64748b;
    font-size: .43rem;
    font-weight: 850;
    letter-spacing: .08em;
  }

  .telemetry-item-slot {
    position: relative;
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 5px;
    background: rgba(2, 6, 23, 0.42);
  }

  .telemetry-item-slot.empty {
    opacity: .3;
  }

  .telemetry-item-slot.empty::after,
  .telemetry-item-slot.image-missing::after {
    content: '';
    position: absolute;
    inset: 7px;
    border: 1px solid rgba(100, 116, 139, 0.2);
    border-radius: 2px;
  }

  .telemetry-item-slot img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* The role matchup board is rendered by main.ts. Add media without replacing its stats. */
  .role-player {
    grid-template-columns: 38px minmax(0, 1fr) auto;
    grid-template-areas:
      "portrait heading stats"
      "portrait items items";
    column-gap: 10px;
    row-gap: 6px;
  }

  .role-player.red {
    grid-template-columns: auto minmax(0, 1fr) 38px;
    grid-template-areas:
      "stats heading portrait"
      "items items portrait";
  }

  .role-player .role-player-heading {
    grid-area: heading;
    grid-column: auto;
    grid-row: auto;
  }

  .role-player .role-player-stats {
    grid-area: stats;
    grid-column: auto;
    grid-row: auto;
  }

  .role-player-portrait {
    grid-area: portrait;
    display: grid;
    place-items: center;
    align-self: center;
  }

  .role-player-portrait .telemetry-champion {
    width: 38px;
    height: 38px;
    border-radius: 8px;
  }

  .role-player-items {
    grid-area: items;
    min-width: 0;
  }

  .role-player-items .telemetry-inventory {
    justify-content: flex-start;
    min-height: 20px;
    padding-left: 0;
  }

  .role-player.red .role-player-items .telemetry-inventory {
    justify-content: flex-end;
  }

  .role-player-items .telemetry-item-slot {
    width: 20px;
    height: 20px;
    flex-basis: 20px;
    border-radius: 4px;
  }

  .role-player-items .telemetry-inventory-label {
    font-size: .4rem;
  }

  @container (max-width: 320px) {
    .telemetry-player-board {
      grid-template-areas:
        "champion copy level"
        "kda cs gold"
        "inventory inventory inventory";
      grid-template-columns: 34px minmax(0, 1fr) 38px;
      gap: 7px 8px;
    }

    .telemetry-player-stat {
      text-align: left;
    }

    .telemetry-inventory {
      padding-left: 0;
    }
  }

  @media (max-width: 1320px) {
    .role-player,
    .role-player.red {
      grid-template-columns: 34px minmax(0, 1fr);
      grid-template-areas:
        "portrait heading"
        "stats stats"
        "items items";
      gap: 6px 8px;
    }

    .role-player.red {
      grid-template-columns: minmax(0, 1fr) 34px;
      grid-template-areas:
        "heading portrait"
        "stats stats"
        "items items";
    }

    .role-player-portrait .telemetry-champion {
      width: 34px;
      height: 34px;
    }

    .role-player.red .role-player-stats {
      justify-content: end;
      text-align: right;
    }

    .role-player-items .telemetry-inventory-label {
      display: none;
    }
  }

  @media (max-width: 720px) {
    .role-player-items {
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .role-player-items .telemetry-inventory {
      gap: 3px;
    }

    .role-player-items .telemetry-item-slot {
      width: 18px;
      height: 18px;
      flex-basis: 18px;
    }
  }

  @media (max-width: 620px) {
    .telemetry-inventory {
      overflow-x: auto;
    }
  }
/* player-board-readability */
.telemetry-player-board {
  grid-template-columns: 40px minmax(96px, 1fr) 42px 62px 42px 58px;
  gap: 8px;
  min-height: 74px;
  padding: 10px 12px;
  border-color: rgba(148, 163, 184, 0.17);
  background: rgba(2, 6, 23, 0.34);
}

.telemetry-champion {
  width: 40px;
  height: 40px;
  border-radius: 9px;
}

.telemetry-player-copy strong {
  color: #f8fafc;
  font-size: .82rem;
}

.telemetry-player-copy span {
  color: #a4b0c1;
  font-size: .6rem;
}

.telemetry-level {
  color: #dbeafe;
  font-size: .58rem;
}

.telemetry-player-stat span {
  color: #94a3b8;
  font-size: .48rem;
}

.telemetry-player-stat strong {
  color: #f1f5f9;
  font-size: .68rem;
}

.telemetry-inventory {
  gap: 5px;
  min-height: 26px;
  padding-left: 48px;
}

.telemetry-inventory-label {
  color: #94a3b8;
  font-size: .5rem;
}

.telemetry-item-slot {
  width: 24px;
  height: 24px;
  flex-basis: 24px;
  border-color: rgba(148, 163, 184, 0.2);
}

.role-matchup-row {
  min-height: 106px;
}

.role-player,
.role-player.red {
  grid-template-columns: 44px minmax(0, 1fr) minmax(176px, auto);
  grid-template-areas:
    "portrait heading stats"
    "portrait items items";
  gap: 9px 12px;
  padding: 14px 18px;
}

.role-player.red {
  grid-template-columns: minmax(176px, auto) minmax(0, 1fr) 44px;
  grid-template-areas:
    "stats heading portrait"
    "items items portrait";
}

.role-player-portrait .telemetry-champion {
  width: 44px;
  height: 44px;
  border-radius: 10px;
}

.role-player .role-player-heading {
  gap: 10px;
}

.role-player .role-chip {
  min-width: 58px;
  min-height: 26px;
  font-size: .54rem;
}

.role-player .role-player-name strong {
  color: #f8fafc;
  font-size: .9rem;
  line-height: 1.25;
}

.role-player .role-player-name small {
  display: block;
  margin-top: 3px;
  color: #a5b2c3;
  font-size: .64rem;
}

.role-player .role-player-stats {
  grid-template-columns: repeat(3, minmax(52px, auto));
  gap: 6px;
}

.role-player .role-player-stats > span {
  min-width: 52px;
  padding: 6px 8px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.44);
}

.role-player .role-player-stats small {
  color: #94a3b8;
  font-size: .5rem;
}

.role-player .role-player-stats strong {
  margin-top: 3px;
  color: #f1f5f9;
  font-size: .72rem;
}

.role-player-items .telemetry-inventory {
  gap: 5px;
  min-height: 24px;
}

.role-player-items .telemetry-item-slot {
  width: 23px;
  height: 23px;
  flex-basis: 23px;
  border-radius: 5px;
}

.role-player-items .telemetry-inventory-label {
  display: inline;
  color: #8f9caf;
  font-size: .46rem;
}

@container (max-width: 360px) {
  .telemetry-player-board {
    grid-template-areas:
      "champion copy level"
      "kda cs gold"
      "inventory inventory inventory";
    grid-template-columns: 40px minmax(0, 1fr) 42px;
    gap: 8px;
  }

  .telemetry-player-stat {
    text-align: left;
  }

  .telemetry-inventory {
    padding-left: 0;
  }
}

@media (max-width: 1320px) {
  .role-player,
  .role-player.red {
    grid-template-columns: 40px minmax(0, 1fr);
    grid-template-areas:
      "portrait heading"
      "stats stats"
      "items items";
    gap: 8px 10px;
  }

  .role-player.red {
    grid-template-columns: minmax(0, 1fr) 40px;
    grid-template-areas:
      "heading portrait"
      "stats stats"
      "items items";
  }

  .role-player-portrait .telemetry-champion {
    width: 40px;
    height: 40px;
  }

  .role-player .role-player-stats {
    width: 100%;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .role-player,
  .role-player.red {
    padding: 12px 10px;
  }

  .role-player .role-chip {
    min-width: 0;
    font-size: .48rem;
  }

  .role-player .role-player-name strong {
    font-size: .78rem;
  }

  .role-player .role-player-name small,
  .role-player .role-player-stats > span:nth-child(2) {
    display: block;
  }

  .role-player .role-player-stats {
    gap: 4px;
  }

  .role-player .role-player-stats > span {
    min-width: 0;
    padding: 5px 4px;
  }

  .role-player .role-player-stats small {
    font-size: .43rem;
  }

  .role-player .role-player-stats strong {
    font-size: .62rem;
  }

  .role-player-items .telemetry-inventory-label {
    display: none;
  }
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

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function dataDragonPatch(value: string | null): string | null {
  const match = value?.match(/^(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.1` : null;
}

function patchLabel(value: string | null): string {
  const match = value?.match(/^(\d+)\.(\d+)/);
  return match ? `Patch ${match[1]}.${match[2]}` : 'Patch unavailable';
}

function championKey(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/[^a-z0-9]/gi, '');
  if (!compact || /^\d+$/.test(compact)) return null;
  const aliases: Record<string, string> = {
    BelVeth: 'Belveth',
    ChoGath: 'Chogath',
    KaiSa: 'Kaisa',
    KhaZix: 'Khazix',
    LeBlanc: 'Leblanc',
    NunuWillump: 'Nunu',
    RenataGlasc: 'Renata',
    VelKoz: 'Velkoz',
    Wukong: 'MonkeyKing'
  };
  return aliases[compact] ?? compact;
}

function initials(value: string | null): string {
  const words = String(value ?? '?').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(word => word[0]?.toUpperCase() ?? '').join('') || '?';
}

function championMarkup(player: LolPlayerState | null, patch: string | null): string {
  const championId = player?.championId ?? null;
  const key = championKey(championId);
  const url = patch && key
    ? `${DATA_DRAGON_BASE}/${encodeURIComponent(patch)}/img/champion/${encodeURIComponent(key)}.png`
    : null;
  return `
    <div class="telemetry-champion">
      ${url ? `<img class="telemetry-image" src="${escapeHtml(url)}" alt="${escapeHtml(championId ?? '')}" />` : ''}
      <span class="telemetry-champion-fallback">${escapeHtml(initials(championId))}</span>
    </div>`;
}

function normalizedItemIds(player: LolPlayerState | null): string[] {
  return (player?.items ?? [])
    .map(item => String(item))
    .filter(item => /^\d+$/.test(item) && Number(item) > 0)
    .slice(0, INVENTORY_SLOTS);
}

function inventoryMarkup(player: LolPlayerState | null, patch: string | null): string {
  const items = normalizedItemIds(player);
  const slots = Array.from({ length: INVENTORY_SLOTS }, (_, index) => {
    const itemId = items[index];
    if (!itemId || !patch) return '<span class="telemetry-item-slot empty" aria-hidden="true"></span>';
    const url = `${DATA_DRAGON_BASE}/${encodeURIComponent(patch)}/img/item/${encodeURIComponent(itemId)}.png`;
    return `
      <span class="telemetry-item-slot" title="Item ${escapeHtml(itemId)}">
        <img class="telemetry-image" src="${escapeHtml(url)}" alt="Item ${escapeHtml(itemId)}" />
      </span>`;
  }).join('');
  return `<div class="telemetry-inventory"><span class="telemetry-inventory-label">BUILD</span>${slots}</div>`;
}

function statMarkup(className: 'kda' | 'cs' | 'gold', label: string, value: string): string {
  return `<div class="telemetry-player-stat ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function playerMarkup(player: LolPlayerState, patch: string | null): string {
  const role = player.role ? player.role.replaceAll('_', ' ') : 'Role unavailable';
  const champion = player.championId ?? 'Champion unavailable';
  return `
    <article class="telemetry-player-board">
      ${championMarkup(player, patch)}
      <div class="telemetry-player-copy">
        <strong>${escapeHtml(player.handle ?? 'Unknown player')}</strong>
        <span>${escapeHtml(role)} · ${escapeHtml(champion)}</span>
      </div>
      <span class="telemetry-level">LV ${escapeHtml(formatNumber(player.level))}</span>
      ${statMarkup('kda', 'KDA', `${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}`)}
      ${statMarkup('cs', 'CS', formatNumber(player.creepScore))}
      ${statMarkup('gold', 'GOLD', formatNumber(player.totalGold))}
      ${inventoryMarkup(player, patch)}
    </article>`;
}

function canonicalRole(value: string | null): CanonicalRole | null {
  const normalized = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
  if (!normalized) return null;
  if (normalized.includes('top')) return 'top';
  if (normalized.includes('jung')) return 'jungle';
  if (normalized.includes('mid')) return 'mid';
  if (normalized.includes('bot') || normalized.includes('adc') || normalized.includes('carry')) return 'bottom';
  if (normalized.includes('sup') || normalized.includes('utility')) return 'support';
  return null;
}

function orderedPlayers(team: LolTeamState): readonly (LolPlayerState | null)[] {
  const assigned = new Map<CanonicalRole, LolPlayerState>();
  const unassigned: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = canonicalRole(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else unassigned.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? unassigned.shift() ?? null);
}

function renderTeam(team: LolTeamState, patch: string | null): void {
  const card = document.querySelector<HTMLElement>(`.team-card.${team.side}`);
  const list = card?.querySelector<HTMLElement>('.player-list');
  if (!list) return;
  list.classList.add('telemetry-player-list');
  list.innerHTML = team.players.length
    ? team.players.map(player => playerMarkup(player, patch)).join('')
    : '<div class="players-empty">Player telemetry unavailable</div>';
}

function enhanceRolePlayer(container: HTMLElement | null, player: LolPlayerState | null, patch: string | null): void {
  if (!container) return;

  let portrait = container.querySelector<HTMLElement>(':scope > .role-player-portrait');
  if (!portrait) {
    portrait = document.createElement('div');
    portrait.className = 'role-player-portrait';
    container.append(portrait);
  }
  portrait.innerHTML = championMarkup(player, patch);

  let items = container.querySelector<HTMLElement>(':scope > .role-player-items');
  if (!items) {
    items = document.createElement('div');
    items.className = 'role-player-items';
    container.append(items);
  }
  items.innerHTML = inventoryMarkup(player, patch);
}

function renderRoleBoard(
  blue: LolTeamState,
  red: LolTeamState,
  patch: string | null,
  root: ParentNode = document
): void {
  const rows = [...root.querySelectorAll<HTMLElement>('.role-matchup-row')];
  if (!rows.length) return;

  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  rows.forEach((row, index) => {
    enhanceRolePlayer(row.querySelector<HTMLElement>('.role-player.blue'), bluePlayers[index] ?? null, patch);
    enhanceRolePlayer(row.querySelector<HTMLElement>('.role-player.red'), redPlayers[index] ?? null, patch);
  });
}

function bindImageFallbacks(root: ParentNode = document): void {
  root.querySelectorAll<HTMLImageElement>('.telemetry-image:not([data-fallback-bound])').forEach(image => {
    image.dataset.fallbackBound = 'true';
    const showFallback = (): void => {
      image.hidden = true;
      image.parentElement?.classList.add('image-missing');
    };
    if (image.complete && image.naturalWidth === 0) showFallback();
    else image.addEventListener('error', showFallback, { once: true });
  });
}

function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {
  if (!snapshot.stats) return;
  const patch = dataDragonPatch(snapshot.stats.patch);
  renderTeam(snapshot.stats.blue, patch);
  renderTeam(snapshot.stats.red, patch);
  renderRoleBoard(snapshot.stats.blue, snapshot.stats.red, patch);
  const patchElement = document.querySelector<HTMLElement>('.role-match-clock .patch-label');
  if (patchElement) patchElement.textContent = patchLabel(snapshot.stats.patch);
  bindImageFallbacks();
}

window.addEventListener('esports-live:snapshot', event => {
  renderSnapshot((event as CustomEvent<LiveSnapshot<LolStats>>).detail);
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot: LiveSnapshot<LolStats>; root: HTMLElement }>).detail;
  if (!detail.snapshot.stats || !detail.root.isConnected) return;
  const patch = dataDragonPatch(detail.snapshot.stats.patch);
  renderRoleBoard(detail.snapshot.stats.blue, detail.snapshot.stats.red, patch, detail.root);
  bindImageFallbacks(detail.root);
});
