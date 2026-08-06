const DATA_DRAGON_LOADING_ART = /\/loading\/([^/?#]+)_0\.jpg(?:[?#].*)?$/i;
const COMMUNITY_DRAGON_ROOT = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/characters';

function squarePortraitUrl(source: string): string | null {
  const match = source.match(DATA_DRAGON_LOADING_ART);
  if (!match?.[1]) return null;

  let championKey = match[1];
  try {
    championKey = decodeURIComponent(championKey);
  } catch {
    return null;
  }

  const slug = championKey.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!slug) return null;
  return `${COMMUNITY_DRAGON_ROOT}/${encodeURIComponent(slug)}/hud/${encodeURIComponent(slug)}_square.png`;
}

function normalizePortrait(image: HTMLImageElement): void {
  if (image.dataset.championPortraitNormalized === 'true') return;
  const squareSource = squarePortraitUrl(image.getAttribute('src') ?? image.src);
  if (!squareSource) return;

  image.dataset.championPortraitNormalized = 'true';
  image.dataset.championPortraitSource = 'square';
  image.decoding = 'async';
  image.src = squareSource;
  image.addEventListener('error', () => {
    image.dataset.championPortraitSource = 'fallback';
    image.remove();
  }, { once: true });
}

function scan(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('.champion-portrait img').forEach(normalizePortrait);
}

export function installChampionPortraitAssets(root: HTMLElement): () => void {
  scan(root);
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.champion-portrait img')) normalizePortrait(node as HTMLImageElement);
        scan(node);
      });
    });
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
