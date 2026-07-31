from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'apps/web/src/main.ts'
STYLES = ROOT / 'apps/web/src/styles.css'
PLAYER_BOARD = ROOT / 'apps/web/src/player-board-view.ts'


def update_main() -> None:
    text = MAIN.read_text(encoding='utf-8')

    replacement = r'''function matchTeamHeaderMarkup(team: LolTeamState, imageUrl?: string): string {
  return `
    <div class="role-match-team ${team.side}">
      ${imageUrl
        ? `<img class="role-match-team-logo" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(team.name)} logo" />`
        : '<span class="role-match-team-logo team-placeholder" aria-hidden="true"></span>'}
      <div class="role-match-team-copy">
        <small>${team.side.toUpperCase()} SIDE</small>
        <strong>${escapeHtml(team.name)}</strong>
      </div>
      <div class="role-match-team-metrics">
        <span><small>KILLS</small><strong>${formatNumber(team.kills)}</strong></span>
        <span><small>TOTAL GOLD</small><strong>${formatNumber(team.gold)}</strong></span>
      </div>
    </div>`;
}

function roleScoreboardMarkup(
  blue: LolTeamState,
  red: LolTeamState,
  gameNumber: number,
  gameClockSeconds: number | null,
  patch: string | null,
  goldLeadClass: string,
  goldLeader: string,
  blueImageUrl?: string,
  redImageUrl?: string
): string {
  return `
    <section class="role-scoreboard-board">
      <div class="role-match-header">
        ${matchTeamHeaderMarkup(blue, blueImageUrl)}
        <div class="role-match-clock">
          <small>GAME ${gameNumber} · TELEMETRY TIME</small>
          <strong id="live-game-clock" title="Game time of this telemetry snapshot">${formatClock(gameClockSeconds)}</strong>
          <span class="patch-label">${escapeHtml(publicPatchLabel(patch))}</span>
          <em class="gold-lead ${goldLeadClass}">${escapeHtml(goldLeader)}</em>
        </div>
        ${matchTeamHeaderMarkup(red, redImageUrl)}
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
        r"function teamSummaryMarkup\(team: LolTeamState, imageUrl\?: string\): string \{.*?\n\}\n\nfunction roleScoreboardMarkup\(blue: LolTeamState, red: LolTeamState, blueImageUrl\?: string, redImageUrl\?: string\): string \{.*?\n\}",
        replacement,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError(f'Expected one duplicated scoreboard header block, got {count}')

    render_replacement = r'''  gameContent.innerHTML = roleScoreboardMarkup(
    stats.blue,
    stats.red,
    snapshot.game.number,
    stats.gameClockSeconds,
    stats.patch ?? null,
    goldLeadClass,
    goldLeader,
    blueRef?.imageUrl,
    redRef?.imageUrl
  );'''

    text, count = re.subn(
        r'''  gameContent\.innerHTML = `\n    <div class="scoreboard">.*?\n    \$\{roleScoreboardMarkup\(stats\.blue, stats\.red, blueRef\?\.imageUrl, redRef\?\.imageUrl\)\}`;''',
        render_replacement,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError(f'Expected one top scoreboard render block, got {count}')

    for marker in ('role-match-header', 'role-match-team-metrics', 'role-match-clock'):
        if marker not in text:
            raise RuntimeError(f'Missing merged header marker: {marker}')
    if '<div class="scoreboard">' in text:
        raise RuntimeError('Legacy standalone scoreboard markup remains')

    MAIN.write_text(text, encoding='utf-8')


def update_styles() -> None:
    text = STYLES.read_text(encoding='utf-8')
    marker = '/* merged-live-match-header */'
    if marker in text:
        raise RuntimeError('Merged header CSS already exists')

    text += r'''

/* merged-live-match-header */
.role-scoreboard-board {
  margin-top: 0;
}

.role-match-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(178px, auto) minmax(0, 1fr);
  align-items: stretch;
  min-height: 108px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.13);
  background:
    linear-gradient(90deg, rgba(14, 165, 233, 0.07), transparent 34%),
    linear-gradient(270deg, rgba(244, 63, 94, 0.07), transparent 34%),
    rgba(3, 8, 18, 0.52);
}

.role-match-team {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 16px 18px;
}

.role-match-team.red {
  grid-template-columns: auto minmax(0, 1fr) 46px;
  text-align: right;
}

.role-match-team.red .role-match-team-logo {
  grid-column: 3;
  grid-row: 1;
}

.role-match-team.red .role-match-team-copy {
  grid-column: 2;
  grid-row: 1;
}

.role-match-team.red .role-match-team-metrics {
  grid-column: 1;
  grid-row: 1;
}

.role-match-team-logo {
  width: 46px;
  height: 46px;
  border: 0;
  border-radius: 10px;
  object-fit: contain;
  background: rgba(255, 255, 255, 0.025);
}

.role-match-team-copy,
.role-match-team-metrics {
  min-width: 0;
}

