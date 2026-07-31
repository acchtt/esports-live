import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

const DATA_DRAGON_BASE = 'https://ddragon.leagueoflegends.com/cdn';
const INVENTORY_SLOTS = 7;

const style = document.createElement('style');
style.textContent = `
  .player-list.telemetry-player-list {
    gap: 8px;
    margin-top: 14px;
  }

  .telemetry-player-board {
    display: grid;
    grid-template-areas:
      "profile stats"
      "inventory inventory";
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px 14px;
    min-width: 0;
    min-height: 78px;
    padding: 10px 11px;
    border: 1px solid rgba(148, 163, 184, 0.11);
    border-radius: 11px;
    background: linear-gradient(135deg, rgba(255,255,255,.027), rgba(255,255,255,.012));
  }

  .team-card.blue .telemetry-player-board {
    box-shadow: inset 2px 0 rgba(56, 189, 248, 0.28);
  }

  .team-card.red .telemetry-player-board {
    box-shadow: inset -2px 0 rgba(251, 113, 133, 0.26);
  }

  .telemetry-player-profile {
    grid-area: profile;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }

  .telemetry-champion {
    position: relative;
    width: 42px;
    height: 42px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 10px;
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
    font-size: .66rem;
    font-weight: 900;
    letter-spacing: .04em;
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
    font-size: .76rem;
  }

  .telemetry-player-copy span {
    margin-top: 3px;
    color: #7f8da3;
    font-size: .59rem;
    text-transform: capitalize;
  }

  .telemetry-level {
    min-width: 34px;
    padding: 5px 6px;
    border: 1px solid rgba(148, 163, 184, 0.13);
    border-radius: 8px;
    color: #bfdbfe;
    background: rgba(59, 130, 246, 0.055);
    font-size: .58rem;
    font-weight: 850;
    text-align: center;
    white-space: nowrap;
  }

  .telemetry-player-stats {
    grid-area: stats;
    display: grid;
    grid-template-columns: repeat(3, minmax(52px, 1fr));
    gap: 5px;
  }

  .telemetry-player-stat {
    min-width: 0;
    padding: 6px 7px;
    border: 1px solid rgba(148, 163, 184, 0.09);
    border-radius: 8px;
    background: rgba(2, 6, 23, 0.22);
    text-align: right;
  }

  .telemetry-player-stat span,
  .telemetry-player-stat strong {
    display: block;
    white-space: nowrap;
  }

  .telemetry-player-stat span {
    color: #64748b;
    font-size: .48rem;
    font-weight: 850;
    letter-spacing: .07em;
  }

  .telemetry-player-stat strong {
    margin-top: 3px;
    color: #cbd5e1;
    font-size: .66rem;
  }

  .telemetry-inventory {
    grid-area: inventory;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    min-width: 0;
    padding-top: 8px;
    border-top: 1px solid rgba(148, 163, 184, 0.08);
  }

  .telemetry-inventory-label {
    margin-right: auto;
    color: #64748b;
    font-size: .5rem;
    font-weight: 850;
    letter-spacing: .08em;
  }

  .telemetry-item-slot {
    position: relative;
    width: 27px;
    height: 27px;
    flex: 0 0 27px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.13);
    border-radius: 6px;
    background: rgba(2, 6, 23, 0.42);
  }

  .telemetry-item-slot.empty::after,
  .telemetry-item-slot.image-missing::after {
    content: '';
    position: absolute;
    inset: 8px;
    border: 1px solid rgba(100, 116, 139, 0.2);
    border-radius: 3px;
  }

  .telemetry-item-slot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (max-width: 1160px) {
    .telemetry-player-board {
      grid-template-areas:
        "profile"
        "stats"
        "inventory";
      grid-template-columns: minmax(0, 1fr);
    }

    .telemetry-player-stat { text-align: left; }
    .telemetry-inventory { justify-content: flex-start; }
  }

  @media (max-width: 860px) {
    .telemetry-player-board {
      grid-template-areas:
        "profile stats"
        "inventory inventory";
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .telemetry-player-stat { text-align: right; }
    .telemetry-inventory { justify-content: flex-end; }
  }

  @media (max-width: 620px) {
    .telemetry-player-board {
      grid-template-areas:
        "profile"
        "stats"
        "inventory";
      grid-template-columns: minmax(0, 1fr);
      padding: 9px;
    }

    .telemetry-player-profile { grid-template-columns: 38px minmax(0, 1fr) auto; }
    .telemetry-champion { width: 38px; height: 38px; }
    .telemetry-player-stat { text-align: left; }
    .telemetry-inventory { justify-content: flex-start; overflow-x: auto; }
    .telemetry-inventory-label { display: none; }
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
  if (!value) return null;
  const parts = value.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.length >= 3 ? parts.slice(0, 3).join('.') : `${parts[0]}.${parts[1]}.1`;
}

function championKey(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/[^a-z0-9]/gi, '');
  if (!compact || /^\d+$/.test(compact)) return null;
  const aliases: Record<string, string> = {
    Wukong: 'MonkeyKing',
    NunuWillump: 'Nunu',
    RenataGlasc: 'Renata'
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
  return `<div class="telemetry-inventory"><span class="telemetry-inventory-label">ITEMS</span>${slots}</div>`;
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
          <span>${escapeHtml(champion)} · ${escapeHtml(role)}</span>
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

const controlObserver = new MutationObserver(renameHistoryControl);
controlObserver.observe(document.body, { childList: true, subtree: true });
renameHistoryControl();
