const DATA_DRAGON_ROOT = 'https://ddragon.leagueoflegends.com';
const DATA_DRAGON_ITEM = /\/cdn\/[^/]+\/img\/item\/(\d+)\.png(?:[?#].*)?$/i;
const DATA_DRAGON_VERSION_FALLBACK = '16.15.1';
const VERSION_TIMEOUT_MS = 3_000;

let versionRequest: Promise<string> | null = null;

function itemId(image: HTMLImageElement): string | null {
  const source = image.getAttribute('src') ?? image.src;
  const match = source.match(DATA_DRAGON_ITEM);
  if (match?.[1]) return match[1];
  const altMatch = image.alt.match(/^Item\s+(\d+)$/i);
  return altMatch?.[1] ?? null;
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

function itemUrl(version: string, id: string): string {
  const url = new URL(`${DATA_DRAGON_ROOT}/cdn/${encodeURIComponent(version)}/img/item/${encodeURIComponent(id)}.png`);
  // A failed opaque image response can be retained by the PWA runtime cache.
  // Give the retry its own cache key so a valid image can recover immediately.
  url.searchParams.set('arena-item-retry', '1');
  return url.toString();
}

function loaded(image: HTMLImageElement): void {
  const slot = image.closest<HTMLElement>('.player-item-slot');
  image.hidden = false;
  slot?.classList.add('image-loaded');
}

function missing(image: HTMLImageElement): void {
  const slot = image.closest<HTMLElement>('.player-item-slot');
  image.hidden = true;
  slot?.classList.remove('image-loaded');
}

async function retryItem(image: HTMLImageElement): Promise<void> {
  if (image.dataset.itemAssetRetried === 'true') {
    missing(image);
    return;
  }
  image.dataset.itemAssetRetried = 'true';

  const id = itemId(image);
  if (!id) {
    missing(image);
    return;
  }

  const version = await latestDataDragonVersion();
  if (!image.isConnected) return;
  missing(image);
  image.src = itemUrl(version, id);
}

function bindImage(image: HTMLImageElement): void {
  if (image.dataset.itemAssetBound === 'true') return;
  image.dataset.itemAssetBound = 'true';
  image.addEventListener('load', () => loaded(image));
  image.addEventListener('error', () => {
    void retryItem(image);
  });

  if (image.complete && image.naturalWidth === 0) {
    void retryItem(image);
  }
}

function scan(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('.player-item-slot img').forEach(bindImage);
}

export function installItemAssets(root: HTMLElement): () => void {
  scan(root);
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.player-item-slot img')) bindImage(node as HTMLImageElement);
        scan(node);
      });
    });
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