.role-match-team-copy small,
.role-match-team-metrics small,
.role-match-clock > small {
  display: block;
  color: #728096;
  font-size: 0.49rem;
  font-weight: 900;
  letter-spacing: 0.1em;
}

.role-match-team.blue .role-match-team-copy small { color: #72c7e7; }
.role-match-team.red .role-match-team-copy small { color: #df8e9f; }

.role-match-team-copy strong {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: #edf3fb;
  font-size: 0.95rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.role-match-team-metrics {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 16px;
  text-align: right;
}

.role-match-team.red .role-match-team-metrics {
  text-align: left;
}

.role-match-team-metrics span,
.role-match-team-metrics strong {
  display: block;
}

.role-match-team-metrics strong {
  margin-top: 4px;
  color: #dce7f5;
  font-size: 0.94rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.role-match-clock {
  display: grid;
  place-content: center;
  place-items: center;
  gap: 3px;
  min-width: 178px;
  padding: 12px 16px;
  border-right: 1px solid rgba(148, 163, 184, 0.11);
  border-left: 1px solid rgba(148, 163, 184, 0.11);
  text-align: center;
  background: rgba(2, 6, 23, 0.46);
}

.role-match-clock > strong {
  color: #f3f7fc;
  font-size: 1.7rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.role-match-clock .patch-label {
  color: #65758b;
  font-size: 0.58rem;
}

.role-match-clock .gold-lead {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 25px;
  margin-top: 2px;
  padding: 0 10px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 999px;
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.06);
  font-size: 0.59rem;
  font-style: normal;
  font-weight: 850;
  white-space: nowrap;
}

.role-match-clock .gold-lead.blue {
  border-color: rgba(56, 189, 248, 0.22);
  color: #8ddbf7;
  background: rgba(14, 165, 233, 0.07);
}

.role-match-clock .gold-lead.red {
  border-color: rgba(251, 113, 133, 0.22);
  color: #f1a0af;
  background: rgba(244, 63, 94, 0.07);
}

.role-match-clock .gold-lead.even,
.role-match-clock .gold-lead.unknown {
  color: #b8c4d4;
}

@media (max-width: 1320px) {
  .role-match-header {
    grid-template-columns: minmax(0, 1fr) 150px minmax(0, 1fr);
  }

  .role-match-team,
  .role-match-team.red {
    grid-template-columns: 38px minmax(0, 1fr);
    gap: 9px;
    padding: 13px 12px;
  }

  .role-match-team.red {
    grid-template-columns: minmax(0, 1fr) 38px;
  }

  .role-match-team.red .role-match-team-logo { grid-column: 2; }
  .role-match-team.red .role-match-team-copy { grid-column: 1; }

  .role-match-team-logo {
    width: 38px;
    height: 38px;
  }

  .role-match-team-metrics,
  .role-match-team.red .role-match-team-metrics {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: start;
    text-align: left;
  }

  .role-match-team.red .role-match-team-metrics {
    justify-content: end;
    text-align: right;
  }

  .role-match-clock {
    min-width: 150px;
    padding-right: 10px;
    padding-left: 10px;
  }
}

@media (max-width: 720px) {
  .role-match-header {
    grid-template-columns: minmax(0, 1fr) 94px minmax(0, 1fr);
    min-height: 94px;
  }

  .role-match-team,
  .role-match-team.red {
    display: block;
    padding: 11px 8px;
  }

  .role-match-team-logo {
    display: none;
  }

  .role-match-team-copy strong {
    font-size: 0.76rem;
  }

  .role-match-team-metrics {
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    margin-top: 8px;
    text-align: left;
  }

  .role-match-team.red .role-match-team-metrics {
    text-align: right;
  }

  .role-match-team-metrics span:first-child {
    display: none;
  }

  .role-match-team-metrics strong {
    font-size: 0.76rem;
  }

  .role-match-clock {
    min-width: 94px;
    padding: 8px 5px;
  }

  .role-match-clock > small {
    font-size: 0.4rem;
  }

  .role-match-clock > strong {
    font-size: 1.28rem;
  }

  .role-match-clock .gold-lead {
    max-width: 88px;
    min-height: 22px;
    padding: 0 6px;
    overflow: hidden;
    font-size: 0.48rem;
    text-overflow: ellipsis;
  }
}
'''

    STYLES.write_text(text, encoding='utf-8')


def update_player_board() -> None:
    text = PLAYER_BOARD.read_text(encoding='utf-8')
    old = "document.querySelector<HTMLElement>('.scoreboard .patch-label')"
    new = "document.querySelector<HTMLElement>('.role-match-clock .patch-label')"
    if old not in text:
        raise RuntimeError('Legacy patch-label selector was not found')
    PLAYER_BOARD.write_text(text.replace(old, new, 1), encoding='utf-8')


if __name__ == '__main__':
    update_main()
    update_styles()
    update_player_board()
