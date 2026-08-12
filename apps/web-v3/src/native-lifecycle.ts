import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { currentV3Route } from './route-page.ts';

type ListenerHandle = { remove: () => Promise<void> };

function returnToCatalogue(): boolean {
  const matches = document.querySelector<HTMLElement>('[data-app-view="matches"]');
  if (!matches) return false;
  matches.click();
  return true;
}

/**
 * Bridges native Android lifecycle signals into the existing V3 browser lifecycle.
 * The live-data layer already treats the DOM `resume` event as a forced fresh
 * foreground refresh, so the native shell reuses that contract instead of adding
 * a second polling/finality path.
 */
export function installNativeLifecycle(): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;

  const root = document.documentElement;
  root.dataset.v3Runtime = Capacitor.getPlatform();
  root.dataset.v3AppState = 'active';
  let disposed = false;

  const listeners: Array<Promise<ListenerHandle>> = [
    App.addListener('appStateChange', ({ isActive }) => {
      if (disposed) return;
      root.dataset.v3AppState = isActive ? 'active' : 'background';
    }),
    App.addListener('resume', () => {
      if (disposed) return;
      document.dispatchEvent(new Event('resume'));
    }),
    App.addListener('backButton', () => {
      if (disposed) return;
      const route = currentV3Route();
      if (route.kind !== 'catalogue') {
        if (!returnToCatalogue()) window.history.back();
        return;
      }
      void App.minimizeApp();
    })
  ];

  return () => {
    disposed = true;
    listeners.forEach(listener => {
      void listener.then(handle => handle.remove()).catch(() => undefined);
    });
  };
}
