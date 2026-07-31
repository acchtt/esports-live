from __future__ import annotations

import re
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'apps/web/src/main.ts'
STYLES = ROOT / 'apps/web/src/styles.css'
PLAYER_BOARD = ROOT / 'apps/web/src/player-board-view.ts'
SOURCE = ROOT / 'apps/web/public/objectives-scoreboard-source'
DESTINATION = ROOT / 'apps/web/public/objectives'


def replace_once(text: str, pattern: str, replacement: str, *, flags: int = 0, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f'{label}: expected one replacement, got {count}')
    return updated


def extract_scoreboard_icons() -> None:
    atlas_path = SOURCE / 'scoreboardatlas.png'
    herald_path = SOURCE / 'herald.png'
    if not atlas_path.exists() or not herald_path.exists():
        raise RuntimeError('Scoreboard source assets are missing')

    DESTINATION.mkdir(parents=True, exist_ok=True)
    atlas = Image.open(atlas_path).convert('RGBA')
    tile_size = 64
    coordinates = {
        'tower.png': (26, 0),
        'dragon.png': (27, 0),
        'baron.png': (28, 0),
        'inhibitor.png': (29, 0),
    }
    for filename, (column, row) in coordinates.items():
        left = column * tile_size
        top = row * tile_size
        icon = atlas.crop((left, top, left + tile_size, top + tile_size))
        if icon.getchannel('A').getbbox() is None:
            raise RuntimeError(f'Atlas tile {row}:{column} for {filename} is empty')
        icon.save(DESTINATION / filename)

    Image.open(herald_path).convert('RGBA').save(DESTINATION / 'herald.png')

    for obsolete in (
        'tower-blue.png',
        'tower-red.png',
        'inhibitor-blue.png',
        'inhibitor-red.png',
    ):
        (DESTINATION / obsolete).unlink(missing_ok=True)

    (DESTINATION / 'README.md').write_text(
        '# Objective assets\n\n'
        'These are Riot Games scoreboard/spectator UI assets sourced through CommunityDragon. '
        'Tower, dragon, Baron, and inhibitor are extracted from the official scoreboard atlas '
        '(tiles 0:26 through 0:29). Rift Herald uses the official scoreboard `_riftherald` asset. '
        'They are bundled locally so production does not depend on a third-party host at runtime.\n',
        encoding='utf-8',
    )


def update_main() -> None:
    text = MAIN.read_text(encoding='utf-8')
    objective_asset = '''function objectiveAsset(kind: ObjectiveKind): string {
  const assets: Record<ObjectiveKind, string> = {
    towers: '/objectives/tower.png',
    dragons: '/objectives/dragon.png',
    barons: '/objectives/baron.png',
    heralds: '/objectives/herald.png',
    inhibitors: '/objectives/inhibitor.png'
  };
  return assets[kind];
}'''
    text = replace_once(
        text,
        r"function objectiveAsset\(kind: ObjectiveKind, side: LolTeamState\['side'\]\): string \{.*?\n\}",
        objective_asset,
        flags=re.S,
        label='objective asset map',
    )
    text = text.replace(
        'objectiveAsset(kind, team.side)',
        'objectiveAsset(kind)',
    )

    team_markup = '''function teamMarkup(team: LolTeamState, imageUrl?: string): string {
  return `
    <section class="team-card ${team.side}">
      <div class="team-heading">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" />` : '<span class="team-placeholder"></span>'}
        <div><small>${team.side.toUpperCase()} SIDE</small><h3>${escapeHtml(team.name)}</h3></div>
      </div>
      <div class="team-overview">
        <div class="team-primary live-team-primary">
          <div><span>Total gold</span><strong>${formatNumber(team.gold)}</strong></div>
        </div>
        ${objectiveMarkup(team)}
      </div>
      <div class="player-list">${playerRows(team)}</div>
    </section>`;
}

'''
    text = replace_once(
        text,
        r'function teamMarkup\(.*?\n\}\n\n(?=function renderSnapshot)',
        team_markup,
        flags=re.S,
        label='team markup',
    )
    text = text.replace(
        'teamMarkup(stats.blue, stats.red.gold, blueRef?.imageUrl)',
        'teamMarkup(stats.blue, blueRef?.imageUrl)',
    ).replace(
        'teamMarkup(stats.red, stats.blue.gold, redRef?.imageUrl)',
        'teamMarkup(stats.red, redRef?.imageUrl)',
    )
    MAIN.write_text(text, encoding='utf-8')


def update_styles() -> None:
    text = STYLES.read_text(encoding='utf-8')
    text = text.replace(
        'grid-template-columns: minmax(132px, 0.82fr) minmax(220px, 1.5fr);',
        'grid-template-columns: minmax(104px, 0.42fr) minmax(240px, 1.9fr);',
    )
    text = replace_once(
        text,
        r'(\.team-overview \.live-team-primary \{\n)  grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);',
        r'\1  grid-template-columns: minmax(0, 1fr);',
        label='team overview primary columns',
    )
    text = text.replace(
        '  opacity: 0.9;\n  filter: none !important;',
        '  opacity: 0.82;\n  filter: none !important;',
    )
    STYLES.write_text(text, encoding='utf-8')


def update_player_board() -> None:
    text = PLAYER_BOARD.read_text(encoding='utf-8')
    text = replace_once(
        text,
        r'(  \.telemetry-champion \{.*?\n)    border: 1px solid rgba\(148, 163, 184, 0\.16\);\n    border-radius: 8px;\n    background: rgba\(15, 23, 42, 0\.92\);',
        r'\1    border: 0;\n    border-radius: 7px;\n    background: transparent;\n    box-shadow: none;',
        flags=re.S,
        label='champion portrait border',
    )
    PLAYER_BOARD.write_text(text, encoding='utf-8')


def cleanup_temporary_files() -> None:
    shutil.rmtree(SOURCE, ignore_errors=True)
    (ROOT / 'broadcast-objective-asset-report.txt').unlink(missing_ok=True)
    (ROOT / '.github/workflows/inspect-scoreboard-atlas.yml').unlink(missing_ok=True)


def main() -> None:
    extract_scoreboard_icons()
    update_main()
    update_styles()
    update_player_board()
    cleanup_temporary_files()


if __name__ == '__main__':
    main()
