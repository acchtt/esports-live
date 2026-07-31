from __future__ import annotations

import re
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'apps/web/src/main.ts'
STYLES = ROOT / 'apps/web/src/styles.css'
PUBLIC_OBJECTIVES = ROOT / 'apps/web/public/objectives'
ASSET_OBJECTIVES = ROOT / 'apps/web/src/assets/objectives'
ATLAS = Path('/tmp/scoreboardatlas.png')
HERALD = Path('/tmp/riftherald.png')

COMPONENTS = {
    'tower.png': (1676, 16, 1724, 64),
    'dragon.png': (1726, 15, 1774, 63),
    'baron.png': (1780, 16, 1828, 61),
    'inhibitor.png': (1838, 15, 1870, 63),
}


def centered_icon(source: Image.Image, box: tuple[int, int, int, int], max_size: int = 48) -> Image.Image:
    crop = source.crop(box).convert('RGBA')
    alpha_box = crop.getchannel('A').getbbox()
    if alpha_box is None:
        raise RuntimeError(f'Empty objective component at {box}')
    crop = crop.crop(alpha_box)
    scale = min(1.0, max_size / max(crop.size))
    if scale < 1.0:
        crop = crop.resize(
            (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
            Image.Resampling.LANCZOS,
        )
    canvas = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((64 - crop.width) // 2, (64 - crop.height) // 2))
    bbox = canvas.getchannel('A').getbbox()
    if bbox is None or bbox[0] < 6 or bbox[1] < 6 or bbox[2] > 58 or bbox[3] > 58:
        raise RuntimeError(f'Unsafe objective bounds after centering: {box} -> {bbox}')
    return canvas


def write_assets() -> None:
    if not ATLAS.exists() or not HERALD.exists():
        raise RuntimeError('Downloaded Riot scoreboard sources are missing')

    atlas = Image.open(ATLAS).convert('RGBA')
    ASSET_OBJECTIVES.mkdir(parents=True, exist_ok=True)
    for name, box in COMPONENTS.items():
        centered_icon(atlas, box).save(ASSET_OBJECTIVES / name, optimize=True)

    herald_source = Image.open(HERALD).convert('RGBA')
    herald_box = herald_source.getchannel('A').getbbox()
    if herald_box is None:
        raise RuntimeError('Rift Herald scoreboard asset is empty')
    centered_icon(herald_source, herald_box).save(ASSET_OBJECTIVES / 'herald.png', optimize=True)

    (ASSET_OBJECTIVES / 'README.md').write_text(
        '# Objective assets\n\n'
        'Riot scoreboard/broadcast objective glyphs sourced through CommunityDragon. '
        'Tower, dragon, Baron, and inhibitor are isolated connected components from '
        '`scoreboardatlas.png`; Rift Herald uses Riot\'s `_riftherald.png`. The web build '
        'imports these files through Vite so production uses fingerprinted asset URLs.\n',
        encoding='utf-8',
    )

    shutil.rmtree(PUBLIC_OBJECTIVES, ignore_errors=True)


def update_main() -> None:
    text = MAIN.read_text(encoding='utf-8')
    replacement = '''const OBJECTIVE_ASSETS: Record<ObjectiveKind, string> = {
  towers: new URL('./assets/objectives/tower.png', import.meta.url).href,
  dragons: new URL('./assets/objectives/dragon.png', import.meta.url).href,
  barons: new URL('./assets/objectives/baron.png', import.meta.url).href,
  heralds: new URL('./assets/objectives/herald.png', import.meta.url).href,
  inhibitors: new URL('./assets/objectives/inhibitor.png', import.meta.url).href
};

function objectiveAsset(kind: ObjectiveKind): string {
  return OBJECTIVE_ASSETS[kind];
}'''
    text, count = re.subn(
        r"function objectiveAsset\(kind: ObjectiveKind\): string \{.*?\n\}",
        replacement,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise RuntimeError(f'Expected one objectiveAsset replacement, got {count}')

    old = '<img class="objective-icon" src="${escapeHtml(objectiveAsset(kind))}" alt="" aria-hidden="true" />'
    new = '<img class="objective-icon" src="${escapeHtml(objectiveAsset(kind))}" alt="" width="24" height="24" decoding="async" aria-hidden="true" />'
    if old not in text:
        raise RuntimeError('Objective image markup was not found')
    text = text.replace(old, new, 1)
    if "'/objectives/" in text or '"/objectives/' in text:
        raise RuntimeError('Absolute public objective paths remain in main.ts')
    MAIN.write_text(text, encoding='utf-8')


def update_styles() -> None:
    text = STYLES.read_text(encoding='utf-8')
    text = text.replace(
        '.objective-icon {\n  display: grid;',
        '.objective-icon {\n  display: block;',
        1,
    )
    marker = '.team-overview img.objective-icon {'
    if marker not in text:
        text += '''\n\n/* fingerprinted-objective-icon-fix */
.team-overview img.objective-icon {
  display: block;
  max-width: 23px;
  max-height: 23px;
  object-fit: contain;
  object-position: center;
}
'''
    STYLES.write_text(text, encoding='utf-8')


def cleanup_branch_noise() -> None:
    for name in ('tmp', 'tmp2', 'tmp3', 'tmp4', 'tmp5'):
        (ROOT / name).unlink(missing_ok=True)


def main() -> None:
    write_assets()
    update_main()
    update_styles()
    cleanup_branch_noise()


if __name__ == '__main__':
    main()
