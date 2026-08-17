import type { TeamRef } from '@esports-live/core';
import { readScheduleCache } from './schedule-cache.ts';

const EAGER_CARD_COUNT = 6;
const PREWARM_EVENT_COUNT = 10;
const RUNTIME_IMAGE_CACHE = 'arena-v3-runtime-images-v1';
const MAX_RUNTIME_IMAGES = 180;

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function secureAssetUrl(value: string | null | undefined): string {
  const source = String(value ?? '').trim();
  if (!source) return '';
  try {
    const url = new URL(source, window.location.href);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.href;
  } catch {
    return source;
  }
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, window.location.href);
  if (input instanceof URL) return new URL(input.href);
  return new URL(input.url, window.location.href);
}

function isSchedulePath(pathname: string): boolean {
  return pathname.endsWith('/v1/lol/schedule');
}

function teamKeys(team: TeamRef): readonly string[] {
  return [team.id, team.name, team.code]
    .map(normalized)
    .filter(Boolean);
}

function directTeamName(side: HTMLElement): string {
  const label = [...side.children].find(child => child instanceof HTMLElement && child.tagName === 'SPAN');
  return label instanceof HTMLElement ? label.textContent?.trim() ?? '' : '';
}

export function installCatalogueTeamLogos(root: HTMLElement): () => void {
  const nativeFetch = window.fetch.bind(window);
  const logos = new Map<string, { name: string; imageUrl: string }>();
  const prewarmed = new Set<string>();
  const warming = new Map<string, HTMLImageElement>();
  const cacheWrites = new Map<string, Promise<void>>();
  let syncQueued = false;

  const trimRuntimeImages = async (cache: Cache): Promise<void> => {
    const keys = await cache.keys();
    const overflow = keys.length - MAX_RUNTIME_IMAGES;
    if (overflow <= 0) return;
    await Promise.all(keys.slice(0, overflow).map(request => cache.delete(request)));
  };

  const cacheLogo = (imageUrl: string): void => {
    if (!('caches' in window) || cacheWrites.has(imageUrl)) return;

    let asset: URL;
    try {
      asset = new URL(imageUrl, window.location.href);
    } catch {
      return;
    }
    if (asset.protocol !== 'https:' && asset.protocol !== 'http:') return;

    const work = (async () => {
      const cache = await window.caches.open(RUNTIME_IMAGE_CACHE);
      if (await cache.match(asset.href, { ignoreVary: true })) return;

      const request = new Request(asset.href, {
        method: 'GET',
        mode: asset.origin === window.location.origin ? 'same-origin' : 'no-cors',
        credentials: 'omit',
        cache: 'force-cache'
      });
      const response = await nativeFetch(request);
      if (!response.ok && response.type !== 'opaque') return;

      await cache.put(request, response.clone());
      await trimRuntimeImages(cache);
    })()
      .catch(() => undefined)
      .finally(() => cacheWrites.delete(imageUrl));

    cacheWrites.set(imageUrl, work);
  };

  const prewarmLogo = (imageUrl: string, highPriority: boolean): void => {
    if (!imageUrl || prewarmed.has(imageUrl)) return;
    prewarmed.add(imageUrl);

    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    image.setAttribute('fetchpriority', highPriority ? 'high' : 'auto');
    const release = () => warming.delete(imageUrl);
    image.addEventListener('load', () => {
      cacheLogo(imageUrl);
      release();
    }, { once: true });
    image.addEventListener('error', release, { once: true });
    warming.set(imageUrl, image);
    image.src = imageUrl;
  };

  const rememberTeam = (team: TeamRef): void => {
    const imageUrl = secureAssetUrl(team.imageUrl);
    if (!imageUrl) return;
    const value = { name: team.name, imageUrl };
    teamKeys(team).forEach(key => logos.set(key, value));
  };

  const rememberScheduleTeams = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const payload = value as { events?: readonly { series?: { teams?: readonly TeamRef[] } }[] };
    payload.events?.forEach((event, eventIndex) => {
      event.series?.teams?.forEach(team => {
        rememberTeam(team);
        const imageUrl = secureAssetUrl(team.imageUrl);
        if (imageUrl && eventIndex < PREWARM_EVENT_COUNT) {
          prewarmLogo(imageUrl, eventIndex < EAGER_CARD_COUNT);
        }
      });
    });
    queueSync();
  };

  const logoForName = (name: string): { name: string; imageUrl: string } | null => {
    const key = normalized(name);
    return key ? logos.get(key) ?? null : null;
  };

  const decorateSide = (side: HTMLElement, eager: boolean): void => {
    const name = directTeamName(side);
    const logo = logoForName(name);
    let image = side.querySelector<HTMLImageElement>(':scope > .match-team-logo');

    if (!logo) {
      side.classList.remove('has-team-logo');
      if (image) {
        image.hidden = true;
        delete image.dataset.loadedSrc;
        delete image.dataset.requestedSrc;
        image.removeAttribute('src');
      }
      return;
    }

    if (!image) {
      image = document.createElement('img');
      image.className = 'match-team-logo';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.decoding = 'async';
      image.hidden = true;
      image.addEventListener('load', () => {
        const source = image!.getAttribute('src') ?? '';
        image!.dataset.loadedSrc = source;
        if (source) cacheLogo(source);
        if (image!.dataset.requestedSrc !== source) return;
        image!.hidden = false;
        side.classList.add('has-team-logo');
      });
      image.addEventListener('error', () => {
        image!.hidden = true;
        delete image!.dataset.loadedSrc;
        side.classList.remove('has-team-logo');
      });
      side.prepend(image);
    }

    image.loading = eager ? 'eager' : 'lazy';
    image.setAttribute('fetchpriority', eager ? 'high' : 'auto');
    if (eager) prewarmLogo(logo.imageUrl, true);
    image.dataset.requestedSrc = logo.imageUrl;
    if (image.getAttribute('src') !== logo.imageUrl) {
      image.hidden = true;
      side.classList.remove('has-team-logo');
      image.src = logo.imageUrl;
    }
    const loaded = image.dataset.loadedSrc === logo.imageUrl;
    image.hidden = !loaded;
    side.classList.toggle('has-team-logo', loaded);
  };

  const sync = (): void => {
    root.querySelectorAll<HTMLElement>('.match-card-teams > strong').forEach((side, sideIndex) => {
      decorateSide(side, Math.floor(sideIndex / 2) < EAGER_CARD_COUNT);
    });
  };

  function queueSync(): void {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      sync();
    });
  }

  const wrappedFetch: typeof window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.ok) {
      try {
        const url = requestUrl(args[0]);
        if (isSchedulePath(url.pathname)) {
          const payload = await response.clone().json().catch(() => null);
          if (payload) rememberScheduleTeams(payload);
        }
      } catch {
        // Ignore non-URL fetch inputs and leave the original response untouched.
      }
    }
    return response;
  };

  window.fetch = wrappedFetch;

  // Cards can render synchronously from the schedule cache before the first
  // network response. Seed the logo map from those same cached events so the
  // first card paint already has logo URLs available and can prewarm them.
  rememberScheduleTeams({ events: readScheduleCache('matches') ?? [] });
  rememberScheduleTeams({ events: readScheduleCache('history') ?? [] });

  const observer = new MutationObserver(queueSync);
  observer.observe(root, { childList: true, subtree: true });
  queueSync();

  return () => {
    observer.disconnect();
    warming.clear();
    if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
  };
}
