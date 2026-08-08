import type { TeamRef } from '@esports-live/core';

const EAGER_CARD_COUNT = 6;
const PREWARM_EVENT_COUNT = 10;

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
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
  let syncQueued = false;

  const prewarmLogo = (imageUrl: string, highPriority: boolean): void => {
    if (!imageUrl || prewarmed.has(imageUrl)) return;
    prewarmed.add(imageUrl);

    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    image.setAttribute('fetchpriority', highPriority ? 'high' : 'auto');
    const release = () => warming.delete(imageUrl);
    image.addEventListener('load', release, { once: true });
    image.addEventListener('error', release, { once: true });
    warming.set(imageUrl, image);
    image.src = imageUrl;
  };

  const rememberTeam = (team: TeamRef): void => {
    const imageUrl = team.imageUrl?.trim();
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
        const imageUrl = team.imageUrl?.trim();
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
      image.addEventListener('error', () => {
        image!.hidden = true;
        side.classList.remove('has-team-logo');
      });
      side.prepend(image);
    }

    image.loading = eager ? 'eager' : 'lazy';
    image.setAttribute('fetchpriority', eager ? 'high' : 'auto');
    if (eager) prewarmLogo(logo.imageUrl, true);
    if (image.getAttribute('src') !== logo.imageUrl) image.src = logo.imageUrl;
    image.hidden = false;
    side.classList.add('has-team-logo');
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
          void response.clone().json().then(rememberScheduleTeams).catch(() => undefined);
        }
      } catch {
        // Ignore non-URL fetch inputs and leave the original response untouched.
      }
    }
    return response;
  };

  window.fetch = wrappedFetch;

  const observer = new MutationObserver(queueSync);
  observer.observe(root, { childList: true, subtree: true });
  queueSync();

  return () => {
    observer.disconnect();
    warming.clear();
    if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
  };
}
