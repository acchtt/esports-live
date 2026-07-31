from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path.cwd()
ASSET_ROOT = ROOT / 'apps/web/public/objectives'
ASSET_ROOT.mkdir(parents=True, exist_ok=True)


def fetch_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={'User-Agent': 'esports-live-build/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def listing_names(directory: str) -> list[str]:
    json_url = f'https://raw.communitydragon.org/json/latest/{directory.strip("/")}/'
    try:
        payload = json.loads(fetch_bytes(json_url).decode('utf-8'))
        names: list[str] = []

        def visit(value: object) -> None:
            if isinstance(value, dict):
                name = value.get('name')
                if isinstance(name, str):
                    names.append(name)
                for nested in value.values():
                    visit(nested)
            elif isinstance(value, list):
                for nested in value:
                    visit(nested)

        visit(payload)
        pngs = sorted({name for name in names if name.lower().endswith('.png')})
        if pngs:
            return pngs
    except Exception as error:
        print(f'JSON listing fallback for {directory}: {error}')

    html_url = f'https://raw.communitydragon.org/latest/{directory.strip("/")}/'
    html = fetch_bytes(html_url).decode('utf-8', errors='replace')
    return sorted(set(urllib.parse.unquote(name) for name in re.findall(r'href="([^"]+\.png)"', html, flags=re.I)))


def pick(directory: str, matcher) -> str:
    names = listing_names(directory)
    matches = [name for name in names if matcher(name.lower())]
    if not matches:
        raise RuntimeError(f'No matching Riot asset in {directory}; available={names}')
    matches.sort(key=lambda name: (len(name), name))
    return matches[0]


def download(directory: str, filename: str, destination: str) -> None:
    encoded_name = urllib.parse.quote(filename)
    url = f'https://raw.communitydragon.org/latest/{directory.strip("/")}/{encoded_name}'
    content = fetch_bytes(url)
    if len(content) < 512 or content[:8] != b'\x89PNG\r\n\x1a\n':
        raise RuntimeError(f'Invalid PNG from {url}: {len(content)} bytes')
    (ASSET_ROOT / destination).write_bytes(content)
    print(f'{destination}: {filename} ({len(content)} bytes)')


directories = {
    'tower': 'game/assets/characters/turret/hud',
    'dragon': 'game/assets/characters/sru_dragon/hud',
    'baron': 'game/assets/characters/sru_baron/hud',
    'herald': 'game/assets/characters/sru_riftherald/hud',
    'inhibitor': 'game/assets/characters/inhibitor/hud',
}

tower_blue = pick(directories['tower'], lambda name: 'turret_blue_square' in name)
tower_red = pick(directories['tower'], lambda name: 'turret_red_square' in name)
dragon = pick(directories['dragon'], lambda name: 'dragon_square' in name and all(token not in name for token in ('fire', 'water', 'air', 'earth', 'elder', 'hextech', 'chemtech')))
baron = pick(directories['baron'], lambda name: 'baron_square' in name)
herald = pick(directories['herald'], lambda name: 'square' in name)
inhibitor_blue = pick(directories['inhibitor'], lambda name: 'inhibitor_blue_square' in name)
inhibitor_red = pick(directories['inhibitor'], lambda name: 'inhibitor_red_square' in name)

download(directories['tower'], tower_blue, 'tower-blue.png')
download(directories['tower'], tower_red, 'tower-red.png')
download(directories['dragon'], dragon, 'dragon.png')
download(directories['baron'], baron, 'baron.png')
download(directories['herald'], herald, 'herald.png')
download(directories['inhibitor'], inhibitor_blue, 'inhibitor-blue.png')
download(directories['inhibitor'], inhibitor_red, 'inhibitor-red.png')

(ASSET_ROOT / 'README.md').write_text(
    '# Objective assets\n\n'
    'These images are Riot Games in-client HUD assets extracted and served by CommunityDragon. '
    'They are stored locally so the production UI does not depend on a third-party asset host at runtime.\n',
    encoding='utf-8'
)

main_path = ROOT / 'apps/web/src/main.ts'
main = main_path.read_text(encoding='utf-8')

objective_block = r'''type ObjectiveKind = 'towers' | 'dragons' | 'barons' | 'heralds' | 'inhibitors';

function objectiveAsset(kind: ObjectiveKind, side: LolTeamState['side']): string {
  const assets: Record<ObjectiveKind, string> = {
    towers: `/objectives/tower-${side}.png`,
    dragons: '/objectives/dragon.png',
    barons: '/objectives/baron.png',
    heralds: '/objectives/herald.png',
    inhibitors: `/objectives/inhibitor-${side}.png`
  };
  return assets[kind];
}

function objectiveMarkup(team: LolTeamState): string {
  const objectives = team.objectives;
  const dragonCount = objectives.dragons === null ? null : objectives.dragons.length;
  const dragonList = objectives.dragons?.length
    ? objectives.dragons.map(dragon => String(dragon).replaceAll('_', ' ')).join(', ')
    : null;
  const cell = (kind: ObjectiveKind, label: string, value: number | null, detail?: string | null): string => {
    const formatted = formatNumber(value);
    const title = detail ? `${label}: ${formatted} · ${detail}` : `${label}: ${formatted}`;
    return `
      <div class="objective-stat" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
        <img class="objective-icon" src="${escapeHtml(objectiveAsset(kind, team.side))}" alt="" aria-hidden="true" />
        <strong>${formatted}</strong>
        <span class="sr-only">${escapeHtml(label)}</span>
      </div>`;
  };
  return `
    <div class="objective-grid">
      ${cell('towers', 'Towers', objectives.towers)}
      ${cell('dragons', 'Dragons', dragonCount, dragonList)}
      ${cell('barons', 'Barons', objectives.barons)}
      ${cell('heralds', 'Heralds', objectives.heralds)}
      ${cell('inhibitors', 'Inhibitors', objectives.inhibitors)}
    </div>`;
}
'''

main, count = re.subn(
    r"type ObjectiveKind = 'towers'.*?(?=function playerRows)",
    objective_block + '\n',
    main,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f'Expected one objective block replacement, got {count}')

overview_pattern = re.compile(
    r'''      <div class="team-primary live-team-primary">\n'''
    r'''(?P<primary>.*?)'''
    r'''      </div>\n'''
    r'''      \$\{objectiveMarkup\(team\)\}\n''',
    flags=re.S,
)
match = overview_pattern.search(main)
if not match:
    raise RuntimeError('Team primary/objective markup was not found')
replacement = (
    '      <div class="team-overview">\n'
    '        <div class="team-primary live-team-primary">\n'
    f'{match.group("primary")}'
    '        </div>\n'
    '        ${objectiveMarkup(team)}\n'
    '      </div>\n'
)
main = main[:match.start()] + replacement + main[match.end():]
main_path.write_text(main, encoding='utf-8')

styles_path = ROOT / 'apps/web/src/styles.css'
styles = styles_path.read_text(encoding='utf-8')
marker = '/* merged-team-board-official-objectives */'
if marker in styles:
    styles = styles[:styles.index(marker)].rstrip() + '\n'

styles += r'''

/* merged-team-board-official-objectives */
.team-grid {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 16px;
  background: rgba(8, 14, 27, 0.94);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.16);
}

.team-grid .team-card {
  border: 0 !important;
  border-radius: 0;
  background: transparent !important;
  box-shadow: none !important;
}

.team-grid .team-card.blue {
  background:
    radial-gradient(circle at 0% 0%, rgba(56, 189, 248, 0.075), transparent 47%),
    linear-gradient(135deg, rgba(15, 38, 56, 0.28), rgba(9, 16, 31, 0.12) 58%) !important;
  box-shadow: inset 3px 0 0 rgba(56, 189, 248, 0.48) !important;
}

.team-grid .team-card.red {
  border-left: 1px solid rgba(148, 163, 184, 0.13) !important;
  background:
    radial-gradient(circle at 100% 0%, rgba(251, 113, 133, 0.07), transparent 47%),
    linear-gradient(225deg, rgba(57, 23, 36, 0.25), rgba(9, 16, 31, 0.12) 58%) !important;
  box-shadow: inset -3px 0 0 rgba(251, 113, 133, 0.45) !important;
}

.team-card.blue .team-heading small,
.team-card.blue .team-primary span {
  color: #82b8cd;
}

.team-card.red .team-heading small,
.team-card.red .team-primary span {
  color: #c497a1;
}

.team-overview {
  display: grid;
  grid-template-columns: minmax(132px, 0.82fr) minmax(220px, 1.5fr);
  gap: 8px;
  margin-top: 14px;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.09);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.018);
}

.team-overview .live-team-primary,
.team-overview .objective-grid {
  margin-top: 0;
}

.team-overview .live-team-primary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.team-overview .live-team-primary > div,
.team-overview .objective-grid > .objective-stat {
  min-height: 46px;
  border-color: rgba(148, 163, 184, 0.085);
  background: rgba(255, 255, 255, 0.018);
}

.team-overview .live-team-primary > div {
  padding: 8px 9px;
}

.team-overview .live-team-primary strong {
  font-size: 1rem;
}

.team-overview .objective-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
}

.team-overview .objective-grid > .objective-stat {
  gap: 4px;
  min-width: 0;
  padding: 5px 3px;
}

.team-overview .objective-icon {
  width: 23px;
  height: 23px;
  flex: 0 0 23px;
  object-fit: contain;
  opacity: 0.9;
  filter: none !important;
}

.team-overview .objective-stat strong {
  font-size: 0.84rem;
}

.team-grid .team-card.blue .telemetry-player-board,
.team-grid .team-card.red .telemetry-player-board {
  border-left-color: rgba(148, 163, 184, 0.2) !important;
  background: rgba(2, 6, 23, 0.17);
}

.team-grid .team-card.blue .telemetry-player-board {
  border-left-color: rgba(56, 189, 248, 0.28) !important;
}

.team-grid .team-card.red .telemetry-player-board {
  border-left-color: rgba(251, 113, 133, 0.26) !important;
}

@container (max-width: 420px) {
  .team-overview {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 860px) {
  .team-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .team-grid .team-card.red {
    border-top: 1px solid rgba(148, 163, 184, 0.13) !important;
    border-left: 0 !important;
    box-shadow: inset 3px 0 0 rgba(251, 113, 133, 0.4) !important;
  }
}
'''
styles_path.write_text(styles, encoding='utf-8')
