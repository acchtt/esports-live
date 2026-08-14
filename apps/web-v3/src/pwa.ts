import { Capacitor } from '@capacitor/core';

const BUILD_SHA = String(import.meta.env.VITE_BUILD_SHA ?? '').trim();

async function removeNativePwaState(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }

  if ('caches' in window) {
    const names = await window.caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('arena-v3-shell-') || name.startsWith('arena-v3-static-'))
      .map(name => window.caches.delete(name)));
  }
}

function standaloneMode(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function installPwa(): void {
  const platform = Capacitor.getPlatform();
  const native = Capacitor.isNativePlatform();
  document.documentElement.dataset.v3Runtime = platform;
  document.documentElement.dataset.v3DisplayMode = standaloneMode() ? 'standalone' : 'browser';

  if (native) {
    document.documentElement.dataset.v3Pwa = 'native';
    void removeNativePwaState().catch(() => undefined);
    return;
  }

  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    document.documentElement.dataset.v3DisplayMode = standaloneMode() ? 'standalone' : 'browser';
  });

  if (!('serviceWorker' in navigator) || !BUILD_SHA) return;

  const register = async (): Promise<void> => {
    try {
      await navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD_SHA)}`, {
        scope: '/'
      });
      document.documentElement.dataset.v3Pwa = 'ready';
    } catch {
      document.documentElement.dataset.v3Pwa = 'unavailable';
    }
  };

  if (document.readyState === 'complete') {
    void register();
  } else {
    window.addEventListener('load', () => void register(), { once: true });
  }
}
