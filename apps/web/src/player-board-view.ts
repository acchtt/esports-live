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
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
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
    width: 100%;
    height: 100%;
    object-fit: cover;
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

  @media (max-width: 620px) {
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
  const patchElement = document.querySelector<HTMLElement>('.scoreboard .patch-label');
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
