import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface UpdateStatus {
  available: boolean;
  currentVersionCode: number;
  currentVersionName: string;
  latestVersionCode?: number;
  latestVersionName?: string;
  apkUrl?: string;
  sha256?: string;
  releaseNotes?: string;
  publishedAt?: string;
}

interface InstallResult {
  started: boolean;
  permissionRequired?: boolean;
}

interface UpdateState {
  state: 'downloading' | 'installing' | 'failed';
  message?: string;
}

type ListenerHandle = { remove: () => Promise<void> };

interface ArenaUpdaterPlugin {
  checkForUpdate(): Promise<UpdateStatus>;
  installUpdate(options: { apkUrl: string; sha256: string }): Promise<InstallResult>;
  addListener(eventName: 'updateState', listener: (event: UpdateState) => void): Promise<ListenerHandle>;
}

const ArenaUpdater = registerPlugin<ArenaUpdaterPlugin>('ArenaUpdater');
const APK_UPDATER_ENABLED = String(import.meta.env.VITE_ENABLE_APK_UPDATER ?? '').toLowerCase() === 'true';

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const value = root.querySelector<T>(selector);
  if (!value) throw new Error(`Missing updater element: ${selector}`);
  return value;
}

function safeVersion(value: string | undefined): string {
  return value?.trim() || 'unknown';
}

export function installAppUpdater(root: HTMLElement): () => void {
  const host = root.querySelector<HTMLElement>('#arena-updater');
  if (!host) return () => undefined;

  if (!APK_UPDATER_ENABLED || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    host.hidden = true;
    return () => undefined;
  }

  host.innerHTML = `
    <div class="update-card-heading">
      <div>
        <span>APP UPDATES</span>
        <strong>Keep ARENA current</strong>
      </div>
      <span class="update-status-badge" data-update-badge>CHECKING</span>
    </div>
    <p data-update-copy>Checking for the latest Android version…</p>
    <p class="update-version" data-update-version></p>
    <div class="update-actions">
      <button type="button" data-update-install hidden>Update now</button>
      <button type="button" data-update-check>Check again</button>
    </div>`;

  const badge = requiredElement<HTMLElement>(host, '[data-update-badge]');
  const copy = requiredElement<HTMLElement>(host, '[data-update-copy]');
  const version = requiredElement<HTMLElement>(host, '[data-update-version]');
  const installButton = requiredElement<HTMLButtonElement>(host, '[data-update-install]');
  const checkButton = requiredElement<HTMLButtonElement>(host, '[data-update-check]');
  let latest: UpdateStatus | null = null;
  let disposed = false;
  let permissionPending = false;

  const setBusy = (busy: boolean): void => {
    checkButton.disabled = busy;
    installButton.disabled = busy;
  };

  const dismissPrompt = (): void => {
    root.querySelector('[data-update-prompt]')?.remove();
  };

  const showPrompt = (status: UpdateStatus): void => {
    dismissPrompt();
    const prompt = document.createElement('aside');
    prompt.className = 'update-prompt';
    prompt.dataset.updatePrompt = '';
    prompt.setAttribute('role', 'dialog');
    prompt.setAttribute('aria-label', 'ARENA update available');
    prompt.innerHTML = `
      <button class="update-prompt-close" type="button" data-update-later aria-label="Update later">×</button>
      <span>UPDATE AVAILABLE</span>
      <strong>ARENA ${safeVersion(status.latestVersionName)}</strong>
      <p></p>
      <button class="update-prompt-action" type="button" data-update-install>Update now</button>`;
    requiredElement<HTMLElement>(prompt, 'p').textContent = status.releaseNotes || 'A newer Android build is ready.';
    root.append(prompt);
  };

  const renderStatus = (status: UpdateStatus): void => {
    latest = status;
    version.textContent = `Installed ${safeVersion(status.currentVersionName)} (${status.currentVersionCode})`;
    if (status.available) {
      badge.textContent = 'AVAILABLE';
      badge.dataset.state = 'available';
      copy.textContent = status.releaseNotes || `ARENA ${safeVersion(status.latestVersionName)} is ready to install.`;
      installButton.hidden = false;
      showPrompt(status);
      return;
    }
    badge.textContent = 'CURRENT';
    badge.dataset.state = 'current';
    copy.textContent = 'You have the latest ARENA Android version.';
    installButton.hidden = true;
    dismissPrompt();
  };

  const check = async (): Promise<void> => {
    if (disposed) return;
    badge.textContent = 'CHECKING';
    badge.dataset.state = 'checking';
    copy.textContent = 'Checking for the latest Android version…';
    setBusy(true);
    try {
      renderStatus(await ArenaUpdater.checkForUpdate());
    } catch (error) {
      badge.textContent = 'RETRY';
      badge.dataset.state = 'failed';
      copy.textContent = error instanceof Error ? error.message : 'The update server could not be reached.';
    } finally {
      setBusy(false);
    }
  };

  const install = async (): Promise<void> => {
    if (!latest?.available || !latest.apkUrl || !latest.sha256) return;
    setBusy(true);
    badge.textContent = 'STARTING';
    badge.dataset.state = 'checking';
    copy.textContent = 'Preparing the Android installer…';
    try {
      const result = await ArenaUpdater.installUpdate({ apkUrl: latest.apkUrl, sha256: latest.sha256 });
      permissionPending = result.permissionRequired === true;
      if (permissionPending) {
        badge.textContent = 'PERMISSION';
        badge.dataset.state = 'available';
        copy.textContent = 'Allow installs from ARENA, then return here. The download will start automatically.';
        return;
      }
      dismissPrompt();
      badge.textContent = 'DOWNLOADING';
      badge.dataset.state = 'checking';
      copy.textContent = 'Downloading securely. Android will open the installer when it is ready.';
    } catch (error) {
      badge.textContent = 'FAILED';
      badge.dataset.state = 'failed';
      copy.textContent = error instanceof Error ? error.message : 'The update could not be started.';
    } finally {
      setBusy(false);
    }
  };

  const click = (event: Event): void => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-update-install]')) void install();
    if (target?.closest('[data-update-check]')) void check();
    if (target?.closest('[data-update-later]')) dismissPrompt();
  };
  root.addEventListener('click', click);

  const updateStateListener = ArenaUpdater.addListener('updateState', event => {
    if (disposed) return;
    badge.textContent = event.state === 'installing' ? 'INSTALLING' : event.state.toUpperCase();
    badge.dataset.state = event.state === 'failed' ? 'failed' : 'checking';
    copy.textContent = event.message || (event.state === 'installing'
      ? 'Android is opening the installer.'
      : event.state === 'failed'
        ? 'The update failed. Please try again.'
        : 'Downloading the verified ARENA update…');
  });

  const resumeListener = App.addListener('resume', () => {
    if (!permissionPending || disposed) return;
    permissionPending = false;
    window.setTimeout(() => void install(), 350);
  });

  window.setTimeout(() => void check(), 1_200);

  return () => {
    disposed = true;
    dismissPrompt();
    root.removeEventListener('click', click);
    void updateStateListener.then(handle => handle.remove()).catch(() => undefined);
    void resumeListener.then(handle => handle.remove()).catch(() => undefined);
  };
}
