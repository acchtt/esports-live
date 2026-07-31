from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'apps/web/src/main.ts'
STYLES = ROOT / 'apps/web/src/styles.css'


def update_main() -> None:
    text = MAIN.read_text(encoding='utf-8')
    text = text.replace(
        "import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';",
        "import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';",
        1,
    )

    replacement = r'''type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const ROLE_LABELS: Record<CanonicalRole, string> = {
  top: 'Top',
  jungle: 'Jungle',
  mid: 'Mid',
  bottom: 'Bottom',
  support: 'Support'
};

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

function playerKda(player: LolPlayerState | null): string {
  if (!player) return '—/—/—';
  return `${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}`;
}

function playerIdentityMarkup(player: LolPlayerState | null, role: CanonicalRole, side: 'blue' | 'red'): string {
  const name = player?.handle ?? 'Player unavailable';
  const champion = player?.championId ?? 'Champion unavailable';
  return `
    <div class="role-player ${side}">
      <div class="role-player-heading">
        <span class="role-chip">${ROLE_LABELS[role]}</span>
        <div class="role-player-name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(champion)}</small></div>
      </div>
      <div class="role-player-stats">
        <span><small>KDA</small><strong>${playerKda(player)}</strong></span>
        <span><small>CS</small><strong>${formatNumber(player?.creepScore ?? null)}</strong></span>
        <span><small>GOLD</small><strong>${formatNumber(player?.totalGold ?? null)}</strong></span>
      </div>
    </div>`;
}

function roleGoldDeltaMarkup(blue: LolPlayerState | null, red: LolPlayerState | null, role: CanonicalRole): string {
  const blueGold = blue?.totalGold ?? null;
  const redGold = red?.totalGold ?? null;
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const side = difference === null ? 'unknown' : difference > 0 ? 'blue' : difference < 0 ? 'red' : 'even';
  const magnitude = difference === null ? null : Math.abs(difference);
  const edge = magnitude === null ? 0 : Math.min(50, Math.round((magnitude / 2500) * 50));
  const title = difference === null
    ? `${ROLE_LABELS[role]} gold difference unavailable`
    : difference === 0
      ? `${ROLE_LABELS[role]} gold is even`
      : `${difference > 0 ? 'Blue' : 'Red'} ${ROLE_LABELS[role]} leads by ${magnitude.toLocaleString()} gold`;
  return `
    <div class="role-gold-delta ${side}" style="--role-edge: ${edge}%" title="${escapeHtml(title)}">
      <small>${ROLE_LABELS[role]} GOLD Δ</small>
      <strong>${magnitude === null ? '—' : `+${magnitude.toLocaleString()}`}</strong>
      <span class="role-edge-track" aria-hidden="true"><i></i></span>
    </div>`;
}

function roleMatchupRows(blue: LolTeamState, red: LolTeamState): string {
  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  return ROLE_ORDER.map((role, index) => {
    const bluePlayer = bluePlayers[index] ?? null;
    const redPlayer = redPlayers[index] ?? null;
    return `
      <div class="role-matchup-row">
        ${playerIdentityMarkup(bluePlayer, role, 'blue')}
        ${roleGoldDeltaMarkup(bluePlayer, redPlayer, role)}
        ${playerIdentityMarkup(redPlayer, role, 'red')}
      </div>`;
  }).join('');
}

function teamSummaryMarkup(team: LolTeamState, imageUrl?: string): string {
  return `
    <div class="role-team-summary ${team.side}">
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" />` : '<span class="team-placeholder"></span>'}
      <div class="role-team-name"><small>${team.side.toUpperCase()} SIDE</small><strong>${escapeHtml(team.name)}</strong></div>
      <div class="role-team-gold"><small>TOTAL GOLD</small><strong>${formatNumber(team.gold)}</strong></div>
    </div>`;
}

function roleScoreboardMarkup(blue: LolTeamState, red: LolTeamState, blueImageUrl?: string, redImageUrl?: string): string {
  return `
    <section class="role-scoreboard-board">
      <div class="role-team-summary-grid">
        ${teamSummaryMarkup(blue, blueImageUrl)}
        <div class="role-summary-label"><strong>ROLE MATCHUPS</strong><span>Gold difference by position</span></div>
        ${teamSummaryMarkup(red, redImageUrl)}
      </div>
      <div class="role-objective-comparison">
        <div class="role-objectives blue">${objectiveMarkup(blue)}</div>
        <span>OBJECTIVES</span>
        <div class="role-objectives red">${objectiveMarkup(red)}</div>
      </div>
      <div class="role-matchup-list">${roleMatchupRows(blue, red)}</div>
    </section>`;
}'''

    text, count = re.subn(
        r"function playerRows\(team: LolTeamState\): string \{.*?\n\}\n\nfunction teamMarkup\(team: LolTeamState, imageUrl\?: string\): string \{.*?\n\}",
        replacement,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError(f'Expected one player/team markup block, got {count}')

    old = '''    <div class="team-grid">
      ${teamMarkup(stats.blue, blueRef?.imageUrl)}
      ${teamMarkup(stats.red, redRef?.imageUrl)}
    </div>`;'''
    new = '''    ${roleScoreboardMarkup(stats.blue, stats.red, blueRef?.imageUrl, redRef?.imageUrl)}`;'''
    if old not in text:
        raise RuntimeError('Current team grid render block was not found')
    text = text.replace(old, new, 1)

    for marker in ('roleScoreboardMarkup', 'roleGoldDeltaMarkup', 'role-matchup-row'):
        if marker not in text:
            raise RuntimeError(f'Missing scoreboard marker: {marker}')

    MAIN.write_text(text, encoding='utf-8')


def update_styles() -> None:
    text = STYLES.read_text(encoding='utf-8')
    marker = '/* role-gold-scoreboard-redesign */'
    if marker in text:
        raise RuntimeError('Role gold scoreboard CSS already exists')

    text += r'''

/* role-gold-scoreboard-redesign */
.role-scoreboard-board {
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.17);
  border-radius: 16px;
  background:
    radial-gradient(circle at 0 0, rgba(14, 165, 233, 0.08), transparent 34%),
    radial-gradient(circle at 100% 0, rgba(244, 63, 94, 0.08), transparent 34%),
    rgba(6, 12, 24, 0.96);
  box-shadow: 0 20px 52px rgba(0, 0, 0, 0.2);
}

.role-team-summary-grid,
.role-matchup-row,
.role-objective-comparison {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(148px, 0.3fr) minmax(0, 1fr);
  align-items: stretch;
}

.role-team-summary-grid {
  min-height: 78px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.13);
}

.role-team-summary {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  min-width: 0;
  padding: 13px 16px;
}

.role-team-summary.red {
  grid-template-columns: auto minmax(0, 1fr) 42px;
  text-align: right;
}

.role-team-summary.red > img,
.role-team-summary.red > .team-placeholder {
  grid-column: 3;
  grid-row: 1;
}

.role-team-summary.red .role-team-name {
  grid-column: 2;
  grid-row: 1;
}

.role-team-summary.red .role-team-gold {
  grid-column: 1;
  grid-row: 1;
}

.role-team-summary img,
.role-team-summary .team-placeholder {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.045);
}

.role-team-summary.blue {
  background: linear-gradient(90deg, rgba(14, 165, 233, 0.12), transparent 72%);
}

.role-team-summary.red {
  background: linear-gradient(270deg, rgba(244, 63, 94, 0.12), transparent 72%);
}

.role-team-name,
.role-team-gold {
  min-width: 0;
}

.role-team-name small,
.role-team-gold small {
  display: block;
  color: #75849a;
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: 0.1em;
}

.role-team-name strong,
.role-team-gold strong {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: #edf3fb;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-team-name strong { font-size: 0.92rem; }
.role-team-gold strong { font-size: 1rem; }
.role-team-summary.blue .role-team-name small { color: #77ccea; }
.role-team-summary.red .role-team-name small { color: #df8e9f; }

.role-summary-label {
  display: grid;
  place-content: center;
  padding: 10px;
  border-right: 1px solid rgba(148, 163, 184, 0.11);
  border-left: 1px solid rgba(148, 163, 184, 0.11);
  text-align: center;
  background: rgba(2, 6, 23, 0.42);
}

.role-summary-label strong {
  color: #dbe7f5;
  font-size: 0.62rem;
  letter-spacing: 0.12em;
}

.role-summary-label span {
  margin-top: 4px;
  color: #708096;
  font-size: 0.52rem;
}

.role-objective-comparison {
  align-items: center;
  min-height: 56px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(255, 255, 255, 0.012);
}

.role-objective-comparison > span {
  color: #6f8096;
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-align: center;
}

.role-objectives {
  min-width: 0;
  padding: 7px 12px;
}

.role-objectives .objective-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
  margin: 0;
}

.role-objectives .objective-grid > .objective-stat {
  min-height: 38px;
  padding: 5px 3px;
  border-color: rgba(148, 163, 184, 0.07);
  background: rgba(255, 255, 255, 0.014);
}

.role-objectives .objective-icon {
  width: 19px;
  height: 19px;
  flex-basis: 19px;
  opacity: 0.78;
}

.role-objectives .objective-stat strong {
  font-size: 0.8rem;
}

.role-matchup-list {
  display: grid;
}

.role-matchup-row {
  min-height: 88px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.085);
}

.role-matchup-row:last-child {
  border-bottom: 0;
}

.role-player {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 16px;
}

.role-player.blue {
  background: linear-gradient(90deg, rgba(14, 165, 233, 0.055), transparent 82%);
}

.role-player.red {
  grid-template-columns: auto minmax(0, 1fr);
  background: linear-gradient(270deg, rgba(244, 63, 94, 0.055), transparent 82%);
}

.role-player.red .role-player-heading {
  grid-column: 2;
  grid-row: 1;
  flex-direction: row-reverse;
  text-align: right;
}

.role-player.red .role-player-stats {
  grid-column: 1;
  grid-row: 1;
}

.role-player-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  color: #90a1b8;
  background: rgba(148, 163, 184, 0.07);
  font-size: 0.5rem;
  font-weight: 900;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.role-player.blue .role-chip {
  border-color: rgba(56, 189, 248, 0.24);
  color: #8ad9f6;
  background: rgba(14, 165, 233, 0.08);
}

.role-player.red .role-chip {
  border-color: rgba(251, 113, 133, 0.24);
  color: #ee9cac;
  background: rgba(244, 63, 94, 0.08);
}

.role-player-name {
  min-width: 0;
}

.role-player-name strong,
.role-player-name small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-player-name strong {
  color: #e8eef7;
  font-size: 0.78rem;
}

.role-player-name small {
  margin-top: 4px;
  color: #6f8096;
  font-size: 0.55rem;
}

.role-player-stats {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 12px;
  text-align: right;
}

.role-player.red .role-player-stats {
  text-align: left;
}

.role-player-stats span,
.role-player-stats small,
.role-player-stats strong {
  display: block;
}

.role-player-stats small {
  color: #617187;
  font-size: 0.45rem;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.role-player-stats strong {
  margin-top: 4px;
  color: #b8c4d4;
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.role-gold-delta {
  display: grid;
  place-content: center;
  gap: 5px;
  padding: 10px 12px;
  border-right: 1px solid rgba(148, 163, 184, 0.1);
  border-left: 1px solid rgba(148, 163, 184, 0.1);
  text-align: center;
  background: rgba(2, 6, 23, 0.34);
}

.role-gold-delta small {
  color: #66768b;
  font-size: 0.43rem;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.role-gold-delta > strong {
  color: #cbd5e1;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.role-gold-delta.blue > strong { color: #7dd3fc; }
.role-gold-delta.red > strong { color: #fda4af; }

.role-edge-track {
  display: block;
  position: relative;
  width: 112px;
  max-width: 100%;
  height: 5px;
  margin: 1px auto 0;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.12);
}

.role-edge-track::after {
  content: '';
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: 50%;
  width: 1px;
  background: rgba(226, 232, 240, 0.42);
}

.role-edge-track i {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--role-edge);
  border-radius: 999px;
}

.role-gold-delta.blue .role-edge-track i {
  right: 50%;
  background: linear-gradient(90deg, rgba(56, 189, 248, 0.3), #38bdf8);
}

.role-gold-delta.red .role-edge-track i {
  left: 50%;
  background: linear-gradient(90deg, #fb7185, rgba(251, 113, 133, 0.3));
}

.role-gold-delta.even .role-edge-track i,
.role-gold-delta.unknown .role-edge-track i {
  display: none;
}

@media (max-width: 1120px) {
  .role-team-summary-grid,
  .role-matchup-row,
  .role-objective-comparison {
    grid-template-columns: minmax(0, 1fr) 126px minmax(0, 1fr);
  }

  .role-team-summary {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .role-team-summary.red {
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .role-team-summary img,
  .role-team-summary .team-placeholder {
    width: 36px;
    height: 36px;
  }

  .role-team-gold {
    display: none;
  }

  .role-player {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }

  .role-player.red {
    grid-template-columns: minmax(0, 1fr);
  }

  .role-player.red .role-player-heading,
  .role-player.red .role-player-stats {
    grid-column: 1;
  }

  .role-player.red .role-player-heading { grid-row: 1; }
  .role-player.red .role-player-stats { grid-row: 2; }
  .role-player-stats { justify-content: end; }
  .role-player.red .role-player-stats { justify-content: start; }
}

@media (max-width: 720px) {
  .role-team-summary-grid,
  .role-matchup-row,
  .role-objective-comparison {
    grid-template-columns: minmax(0, 1fr) 92px minmax(0, 1fr);
  }

  .role-team-summary,
  .role-player {
    padding-right: 9px;
    padding-left: 9px;
  }

  .role-team-summary img,
  .role-team-summary .team-placeholder {
    display: none;
  }

  .role-team-summary,
  .role-team-summary.red {
    grid-template-columns: minmax(0, 1fr);
  }

  .role-team-summary.red .role-team-name {
    grid-column: 1;
  }

  .role-summary-label span,
  .role-objective-comparison > span,
  .role-player-name small {
    display: none;
  }

  .role-objectives {
    padding: 6px;
  }

  .role-objectives .objective-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .role-objectives .objective-stat:nth-child(4),
  .role-objectives .objective-stat:nth-child(5) {
    display: none;
  }

  .role-player-heading {
    gap: 6px;
  }

  .role-chip {
    min-width: 0;
    min-height: 20px;
    padding: 0 6px;
    font-size: 0.43rem;
  }

  .role-player-stats {
    grid-template-columns: repeat(2, auto);
    gap: 8px;
  }

  .role-player-stats span:nth-child(2) {
    display: none;
  }

  .role-edge-track {
    width: 70px;
  }
}
'''
    STYLES.write_text(text, encoding='utf-8')


def main() -> None:
    update_main()
    update_styles()


if __name__ == '__main__':
    main()
