const BUILD_SHA = String(import.meta.env.VITE_BUILD_SHA ?? '').trim();

function standaloneMode(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function installPwa(): void {
  document.documentElement.dataset.v3DisplayMode = standaloneMode() ? 'standalone' : 'browser';

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
