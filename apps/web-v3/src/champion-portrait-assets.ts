const DATA_DRAGON_LOADING_ART = /\/loading\/([^/?#]+)_0\.jpg(?:[?#].*)?$/i;
const DATA_DRAGON_ROOT = 'https://ddragon.leagueoflegends.com';
const DATA_DRAGON_VERSION_FALLBACK = '16.15.1';
const DATA_DRAGON_VERSION_STORAGE_KEY = 'arena-v3-ddragon-version';
const VERSION_TIMEOUT_MS = 3_000;
const VERSION_REFRESH_DELAY_MS = 1_200;

let versionRequest: Promise<string> | null = null;
let versionRefreshTimer: number | null = null;

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

function rememberedDataDragonVersion(): string | null {
  try {
    const value = localStorage.getItem(DATA_DRAGON_VERSION_STORAGE_KEY);
    return value && /^\d+\.\d+\.\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function rememberDataDragonVersion(version: string): void {
  try {
    localStorage.setItem(DATA_DRAGON_VERSION_STORAGE_KEY, version);
  } catch {
    // Storage is optional; the fallback version still keeps portraits usable.
  }
}

async function latestDataDragonVersion(): Promise<string> {
  if (versionRequest) return versionRequest;
  versionRequest = (async () => {
    const fallback = rememberedDataDragonVersion() ?? DATA_DRAGON_VERSION_FALLBACK;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), VERSION_TIMEOUT_MS);
    try {
      const response = await fetch(`${DATA_DRAGON_ROOT}/api/versions.json`, {
        cache: 'force-cache',
        signal: controller.signal
      });
      if (!response.ok) return fallback;
      const versions = await response.json() as unknown;
      const latest = Array.isArray(versions) ? versions[0] : null;
      if (typeof latest !== 'string' || !/^\d+\.\d+\.\d+$/.test(latest)) return fallback;
      rememberDataDragonVersion(latest);
      return latest;
    } catch {
      return fallback;
    } finally {
      window.clearTimeout(timeout);
    }
  })();
  return versionRequest;
}

function scheduleVersionRefresh(): void {
  if (versionRequest || versionRefreshTimer !== null) return;
  versionRefreshTimer = window.setTimeout(() => {
    versionRefreshTimer = null;
    void latestDataDragonVersion();
  }, VERSION_REFRESH_DELAY_MS);
}

function squarePortraitUrl(version: string, key: string): string {
  return `${DATA_DRAGON_ROOT}/cdn/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png`;
}

function prioritizePortrait(image: HTMLImageElement): void {
  image.loading = 'eager';
  image.decoding = 'async';
  image.setAttribute('fetchpriority', 'high');
}

function normalizePortrait(image: HTMLImageElement): void {
  prioritizePortrait(image);
  if (image.dataset.championPortraitNormalized === 'true') return;

  const originalSource = image.getAttribute('src') ?? image.src;
  const key = championKey(originalSource);
  if (!key) return;

  // Clone the renderer-owned image so the controller owns retry/fallback behavior.
  // Event listeners are not copied by cloneNode, which prevents the renderer's
  // generic error handler from removing the portrait before a retry can happen.
  const replacement = image.cloneNode(false) as HTMLImageElement;
  prioritizePortrait(replacement);
  replacement.dataset.championPortraitNormalized = 'true';

  let attemptedVersion = rememberedDataDragonVersion() ?? DATA_DRAGON_VERSION_FALLBACK;
  replacement.dataset.championPortraitSource = 'square-immediate';

  replacement.addEventListener('load', () => {
    if (replacement.dataset.championPortraitSource !== 'loading-fallback') {
      replacement.dataset.championPortraitSource = 'square';
    }
  });

  replacement.addEventListener('error', () => {
    void (async () => {
      if (!replacement.isConnected) return;
      const latest = await latestDataDragonVersion();
      if (!replacement.isConnected) return;

      if (latest !== attemptedVersion) {
        attemptedVersion = latest;
        replacement.dataset.championPortraitSource = 'square-retry';
        replacement.src = squarePortraitUrl(latest, key);
        return;
      }

      if (replacement.dataset.championPortraitSource !== 'loading-fallback') {
        replacement.dataset.championPortraitSource = 'loading-fallback';
        replacement.removeAttribute('fetchpriority');
        replacement.src = originalSource;
        return;
      }

      replacement.remove();
    })();
  });

  replacement.src = squarePortraitUrl(attemptedVersion, key);
  image.replaceWith(replacement);
  scheduleVersionRefresh();
}

function scan(root: ParentNode): void {
  root.querySelectorAll<HTMLImageElement>('.champion-portrait img').forEach(image => {
    normalizePortrait(image);
  });
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
  return () => {
    observer.disconnect();
    if (versionRefreshTimer !== null) {
      window.clearTimeout(versionRefreshTimer);
      versionRefreshTimer = null;
    }
  };
}
