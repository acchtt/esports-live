import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

const DATA_DRAGON_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const INVENTORY_SLOTS = 7;

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
      "profile stats"
      "inventory inventory";
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 6px 12px;
    min-width: 0;
    min-height: 66px;
    padding: 8px 9px;
    border: 1px solid rgba(148, 163, 184, 0.1);
    border-radius: 10px;
    background: rgba(2, 6, 23, 0.18);
  }

  .team-card.blue .telemetry-player-board {
    border-left-color: rgba(56, 189, 248, 0.3);
  }

  .team-card.red .telemetry-player-board {
    border-right-color: rgba(251, 113, 133, 0.3);
  }

  .telemetry-player-profile {
    grid-area: profile;
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .telemetry-champion {
    position: relative;
    width: 36px;
    height: 36px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 9px;
    background: rgba(15, 23, 42, 0.92);
  }

  .telemetry-champion img {
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
    font-size: .62rem;
    font-weight: 900;
    letter-spacing: .03em;
  }

  .telemetry-champion img:not([hidden]) + .telemetry-champion-fallback {
    display: none;
  }

  .telemetry-player-copy {
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
    font-size: .74rem;
    line-height: 1.2;
  }

  .telemetry-player-copy span {
    margin-top: 3px;
    color: #7f8da3;
    font-size: .56rem;
    text-transform: capitalize;
  }

  .telemetry-level {
    color: #93c5fd;
    font-size: .53rem;
    font-weight: 850;
    white-space: nowrap;
  }

  .telemetry-player-stats {
    grid-area: stats;
    display: grid;
    grid-template-columns: minmax(72px, auto) repeat(2, minmax(38px, auto));
    align-items: center;
    gap: 0;
  }

  .telemetry-player-stat {
    min-width: 0;
    padding: 0 9px;
    text-align: right;
  }

  .telemetry-player-stat:first-child {
    padding-left: 0;
  }

  .telemetry-player-stat:last-child {
    padding-right: 0;
  }

  .telemetry-player-stat + .telemetry-player-stat {
    border-left: 1px solid rgba(148, 163, 184, 0.09);
  }

  .telemetry-player-stat span,
  .telemetry-player-stat strong {
    display: block;
    white-space: nowrap;
  }

  .telemetry-player-stat span {
    color: #64748b;
    font-size: .44rem;
    font-weight: 850;
    letter-spacing: .07em;
  }

  .telemetry-player-stat strong {
    margin-top: 2px;
    color: #d6deeb;
    font-size: .63rem;
  }

  .telemetry-inventory {
    grid-area: inventory;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 22px;
    padding-left: 44px;
  }

  .telemetry-inventory-label {
    margin-right: 2px;
    color: #58677d;
    font-size: .45rem;
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
    opacity: .34;
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
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @container (max-width: 390px) {
    .telemetry-player-board {
      grid-template-areas:
        "profile"
        "stats"
        "inventory";
      grid-template-columns: minmax(0, 1fr);
      gap: 7px;
    }

    .telemetry-player-stats {
      justify-content: start;
    }

    .telemetry-player-stat {
      text-align: left;
    }

    .telemetry-inventory {
      padding-left: 0;
    }
  }

  @media (max-width: 620px) {
    .telemetry-player-board {
      padding: 8px;
    }

    .telemetry-player-profile {
      grid-template-columns: 34px minmax(0, 1fr) auto;
    }

    .telemetry-champion {
      width: 34px;
      height: 34px;
    }

    .telemetry-inventory {
      overflow-x: auto;
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

function championMarkup(player: LolPlayerState, patch: string | null): string {
  const key = championKey(player.championId);
  const url = patch && key
    ? `${DATA_DRAGON_BASE}/${encodeURIComponent(patch)}/img/champion/${encodeURIComponent(key)}.png`
    : null;
  return `
    <div class="telemetry-champion">
      ${url ? `<img class="telemetry-image" src="${escapeHtml(url)}" alt="${escapeHtml(player.championId ?? '')}" />` : ''}
      <span class="telemetry-champion-fallback">${escapeHtml(initials(player.championId))}</span>
    </div>`;
}

function normalizedItemIds(player: LolPlayerState): string[] {
  return (player.items ?? [])
    .map(item => String(item))
    .filter(item => /^\d+$/.test(item) && Number(item) > 0)
    .slice(0, INVENTORY_SLOTS);
}

function inventoryMarkup(player: LolPlayerState, patch: string | null): string {
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

function statMarkup(label: string, value: string): string {
  return `<div class="telemetry-player-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function playerMarkup(player: LolPlayerState, patch: string | null): string {
  const role = player.role ? player.role.replaceAll('_', ' ') : 'Role unavailable';
  const champion = player.championId ?? 'Champion unavailable';
  return `
    <article class="telemetry-player-board">
      <div class="telemetry-player-profile">
        ${championMarkup(player, patch)}
        <div class="telemetry-player-copy">
          <strong>${escapeHtml(player.handle ?? 'Unknown player')}</strong>
          <span>${escapeHtml(role)} · ${escapeHtml(champion)}</span>
        </div>
        <span class="telemetry-level">LV ${escapeHtml(formatNumber(player.level))}</span>
      </div>
      <div class="telemetry-player-stats">
        ${statMarkup('KDA', `${formatNumber(player.kills)} / ${formatNumber(player.deaths)} / ${formatNumber(player.assists)}`)}
        ${statMarkup('CS', formatNumber(player.creepScore))}
        ${statMarkup('GOLD', formatNumber(player.totalGold))}
      </div>
      ${inventoryMarkup(player, patch)}
    </article>`;
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

function bindImageFallbacks(): void {
  document.querySelectorAll<HTMLImageElement>('.telemetry-image').forEach(image => {
    image.addEventListener('error', () => {
      image.hidden = true;
      image.parentElement?.classList.add('image-missing');
    }, { once: true });
  });
}

function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {
  if (!snapshot.stats) return;
  const patch = dataDragonPatch(snapshot.stats.patch);
  renderTeam(snapshot.stats.blue, patch);
  renderTeam(snapshot.stats.red, patch);
  const patchElement = document.querySelector<HTMLElement>('.scoreboard .clock > span');
  if (patchElement) patchElement.textContent = patchLabel(snapshot.stats.patch);
  bindImageFallbacks();
}

function renameHistoryControl(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-mode="results"]');
  if (!button) return;
  if (button.textContent !== 'Match History') button.textContent = 'Match History';
  button.setAttribute('aria-label', 'Open match history');
}

window.addEventListener('esports-live:snapshot', event => {
  renderSnapshot((event as CustomEvent<LiveSnapshot<LolStats>>).detail);
});

const controlObserver = new MutationObserver(mutations => {
  const needsRename = mutations.some(mutation =>
    [...mutation.addedNodes].some(node =>
      node instanceof Element
      && (node.matches('[data-mode="results"]') || Boolean(node.querySelector('[data-mode="results"]')))
    )
  );
  if (needsRename) renameHistoryControl();
});
controlObserver.observe(document.body, { childList: true, subtree: true });
renameHistoryControl();
