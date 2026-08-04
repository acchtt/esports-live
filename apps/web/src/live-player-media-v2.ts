import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

const DATA_DRAGON_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const INVENTORY_SLOTS = 7;

type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];

const style = document.createElement('style');
style.textContent = `
  .live-dashboard-v2 .v2-matchup-row {
    min-height: 82px !important;
  }

  .live-dashboard-v2 .v2-player,
  .live-dashboard-v2 .v2-player.red {
    grid-template-rows: minmax(42px, auto) 22px !important;
    row-gap: 4px !important;
    padding-top: 7px !important;
    padding-bottom: 6px !important;
  }

  .live-dashboard-v2 .v2-player {
    grid-template-areas:
      'champion copy kda cs gold'
      'champion items items items items' !important;
  }

  .live-dashboard-v2 .v2-player.red {
    grid-template-areas:
      'gold cs kda copy champion'
      'items items items items champion' !important;
  }

  .live-dashboard-v2 .v2-champion {
    position: relative;
    overflow: visible;
    isolation: isolate;
  }

  .live-dashboard-v2 .v2-champion-portrait,
  .live-dashboard-v2 .v2-champion-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
  }

  .live-dashboard-v2 .v2-champion-portrait {
    z-index: 1;
    display: block;
    object-fit: cover;
  }

  .live-dashboard-v2 .v2-champion-fallback {
    z-index: 0;
    display: grid;
    place-items: center;
    color: #d7edff;
    font-size: 11px;
    font-weight: 900;
  }

  .live-dashboard-v2 .v2-champion-portrait:not([hidden]) + .v2-champion-fallback {
    visibility: hidden;
  }

  .live-dashboard-v2 .v2-player-media {
    grid-area: items;
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .live-dashboard-v2 .v2-player.red .v2-player-media {
    justify-content: flex-end;
  }

  .live-dashboard-v2 .v2-item-slot {
    position: relative;
    display: block;
    width: 20px;
    height: 20px;
    flex: 0 0 20px;
    overflow: hidden;
    border: 1px solid rgba(132, 157, 190, 0.2);
    border-radius: 4px;
    background: rgba(2, 10, 19, 0.72);
  }

  .live-dashboard-v2 .v2-item-slot img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .live-dashboard-v2 .v2-item-slot.empty {
    opacity: 0.28;
  }

  .live-dashboard-v2 .v2-item-slot.empty::after,
  .live-dashboard-v2 .v2-item-slot.image-missing::after {
    position: absolute;
    inset: 6px;
    border: 1px solid rgba(130, 151, 181, 0.22);
    border-radius: 2px;
    content: '';
  }

  @media (max-width: 1180px) {
    .live-dashboard-v2 .v2-matchup-row {
      min-height: 78px !important;
    }

    .live-dashboard-v2 .v2-item-slot {
      width: 18px;
      height: 18px;
      flex-basis: 18px;
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

function dataDragonPatch(value: string | null): string | null {
  const match = value?.match(/^(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.1` : null;
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

function canonicalRole(value: string | null): CanonicalRole | null {
  const normalized = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
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

function championMarkup(player: LolPlayerState | null, patch: string | null): string {
  const championId = player?.championId ?? null;
  const key = championKey(championId);
  const url = patch && key
    ? `${DATA_DRAGON_BASE}/${encodeURIComponent(patch)}/img/champion/${encodeURIComponent(key)}.png`
    : null;
  return `${url ? `<img class="v2-champion-portrait" src="${escapeHtml(url)}" alt="${escapeHtml(championId ?? 'Champion')}" />` : ''}<span class="v2-champion-fallback" aria-hidden="true">${escapeHtml(initials(championId))}</span>`;
}

function itemMarkup(player: LolPlayerState | null, patch: string | null): string {
  const itemIds = (player?.items ?? [])
    .map(item => String(item))
    .filter(item => /^\d+$/.test(item) && Number(item) > 0)
    .slice(0, INVENTORY_SLOTS);

  return Array.from({ length: INVENTORY_SLOTS }, (_, index) => {
    const itemId = itemIds[index];
    if (!itemId || !patch) return '<span class="v2-item-slot empty" aria-hidden="true"></span>';
    const url = `${DATA_DRAGON_BASE}/${encodeURIComponent(patch)}/img/item/${encodeURIComponent(itemId)}.png`;
    return `<span class="v2-item-slot" title="Item ${escapeHtml(itemId)}"><img src="${escapeHtml(url)}" alt="Item ${escapeHtml(itemId)}" /></span>`;
  }).join('');
}

function bindImageFallbacks(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('.v2-champion-portrait:not([data-fallback-bound]), .v2-item-slot img:not([data-fallback-bound])').forEach(image => {
    image.dataset.fallbackBound = 'true';
    const showFallback = (): void => {
      image.hidden = true;
      image.parentElement?.classList.add('image-missing');
    };
    if (image.complete && image.naturalWidth === 0) showFallback();
    else image.addEventListener('error', showFallback, { once: true });
  });
}

function enhancePlayer(container: HTMLElement | null, player: LolPlayerState | null, patch: string | null): void {
  if (!container) return;
  const champion = container.querySelector<HTMLElement>(':scope > .v2-champion');
  if (champion) champion.innerHTML = championMarkup(player, patch);

  let media = container.querySelector<HTMLElement>(':scope > .v2-player-media');
  if (!media) {
    media = document.createElement('div');
    media.className = 'v2-player-media';
    media.setAttribute('aria-label', 'Player item build');
    container.append(media);
  }
  media.innerHTML = itemMarkup(player, patch);
}

function render(snapshot: LiveSnapshot<LolStats>): boolean {
  if (!snapshot.stats) return false;
  const board = document.querySelector<HTMLElement>(`.live-dashboard-v2[data-live-dashboard-game-id="${CSS.escape(snapshot.game.id)}"]`);
  if (!board) return false;

  const patch = dataDragonPatch(snapshot.stats.patch);
  const bluePlayers = orderedPlayers(snapshot.stats.blue);
  const redPlayers = orderedPlayers(snapshot.stats.red);
  const rows = [...board.querySelectorAll<HTMLElement>('.v2-matchup-row')];

  rows.forEach((row, index) => {
    enhancePlayer(row.querySelector<HTMLElement>('.v2-player.blue'), bluePlayers[index] ?? null, patch);
    enhancePlayer(row.querySelector<HTMLElement>('.v2-player.red'), redPlayers[index] ?? null, patch);
  });
  bindImageFallbacks(board);
  return rows.length > 0;
}

function renderAfterDashboard(snapshot: LiveSnapshot<LolStats>): void {
  queueMicrotask(() => {
    if (render(snapshot)) return;
    requestAnimationFrame(() => render(snapshot));
  });
}

window.addEventListener('esports-live:snapshot', event => {
  renderAfterDashboard((event as CustomEvent<LiveSnapshot<LolStats>>).detail);
});
