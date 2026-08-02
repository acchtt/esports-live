import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];

const style = document.createElement('style');
style.textContent = `
  .role-player-portrait .telemetry-champion {
    isolation: isolate;
  }

  .champion-level-badge {
    position: absolute;
    right: 2px;
    bottom: 2px;
    z-index: 2;
    display: inline-grid;
    place-items: center;
    min-width: 17px;
    height: 17px;
    padding: 0 3px;
    border: 1px solid rgba(226, 232, 240, 0.72);
    border-radius: 999px;
    color: #f8fafc;
    background: rgba(2, 6, 23, 0.94);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
    font-size: 0.54rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .role-player.blue .champion-level-badge {
    border-color: rgba(125, 211, 252, 0.82);
  }

  .role-player.red .champion-level-badge {
    border-color: rgba(253, 164, 175, 0.82);
  }

  @media (max-width: 720px) {
    .champion-level-badge {
      min-width: 16px;
      height: 16px;
      font-size: 0.5rem;
    }
  }
`;
document.head.append(style);

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

function levelText(player: LolPlayerState | null): string {
  return player?.level === null || player?.level === undefined
    ? '—'
    : String(Math.max(1, Math.floor(player.level)));
}

function applyBadge(container: HTMLElement | null, player: LolPlayerState | null): void {
  const champion = container?.querySelector<HTMLElement>('.role-player-portrait .telemetry-champion');
  if (!champion) return;

  let badge = champion.querySelector<HTMLElement>(':scope > .champion-level-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'champion-level-badge';
    champion.append(badge);
  }

  const value = levelText(player);
  const label = value === '—' ? 'Champion level unavailable' : `Champion level ${value}`;
  if (badge.textContent !== value) badge.textContent = value;
  if (badge.title !== label) badge.title = label;
  if (badge.getAttribute('aria-label') !== label) badge.setAttribute('aria-label', label);
}

function renderLevels(
  blue: LolTeamState,
  red: LolTeamState,
  root: ParentNode = document
): void {
  const rows = [...root.querySelectorAll<HTMLElement>('.role-matchup-row')];
  if (!rows.length) return;

  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);

  rows.forEach((row, index) => {
    applyBadge(row.querySelector<HTMLElement>('.role-player.blue'), bluePlayers[index] ?? null);
    applyBadge(row.querySelector<HTMLElement>('.role-player.red'), redPlayers[index] ?? null);
  });
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot.stats) return;
  renderLevels(snapshot.stats.blue, snapshot.stats.red);
});

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot: LiveSnapshot<LolStats>; root: HTMLElement }>).detail;
  if (!detail.snapshot.stats || !detail.root.isConnected) return;
  renderLevels(detail.snapshot.stats.blue, detail.snapshot.stats.red, detail.root);
});
