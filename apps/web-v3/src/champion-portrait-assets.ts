const DATA_DRAGON_LOADING_ART = /\/loading\/([^/?#]+)_0\.jpg(?:[?#].*)?$/i;
const DATA_DRAGON_ROOT = 'https://ddragon.leagueoflegends.com';
const DATA_DRAGON_VERSION_FALLBACK = '16.15.1';
const VERSION_TIMEOUT_MS = 3_000;

let versionRequest: Promise<string> | null = null;

function championKey(source: string): string | null {
  const match = source.match(DATA_DRAGON_LOADING_ART);
  if (!match?.[1]) return null;

  try {
    const value = decodeURIComponent(match[1]).replace(/[^a-z0-9]/gi, '');
    return value || null;
  } catch {
    return null;
  }
}

async function latestDataDragonVersion(): Promise<string> {
  if (versionRequest) return versionRequest;
  versionRequest = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), VERSION_TIMEOUT_MS);
    try {
      const response = await fetch(`${DATA_DRAGON_ROOT}/api/versions.json`, {
        cache: 'force-cache',
        signal: controller.signal
      });
      if (!response.ok) return DATA_DRAGON_VERSION_FALLBACK;
      const versions = await response.json() as unknown;
      const latest = Array.isArray(versions) ? versions[0] : null;
      return typeof latest === 'string' && /^\d+\.\d+\.\d+$/.test(latest)
        ? latest
        : DATA_DRAGON_VERSION_FALLBACK;
    } catch {
      return DATA_DRAGON_VERSION_FALLBACK;
    } finally {
      window.clearTimeout(timeout);
    }
  })();
  return versionRequest;
}

function squarePortraitUrl(version: string, key: string): string {
  return `${DATA_DRAGON_ROOT}/cdn/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png`;
}

async function normalizePortrait(image: HTMLImageElement): Promise<void> {
  if (image.dataset.championPortraitNormalized === 'true') return;
  const key = championKey(image.getAttribute('src') ?? image.src);
  if (!key) return;

  image.dataset.championPortraitNormalized = 'true';
  image.dataset.championPortraitSource = 'loading';
  image.decoding = 'async';

  const version = await latestDataDragonVersion();
  if (!image.isConnected) return;
  const source = squarePortraitUrl(version, key);
  const probe = new Image();
  probe.decoding = 'async';
  probe.onload = () => {
    if (!image.isConnected) return;
    image.dataset.championPortraitSource = 'square';
    image.src = source;
  };
  probe.onerror = () => {
    if (!image.isConnected) return;
    image.dataset.championPortraitSource = 'loading-fallback';
  };
  probe.src = source;
}

function scan(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('.champion-portrait img').forEach(image => {
    void normalizePortrait(image);
  });
}

export function installChampionPortraitAssets(root: HTMLElement): () => void {
  scan(root);
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.champion-portrait img')) void normalizePortrait(node as HTMLImageElement);
        scan(node);
      });
    });
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
